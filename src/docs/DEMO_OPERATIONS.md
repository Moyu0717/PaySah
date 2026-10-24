# Demo operations

All demo records are synthetic. Cashiers and Owners review evidence; neither role can replace missing bank credit with a receipt screenshot.

## Reset a demonstration

An Owner can open Activity and choose Reset demo data, then confirm the dialog. The API checks the server-side identity and demo tenant. Cashiers receive 403. Reset clears that shop's demo orders, receipts, intake bindings, checks and activity and restores seeded demonstration data. Sessions and users are retained. Old private image objects are not deleted by the reset.

Reset is destructive to the current shop's demonstration history. Save the required screenshots or recording first, and avoid resetting while receipts are still being processed or delivered by external channels. Do not use this operation as a payment workflow step.

## Receipt processing

Receipt worker jobs have a 180-second lease to accommodate the model lookup, bounded GPU request and CPU fallback/cross-check. This reduces the previous 120-second timing collision; it does not guarantee that every stalled or interrupted job will complete.

The actual reading provider and fallback reason are recorded. A successful health check with extractor_mode=runpod only confirms configuration, not a successful GPU request. Receipt extraction never confirms payment by itself.

## Channels

Telegram uses fixed English acknowledgements for a connected order, received receipt and invalid submission. Receipt received does not mean payment confirmed. Google Form forwards receipt images using the server intake contract and bounded retries. These connectors require server secrets and explicit setup; default environment values disable both.

Local tests simulate external services. Team deployment records report successful Telegram and Google Form submissions, but replay checks and new deployments must be validated separately. Never publish bot tokens, ingest keys or submission links as proof screenshots.
