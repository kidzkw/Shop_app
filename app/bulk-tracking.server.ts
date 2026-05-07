type AdminApiContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export type RowResult = {
  row: number;
  orderNumber: string | null;
  sku: string | null;
  quantity: number | null;
  trackingNumber: string | null;
  status: "success" | "error";
  message?: string;
};

type ParsedRow = {
  row: number;
  orderNumber: string;
  sku: string;
  quantity: number | null;
  trackingNumber: string;
  trackingUrl: string;
  carrier: string;
};

const REQUIRED_HEADERS = [
  "order_number",
  "sku",
  "quantity",
  "tracking_number",
  "tracking_url",
  "carrier",
] as const;

export async function processBulkTracking(args: {
  admin: AdminApiContext;
  csvText: string;
  notifyCustomer: boolean;
}): Promise<RowResult[]> {
  const { admin, csvText, notifyCustomer } = args;

  let parsed: ParsedRow[];
  try {
    parsed = parseCsv(csvText);
  } catch (e: any) {
    return [
      {
        row: 0,
        orderNumber: null,
        sku: null,
        quantity: null,
        trackingNumber: null,
        status: "error",
        message: `CSV parse error: ${e?.message ?? String(e)}`,
      },
    ];
  }

  const results: RowResult[] = [];
  const orderCache = new Map<string, OrderLookup | null>();

  for (const row of parsed) {
    const base: RowResult = {
      row: row.row,
      orderNumber: row.orderNumber,
      sku: row.sku || null,
      quantity: row.quantity,
      trackingNumber: row.trackingNumber,
      status: "error",
    };

    if (!row.orderNumber) {
      results.push({ ...base, message: "Missing order_number" });
      continue;
    }
    if (!row.trackingNumber) {
      results.push({ ...base, message: "Missing tracking_number" });
      continue;
    }

    const normalized = normalizeOrderName(row.orderNumber);

    let order = orderCache.get(normalized);
    if (order === undefined) {
      try {
        order = await fetchOrder(admin, normalized);
      } catch (e: any) {
        order = null;
        results.push({
          ...base,
          message: `Lookup failed: ${e?.message ?? String(e)}`,
        });
        orderCache.set(normalized, null);
        continue;
      }
      orderCache.set(normalized, order);
    }

    if (!order) {
      results.push({ ...base, message: `Order ${normalized} not found` });
      continue;
    }

    const openFOs = order.fulfillmentOrders.filter(
      (fo) => fo.status === "OPEN" || fo.status === "IN_PROGRESS",
    );
    if (openFOs.length === 0) {
      results.push({
        ...base,
        message: "No open fulfillment orders on this order",
      });
      continue;
    }

    const lineItemsByFO = pickLineItems(openFOs, row);
    if (lineItemsByFO.error) {
      results.push({ ...base, message: lineItemsByFO.error });
      continue;
    }

    try {
      const r = await createFulfillment(admin, {
        lineItemsByFulfillmentOrder: lineItemsByFO.value!,
        trackingNumber: row.trackingNumber,
        trackingUrl: row.trackingUrl || null,
        carrier: row.carrier || null,
        notifyCustomer,
      });
      if (r.userErrors.length > 0) {
        results.push({
          ...base,
          message: r.userErrors.map((u) => u.message).join("; "),
        });
      } else {
        results.push({ ...base, status: "success", message: r.fulfillmentId ?? undefined });
      }
    } catch (e: any) {
      results.push({
        ...base,
        message: `fulfillmentCreate failed: ${e?.message ?? String(e)}`,
      });
    }
  }

  return results;
}

