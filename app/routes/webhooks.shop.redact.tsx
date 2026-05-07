import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} for ${shop}`, JSON.stringify(payload));

  // The only shop-scoped data the app stores is the session record.
  // Delete any sessions for this shop in response to the redact request.
  await db.session.deleteMany({ where: { shop } });

  return new Response();
};
