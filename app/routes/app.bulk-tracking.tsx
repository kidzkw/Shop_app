import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { processBulkTracking } from "../bulk-tracking.server";
import type { RowResult } from "../bulk-tracking.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const csvText = formData.get("csv");
  const notifyCustomer = formData.get("notifyCustomer") === "true";

  if (typeof csvText !== "string" || csvText.trim() === "") {
    return { error: "No CSV provided." as const, results: [] as RowResult[] };
  }

  const results = await processBulkTracking({
    admin,
    csvText,
    notifyCustomer,
  });

  return { error: null as string | null, results };
};

const TEMPLATE_CSV =
  "order_number,sku,quantity,tracking_number,tracking_url,carrier\n" +
  "1001,,,1Z999AA10123456784,,UPS\n" +
  "1002,SHIRT-M,1,1Z999AA10123456785,,UPS\n" +
  "1002,PANTS-L,2,1Z999AA10123456786,,UPS\n";

const REQUIRED_HEADERS = [
  "order_number",
  "sku",
  "quantity",
  "tracking_number",
  "tracking_url",
  "carrier",
];

type PreviewRow = {
  row: number;
  order_number: string;
  sku: string;
  quantity: string;
  tracking_number: string;
  tracking_url: string;
  carrier: string;
};

type Preview =
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ok"; rows: PreviewRow[] };

