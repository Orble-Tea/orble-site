# Integration tests

These tests exercise the backend against real Google Sheets workbooks, using a service account, and the Nayax production API.

## Sheet-to-backend flows under test

- `Production Plan` -> `GET /api/restock-data` -> `Load`
- `Production Plan` slot assignments differ from current Nayax slots -> `GET /api/restock-data` -> `Load` returns the Production Plan slot layout
- `Restock Log` + latest inventory tab -> `GET /api/restock-data` -> `Topoff`
- `Restock Log` already contains both `Load` and `Topoff` for the batch -> `409 Conflict`

## What they cover

- `GET /api/restock-data` for the `Load` flow
- `GET /api/restock-data` uses Production Plan slot assignments during `Load`, even when the same drink is currently in a different Nayax slot
- `GET /api/restock-data` for the `Topoff` flow
- `GET /api/restock-data` conflict handling after `Load` and `Topoff` already exist
- Live Nayax production authentication and `machineProducts` reads

## Local setup

1. Create a `.env.integration` file at the repo root.
2. Fill in the test-only values below:
   - `RESTOCK_SECRET_KEY`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`
   - `PRODUCTION_PLAN_SHEET_ID`
   - `INVENTORY_SHEET_ID`
   - `RESTOCK_LOG_SHEET_ID`
   - `NAYAX_BASE_URL=https://lynx.nayax.com/operational/v1`
   - `NAYAX_MACHINE_30TH_ID`
   - `NAYAX_MACHINE_TOWNE_ID`
   - `NAYAX_API_TOKEN`
3. Use the copied test workbooks only. Do not point these IDs at production sheets.
4. Share the test workbooks with the service account email.
5. Run `npm run test:integration`.

## GitHub Actions

The workflow at `.github/workflows/integration-tests.yml` runs the same suite on every push, using GitHub Secrets for the test workbook IDs, service account credentials, and Nayax production credentials.

## Cleanup behavior

Each test clears and reseeds the Google Sheets ranges it touches so the suite can be rerun safely and independently.
