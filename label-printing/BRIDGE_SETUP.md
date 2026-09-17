# Orble Google Sheets Print Bridge

This bridge lets a Google Sheets button trigger the local Brother QL-600 label script on the Mac connected to the printer.

## 1. Start the local bridge

Pick a private token. Use any long random string.

```bash
cd /Users/yangyiyun/Documents/Orble/orble-site

export ORBLE_PRINT_TOKEN="replace-with-a-long-random-secret"
export ORBLE_PRINTER_USB="usb://0x04f9:0x20c0"

/opt/homebrew/bin/python3.11 label-printing/print_bridge.py
```

Leave that Terminal window open while you want Sheet-triggered printing to work.

Test it locally without printing:

```bash
curl -X POST \
  -H "X-Orble-Print-Token: replace-with-a-long-random-secret" \
  "http://127.0.0.1:8765/run-everything?dry_run=true"
```

## 2. Expose the bridge to Google Sheets

Google Sheets runs in Google's cloud, so it cannot call `127.0.0.1` on your Mac directly. Use a tunnel.

With ngrok:

```bash
ngrok http 8765
```

Copy the HTTPS forwarding URL, for example:

```text
https://abc123.ngrok-free.app
```

Your bridge URL is:

```text
https://abc123.ngrok-free.app/run-everything
```

## 3. Add the Apps Script

In the Google Sheet:

1. Open **Extensions > Apps Script**.
2. Paste the contents of `label-printing/google_sheets_apps_script.js`.
3. Replace `https://YOUR-TUNNEL-URL/run-everything` with your tunnel URL.
4. Replace `CHANGE-ME` with the same `ORBLE_PRINT_TOKEN`.
5. Save the script.

## 4. Connect the button

Right-click the Run Everything button in the Sheet, choose **Assign script**, and enter:

```text
runEverythingLabels
```

Use this function for a no-print test:

```text
dryRunEverythingLabels
```

## What Happens

The Sheet button sends a protected HTTP request to the tunnel. The tunnel forwards it to the local bridge on the Mac. The bridge runs:

```bash
/opt/homebrew/bin/python3.11 label-printing/print_continuous_label.py --run-everything --usb "$ORBLE_PRINTER_USB"
```

The label script reads the production plan, groups labels by recipe, prints each recipe as one job, and cuts after each recipe.
