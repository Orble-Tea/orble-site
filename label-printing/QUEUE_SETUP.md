# Orble Google Sheets Print Queue

This setup avoids ngrok. Google Sheets builds the print job in a `Print Queue` tab, and the Mac connected to the QL-600 polls that tab and prints new jobs.

## What Runs Where

Google Sheets:

- Reads the production plan.
- Builds the exact label rows.
- Writes them to `Print Queue`.

Print Mac:

- Polls `Print Queue`.
- Prints unseen job IDs over USB.
- Stores printed job IDs in `label-printing/print_queue_state.json`.

## 1. Add Apps Script

In Google Sheets:

1. Open **Extensions > Apps Script**.
2. Paste the contents of `label-printing/google_sheets_apps_script.js`.
3. Save.
4. Assign the sheet button to:

```text
runEverythingLabels
```

For a cloud-only no-print count test, run:

```text
dryRunEverythingLabels
```

## 2. Confirm Queue Access

The local Mac reads the queue through the Sheet CSV endpoint. The Sheet must be readable by the print Mac. The current production-plan CSV export already works from the script; if that changes, share the Sheet so the print Mac can read it.

## 3. Run the Hosted Worker

On whichever Mac is connected to the QL-600, run this after pressing **Run Everything** in Google Sheets:

```bash
curl -L https://raw.githubusercontent.com/Orble-Tea/orble-site/label-printing/label-printing/run_print_worker.sh | bash
```

That command clones or updates the `label-printing` branch into:

```text
~/.orble-label-printer/orble-site
```

It then creates a local Python environment, installs the printer dependencies, polls `Print Queue` once, prints any new job, and exits.

For a no-print test:

```bash
curl -L https://raw.githubusercontent.com/Orble-Tea/orble-site/label-printing/label-printing/run_print_worker.sh | bash -s -- --dry-run
```

To keep the worker running continuously during production:

```bash
curl -L https://raw.githubusercontent.com/Orble-Tea/orble-site/label-printing/label-printing/run_print_worker.sh | bash -s -- --watch
```

## 4. Local Development Commands

If you are already inside a local checkout on the Mac connected to the QL-600:

```bash
cd /Users/yangyiyun/Documents/Orble/orble-site

/opt/homebrew/bin/python3.11 label-printing/print_queue_worker.py
```

Leave it running during production.

To poll once without printing:

```bash
/opt/homebrew/bin/python3.11 label-printing/print_queue_worker.py --once --dry-run
```

To poll once and print:

```bash
/opt/homebrew/bin/python3.11 label-printing/print_queue_worker.py --once --usb "usb://0x04f9:0x20c0"
```

## Operator Flow

1. Press **Run Everything** in Google Sheets.
2. Run the hosted worker command on whichever Mac has the QL-600 plugged in.
3. The Sheet writes a new `Job ID` into `Print Queue`.
4. The worker sees the new job and prints by recipe.
5. Each recipe is sent as one batch and cut after that recipe.

No tunnel URL is needed.
