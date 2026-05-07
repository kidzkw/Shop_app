import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  // The app stores no customer personal data, so there is nothing to redact.
  console.log(`Received ${topic} for ${shop}`, JSON.stringify(payload));

  return new Response();
};
