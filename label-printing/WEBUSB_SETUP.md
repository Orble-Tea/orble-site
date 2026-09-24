# WebUSB Label Printer Test

This is the no-Python browser path for testing direct USB printing from Chrome or Edge.

## Run It Locally

From the site repo:

```sh
cd /Users/yangyiyun/Documents/Orble/orble-site
npm run dev
```

Open:

```text
http://localhost:4321/label-printer
```

`localhost` is allowed for WebUSB testing. If this page is deployed later, it must be served over HTTPS.

## Run It On Netlify

Open the hosted page with the same key used by the restock page:

```text
https://deploy-preview-25--orble-tea.netlify.app/label-printer?key=YOUR_RESTOCK_KEY
```

The key is checked by the site server before the printer UI is shown. The USB permission still happens locally in the operator's Chrome or Edge browser.

## Print A Test Label

1. Plug the Brother QL-600 into the computer by USB.
2. Open the page in Chrome or Edge.
3. Click `Connect QL-600`.
4. Select the Brother printer in the browser permission picker.
5. Click `Print Test Label`.

The test label uses the DK-1204 layout: full drink name, expiration date, and an optional code. If the code field is blank, the top-left area stays blank for storage labels.

## Batch Test Format

Each batch textarea line is:

```text
CODE | EXPIRATION_DATE | DRINK NAME
```

Storage labels can start with a blank code:

```text
D30TH#21 | 09/28/26 | Strawberry Matcha 16oz
 | 09/28/26 | Strawberry Matcha 16oz
```

The browser sends the batch as one print job and requests one cut after the final label.

## Important Limitation

WebUSB can only work if Chrome or Edge is allowed to claim the QL-600 USB interface. If the browser reports a claim/access error, the printer or operating system is blocking browser-level USB access for this device. In that case, use the local queue worker path instead.