export default function BulkTracking() {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");
  const [csvText, setCsvText] = useState<string>("");
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  const isSubmitting =
    fetcher.state === "submitting" || fetcher.state === "loading";

  const preview: Preview = useMemo(() => {
    if (!csvText) return { kind: "empty" };
    try {
      return { kind: "ok", rows: parseCsvForPreview(csvText) };
    } catch (e: any) {
      return { kind: "error", message: e?.message ?? "Could not parse CSV" };
    }
  }, [csvText]);

  useEffect(() => {
    if (!fetcher.data || isSubmitting) return;
    const total = fetcher.data.results.length;
    if (total === 0) return;
    const ok = fetcher.data.results.filter((r) => r.status === "success").length;
    const failed = total - ok;
    shopify.toast.show(
      `Processed ${total} row${total === 1 ? "" : "s"}: ${ok} success, ${failed} failed`,
      failed > 0 ? { isError: true } : undefined,
    );
  }, [fetcher.data, isSubmitting, shopify]);

  const downloadTemplate = () => {
    triggerDownload("tracking-template.csv", TEMPLATE_CSV);
  };

  const acceptFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    setCsvText(text);
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) await acceptFile(f);
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) await acceptFile(f);
  };

  const clearFile = () => {
    setFileName("");
    setCsvText("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = () => {
    if (!csvText) {
      shopify.toast.show("Please choose a CSV file first", { isError: true });
      return;
    }
    if (preview.kind === "error") {
      shopify.toast.show(preview.message, { isError: true });
      return;
    }
    const fd = new FormData();
    fd.set("csv", csvText);
    fd.set("notifyCustomer", notifyCustomer ? "true" : "false");
    fetcher.submit(fd, { method: "POST" });
  };

  const results = fetcher.data?.results ?? [];
  const ok = results.filter((r) => r.status === "success").length;
  const failed = results.length - ok;

  const downloadErrors = () => {
    const errs = results.filter((r) => r.status === "error");
    if (errs.length === 0) return;
    const header =
      "row,order_number,sku,quantity,tracking_number,error\n";
    const body = errs
      .map((r) =>
        [
          r.row,
          csvField(r.orderNumber),
          csvField(r.sku),
          r.quantity ?? "",
          csvField(r.trackingNumber),
          csvField(r.message),
        ].join(","),
      )
      .join("\n");
    triggerDownload("tracking-errors.csv", header + body + "\n");
  };

  return (
    <s-page heading="Bulk tracking upload">
      <s-section heading="Step 1 — Download the template">
        <s-paragraph>
          Start from our template so the columns are correct. Edit it in your
          spreadsheet app, then upload it below.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button onClick={downloadTemplate}>Download CSV template</s-button>
        </s-stack>
        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <pre style={{ margin: 0, fontSize: 12, overflowX: "auto" }}>
            <code>{TEMPLATE_CSV}</code>
          </pre>
        </s-box>
        <s-unordered-list>
          <s-list-item>
            <s-text>
              <strong>order_number</strong> — required. With or without "#"
              (e.g. <code>1001</code> or <code>#1001</code>).
            </s-text>
          </s-list-item>
          <s-list-item>
            <s-text>
              <strong>sku</strong> + <strong>quantity</strong> — optional.
              Leave both blank to fulfill the entire order under one tracking
              number. Fill them in to split shipments by line item.
            </s-text>
          </s-list-item>
          <s-list-item>
            <s-text>
              <strong>tracking_number</strong> — required.
            </s-text>
          </s-list-item>
          <s-list-item>
            <s-text>
              <strong>tracking_url</strong> — optional. If blank and{" "}
              <strong>carrier</strong> is recognized (UPS, USPS, FedEx, DHL
              Express, Canada Post…), Shopify generates the URL.
            </s-text>
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="Step 2 — Upload your file">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? "#005bd3" : "#c9cccf"}`,
            borderRadius: 8,
            padding: 24,
            textAlign: "center",
            cursor: "pointer",
            background: dragOver ? "#f1f8ff" : "#fafbfb",
            transition: "all 120ms ease",
          }}
        >
          <s-stack direction="block" gap="tight">
            <s-text>
              <strong>
                {fileName ? fileName : "Drop CSV here or click to choose"}
              </strong>
            </s-text>
            {!fileName && (
              <s-text>
                <span style={{ color: "#6d7175" }}>
                  Accepts a single .csv file
                </span>
              </s-text>
            )}
          </s-stack>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onPick}
            style={{ display: "none" }}
          />
        </div>

        {fileName && (
          <s-stack direction="inline" gap="base">
            <s-button variant="tertiary" onClick={clearFile}>
              Remove file
            </s-button>
          </s-stack>
        )}

        {preview.kind === "error" && (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-text>
              <strong style={{ color: "#b71c1c" }}>
                CSV problem:
              </strong>{" "}
              {preview.message}
            </s-text>
          </s-box>
        )}

        {preview.kind === "ok" && (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="tight">
              <s-text>
                <strong>{preview.rows.length}</strong> row
                {preview.rows.length === 1 ? "" : "s"} ready to upload.
                Showing first {Math.min(5, preview.rows.length)}:
              </s-text>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={cellStyle}>#</th>
                    <th style={cellStyle}>Order</th>
                    <th style={cellStyle}>SKU</th>
                    <th style={cellStyle}>Qty</th>
                    <th style={cellStyle}>Tracking</th>
                    <th style={cellStyle}>Carrier</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 5).map((r) => (
                    <tr key={r.row}>
                      <td style={cellStyle}>{r.row}</td>
                      <td style={cellStyle}>{r.order_number}</td>
                      <td style={cellStyle}>{r.sku || "—"}</td>
                      <td style={cellStyle}>{r.quantity || "—"}</td>
                      <td style={cellStyle}>{r.tracking_number}</td>
                      <td style={cellStyle}>{r.carrier || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </s-stack>
          </s-box>
        )}
      </s-section>

      <s-section heading="Step 3 — Confirm and upload">
        <s-stack direction="block" gap="base">
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={notifyCustomer}
              onChange={(e) => setNotifyCustomer(e.target.checked)}
            />
            <s-text>Email customers a shipping confirmation</s-text>
          </label>

          <s-stack direction="inline" gap="base">
            <s-button
              onClick={handleSubmit}
              {...(isSubmitting ? { loading: true } : {})}
              {...(preview.kind !== "ok" ? { disabled: true } : {})}
            >
              Upload &amp; create fulfillments
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      {fetcher.data?.error && (
        <s-section heading="Upload error">
          <s-text>{fetcher.data.error}</s-text>
        </s-section>
      )}

      {results.length > 0 && (
        <s-section heading="Results">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <Badge tone="success">{ok} succeeded</Badge>
              {failed > 0 && <Badge tone="critical">{failed} failed</Badge>}
              {failed > 0 && (
                <s-button variant="tertiary" onClick={downloadErrors}>
                  Download errors as CSV
                </s-button>
              )}
            </s-stack>
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={cellStyle}>#</th>
                    <th style={cellStyle}>Order</th>
                    <th style={cellStyle}>SKU</th>
                    <th style={cellStyle}>Qty</th>
                    <th style={cellStyle}>Tracking</th>
                    <th style={cellStyle}>Status</th>
                    <th style={cellStyle}>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.row}>
                      <td style={cellStyle}>{r.row}</td>
                      <td style={cellStyle}>{r.orderNumber ?? "—"}</td>
                      <td style={cellStyle}>{r.sku ?? "—"}</td>
                      <td style={cellStyle}>{r.quantity ?? "—"}</td>
                      <td style={cellStyle}>{r.trackingNumber ?? "—"}</td>
                      <td style={cellStyle}>
                        <Badge
                          tone={r.status === "success" ? "success" : "critical"}
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td style={{ ...cellStyle, maxWidth: 360 }}>
                        {r.message ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </s-box>
          </s-stack>
        </s-section>
      )}

      <s-section slot="aside" heading="Tips">
        <s-unordered-list>
          <s-list-item>
            <s-text>
              You can put multiple tracking numbers on one order — just add a
              row per shipment with the matching SKU and quantity.
            </s-text>
          </s-list-item>
          <s-list-item>
            <s-text>
              Each row creates a separate fulfillment. Customers get one email
              per fulfillment if "Email customers" is on.
            </s-text>
          </s-list-item>
          <s-list-item>
            <s-text>
              Failed rows don't stop the rest. Download errors as CSV, fix
              them, and re-upload only those.
            </s-text>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "success" | "critical" | "neutral";
  children: React.ReactNode;
}) {
  const palette = {
    success: { bg: "#cdfee1", fg: "#0c5132" },
    critical: { bg: "#feeae6", fg: "#8e1f0b" },
    neutral: { bg: "#e4e5e7", fg: "#202223" },
  }[tone];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: palette.bg,
        color: palette.fg,
      }}
    >
      {children}
    </span>
  );
}

function triggerDownload(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvField(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseCsvForPreview(text: string): PreviewRow[] {
  const rows = parseCsvRaw(text);
  if (rows.length === 0) throw new Error("File is empty");
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const idx: Record<string, number> = {};
  for (const h of REQUIRED_HEADERS) {
    const i = header.indexOf(h);
    if (i === -1) throw new Error(`Missing required column: ${h}`);
    idx[h] = i;
  }
  const out: PreviewRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 0 || r.every((c) => c.trim() === "")) continue;
    out.push({
      row: i + 1,
      order_number: (r[idx.order_number] ?? "").trim(),
      sku: (r[idx.sku] ?? "").trim(),
      quantity: (r[idx.quantity] ?? "").trim(),
      tracking_number: (r[idx.tracking_number] ?? "").trim(),
      tracking_url: (r[idx.tracking_url] ?? "").trim(),
      carrier: (r[idx.carrier] ?? "").trim(),
    });
  }
  if (out.length === 0) throw new Error("No data rows found");
  for (const r of out) {
    if (!r.order_number)
      throw new Error(`Row ${r.row}: missing order_number`);
    if (!r.tracking_number)
      throw new Error(`Row ${r.row}: missing tracking_number`);
    if (r.quantity && !/^\d+$/.test(r.quantity))
      throw new Error(`Row ${r.row}: quantity must be a positive integer`);
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

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const cellStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid #e1e3e5",
  textAlign: "left",
  verticalAlign: "top",
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