function normalizeOrderName(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

type OrderLookup = {
  id: string;
  name: string;
  fulfillmentOrders: Array<{
    id: string;
    status: string;
    lineItems: Array<{
      id: string;
      remainingQuantity: number;
      sku: string | null;
      lineItemId: string | null;
    }>;
  }>;
};

async function fetchOrder(
  admin: AdminApiContext,
  orderName: string,
): Promise<OrderLookup | null> {
  const escaped = orderName.replace(/"/g, '\\"');
  const resp = await admin.graphql(
    `#graphql
    query LookupOrder($q: String!) {
      orders(first: 1, query: $q) {
        edges {
          node {
            id
            name
            fulfillmentOrders(first: 50) {
              edges {
                node {
                  id
                  status
                  lineItems(first: 250) {
                    edges {
                      node {
                        id
                        remainingQuantity
                        sku
                        lineItem { id }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`,
    { variables: { q: `name:"${escaped}"` } },
  );
  const json: any = await resp.json();
  const node = json?.data?.orders?.edges?.[0]?.node;
  if (!node) return null;
  return {
    id: node.id,
    name: node.name,
    fulfillmentOrders: node.fulfillmentOrders.edges.map((e: any) => ({
      id: e.node.id,
      status: e.node.status,
      lineItems: e.node.lineItems.edges.map((li: any) => ({
        id: li.node.id,
        remainingQuantity: li.node.remainingQuantity,
        sku: li.node.sku ?? null,
        lineItemId: li.node.lineItem?.id ?? null,
      })),
    })),
  };
}

type FOLineItemInput = {
  fulfillmentOrderId: string;
  fulfillmentOrderLineItems: Array<{ id: string; quantity: number }>;
};

function pickLineItems(
  openFOs: OrderLookup["fulfillmentOrders"],
  row: ParsedRow,
): { value?: FOLineItemInput[]; error?: string } {
  if (row.sku) {
    let needed = row.quantity ?? Number.POSITIVE_INFINITY;
    const picks = new Map<string, Map<string, number>>();
    for (const fo of openFOs) {
      for (const li of fo.lineItems) {
        if (needed <= 0) break;
        if (li.remainingQuantity <= 0) continue;
        if ((li.sku ?? "").toLowerCase() !== row.sku.toLowerCase()) continue;
        const take = Math.min(li.remainingQuantity, needed);
        if (!picks.has(fo.id)) picks.set(fo.id, new Map());
        picks.get(fo.id)!.set(li.id, take);
        needed -= take;
      }
      if (needed <= 0) break;
    }
    if (picks.size === 0) {
      return { error: `No open line item matching SKU "${row.sku}"` };
    }
    if (row.quantity != null && needed > 0) {
      return {
        error: `Not enough remaining quantity for SKU "${row.sku}" (short by ${needed})`,
      };
    }
    return {
      value: [...picks.entries()].map(([foId, lis]) => ({
        fulfillmentOrderId: foId,
        fulfillmentOrderLineItems: [...lis.entries()].map(([id, quantity]) => ({
          id,
          quantity,
        })),
      })),
    };
  }

  const out: FOLineItemInput[] = [];
  for (const fo of openFOs) {
    const items = fo.lineItems
      .filter((li) => li.remainingQuantity > 0)
      .map((li) => ({ id: li.id, quantity: li.remainingQuantity }));
    if (items.length > 0) {
      out.push({
        fulfillmentOrderId: fo.id,
        fulfillmentOrderLineItems: items,
      });
    }
  }
  if (out.length === 0) {
    return { error: "No remaining open quantity on this order" };
  }
  return { value: out };
}

async function createFulfillment(
  admin: AdminApiContext,
  args: {
    lineItemsByFulfillmentOrder: FOLineItemInput[];
    trackingNumber: string;
    trackingUrl: string | null;
    carrier: string | null;
    notifyCustomer: boolean;
  },
): Promise<{
  fulfillmentId: string | null;
  userErrors: Array<{ field?: string[] | null; message: string }>;
}> {
  const trackingInfo: Record<string, string> = {
    number: args.trackingNumber,
  };
  if (args.trackingUrl) trackingInfo.url = args.trackingUrl;
  if (args.carrier) trackingInfo.company = args.carrier;

  const resp = await admin.graphql(
    `#graphql
    mutation CreateFulfillment($fulfillment: FulfillmentInput!) {
      fulfillmentCreate(fulfillment: $fulfillment) {
        fulfillment { id status trackingInfo { number url company } }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        fulfillment: {
          lineItemsByFulfillmentOrder: args.lineItemsByFulfillmentOrder,
          trackingInfo,
          notifyCustomer: args.notifyCustomer,
        },
      },
    },
  );
  const json: any = await resp.json();
  const data = json?.data?.fulfillmentCreate;
  return {
    fulfillmentId: data?.fulfillment?.id ?? null,
    userErrors: data?.userErrors ?? [],
  };
}

function parseCsv(text: string): ParsedRow[] {
  const rows = parseCsvRaw(text);
  if (rows.length === 0) throw new Error("Empty CSV");
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const idx: Record<string, number> = {};
  for (const h of REQUIRED_HEADERS) {
    const i = header.indexOf(h);
    if (i === -1) throw new Error(`Missing required column: ${h}`);
    idx[h] = i;
  }
  const out: ParsedRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 0 || r.every((c) => c.trim() === "")) continue;
    const qtyRaw = (r[idx.quantity] ?? "").trim();
    const qty = qtyRaw === "" ? null : Number(qtyRaw);
    if (qty != null && (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty))) {
      throw new Error(`Row ${i + 1}: quantity must be a positive integer`);
    }
    out.push({
      row: i + 1,
      orderNumber: (r[idx.order_number] ?? "").trim(),
      sku: (r[idx.sku] ?? "").trim(),
      quantity: qty,
      trackingNumber: (r[idx.tracking_number] ?? "").trim(),
      trackingUrl: (r[idx.tracking_url] ?? "").trim(),
      carrier: (r[idx.carrier] ?? "").trim(),
    });
  }
  return out;
}

function parseCsvRaw(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const t = text.replace(/^﻿/, "");
  while (i < t.length) {
    const c = t[i];
    if (inQuotes) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      cur.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== "" || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}
