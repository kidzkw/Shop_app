# Privacy Policy — Bulk Tracking Upload

_Last updated: May 7, 2026_

This Privacy Policy describes how the **Bulk Tracking Upload** Shopify app ("the App", "we", "us") collects, uses, and shares information when a merchant installs and uses the App on their Shopify store.

## 1. Information we access

When a merchant installs the App, the App is granted access to the following Shopify Admin API resources, used solely to create fulfillments on the merchant's behalf:

- **Orders** — order number, line items (SKU, quantity, remaining unfulfilled quantity), and fulfillment orders. The App reads these only to match a CSV row to the correct order and create a fulfillment.
- **Fulfillments** — the App creates fulfillments containing the tracking number, tracking URL, and carrier provided in the merchant's CSV.
- **Shop session data** — Shopify provides an access token and shop domain so the App can authenticate API calls. This is stored in the App's database for the duration of the install.

The App does **not** access customer names, emails, phone numbers, addresses, payment data, or any other protected customer data fields.

## 2. Information we collect from the merchant

The App processes the contents of CSV files uploaded by the merchant. CSV contents are processed in memory to create fulfillments and are not retained after processing.

## 3. How we use information

We use the information described above only to:

- Authenticate API calls to the merchant's Shopify store.
- Look up orders by order number and identify line items by SKU.
- Create fulfillments with the tracking information the merchant provided.
- Display per-row success and error results back to the merchant.

We do not sell, rent, or share merchant or customer data with third parties. We do not use data for advertising or analytics beyond what is needed to operate the App.

## 4. Data storage and retention

- The App stores the Shopify session token and shop domain in its database for as long as the App is installed.
- CSV uploads are processed in memory and are not stored.
- Fulfillment results displayed in the UI are held only for the current session.
- When the merchant uninstalls the App, Shopify sends the `app/uninstalled` webhook. On receipt, the App deletes the merchant's session data within 30 days.

## 5. Sub-processors

The App relies on Shopify's Admin GraphQL API. No other third-party data processors are used.

## 6. Security

Data in transit is encrypted using TLS. The session database is hosted on infrastructure with disk-level encryption at rest.

## 7. Customer data subject requests (GDPR, CCPA)

The App does not store customer personal data. Shopify sends three mandatory compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`); because the App holds no customer personal data, these requests have no records to return or redact beyond confirming the request was received.

## 8. Changes to this policy

We may update this Privacy Policy from time to time. Material changes will be communicated through the App's listing on the Shopify App Store and by updating the "Last updated" date above.

## 9. Contact

For questions about this Privacy Policy or to exercise data rights, contact:

**Email:** zhang.kwen@gmail.com
