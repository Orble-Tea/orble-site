# Shared production-plan validation

`src/lib/production-plan.js` owns machine geometry, slot capacities, slot parsing,
and production-plan validation. The website imports it directly. The clasp
preparation command bundles that exact module for the Apps Script V8 runtime.
Change rules in that file and release the website and Apps Script from the same
commit.

All successful restock-data requests, including Load, Topoff, and Clearout, validate
the current plan before requesting Nayax products or building slot data. The
Google Sheets reader also validates every read of the Production Plan tab.
Invalid plans return HTTP 502 with `details.code = INVALID_PRODUCTION_PLAN` and
row-specific issues.

The schema requires Drink Variation, Amount to Make, and amount and slot columns
for both configured machines. Quantities require explicit nonnegative integers,
including zero for inactive machines. Slots accept commas, spaces, and semicolons.
Positive allocations require slots. Slots must be unique per active machine,
within its geometry, and within drink capacity. Duplicate slots within one cell
and duplicate variation names are rejected. Machine allocations cannot exceed
Amount to Make. Recipe headings carry down. Parsing stops at the existing
Catering, Quantity to Make, and repeated Recipe section markers.

Boba Pack rows receive normal quantity, slot range, duplicate-slot and allocation
validation, with capacity six per slot. All quantity cells require explicit
nonnegative integers, including zero for inactive machines. Boba Pack remains in
the validated mirror and inventory, but is excluded from beverage recipe-card
batches and beverage-only recipe, size and water-volume checks. Ordinary drinks
with boba toppings retain normal drink capacity. Unnamed numeric totals in Amount to Make
and Total Stickers are skipped when the machine amount and slot cells are blank.
No row numbers or fixed batch lengths are used.

Capacity is four per drink slot and six per Boba Pack slot. The old Apps Script Constants capacity
overrides are superseded by these shared rules. Recipe, topping, water-volume,
and container checks remain specific to recipe-card and inventory generation.

## GitHub Actions setup

1. Enable the [Apps Script API](https://script.google.com/home/usersettings) for
   an account with edit access to the linked project.
2. Run `npm ci`, then `npx clasp login` on your own machine. Store the complete
   resulting `~/.clasprc.json` as the `CLASPRC_JSON` secret in a GitHub environment
   named `apps-script`. Do not commit that file.
3. Push to `slot-validation` or `master`. Changes to the shared validator, Apps
   Script adapters, preparation script, sync workflow, or npm dependency files
   automatically run **Apps Script validation sync** and upload the prepared
   project through clasp. Both branches update the same configured Apps Script
   project, so merging is not required to activate uploads from `slot-validation`.
4. In the Apps Script editor, run `installProductionPlanValidationTriggers` once
   as the spreadsheet owner and authorize its spreadsheet and trigger access.
   Use one owner account to avoid duplicate triggers installed by different users.

The workflow tests the code, pulls and backs up the complete existing project,
replaces old validation and reader functions, and adds the shared bundle and
adapters before automatically pushing the result. An unfamiliar loader or
inventory function causes preparation to fail. Preparation enables V8 and adds
the trigger-management scope if the manifest declares explicit OAuth scopes.

Optional manual runs remain available in GitHub Actions once the workflow exists
on the default branch. Leave `push_to_apps_script` unchecked to generate backup
and prepared-source artifacts for review, or check it to upload. To inspect the
prepared project before the first merge, use the local preparation commands below.

Deploy the website and Apps Script from the same reviewed commit. `clasp push`
updates project source; it does not update a
versioned web-app deployment. The inspected project uses spreadsheet menus and
triggers and has no `doGet` endpoint. If a web-app deployment is added, its
deployment version must also be updated.

The workflow preserves the rest of the Apps Script project by pulling it before
applying the repository-owned adapter. Unrelated Apps Script source is still
maintained in that project. The two repository-owned files are generated
`SlotValidation` and `PlanAccess`; edits to those in the online editor are
replaced at the next sync.

## Live inventory

The owner setup creates `Validated Production Plan` in the source workbook and
redirects existing inventory IMPORTRANGE formulas for this workbook to that tab.
New inventory sheets use the validated tab too. The mirror contains validated item values
from one validated read, preserving source column positions and row numbers.
Summary and heading rows are blanked, and inherited recipe headings are filled onto item rows.

An installable edit trigger refreshes it after spreadsheet edits. A five-minute
trigger also catches formula recalculation and API-written edits, which do not
fire spreadsheet edit triggers. IMPORTRANGE has its own refresh delay. Invalid
plans clear the published quantities and write the validation error in the
mirror; existing IFERROR inventory formulas show blanks until the plan is fixed.
Current plan validation in restock-data requests is immediate and does not rely
on the mirror refresh interval.

Keep the mirror tab reserved for the script. Re-run Update Inventory after
reordering source columns, as the existing inventory formulas use column letters.
External consumers that still import the raw Production Plan must be moved to
the validated tab or use the shared module themselves. The separate label-printer
site linked by StickerBridge is outside this repository; StickerBridge only
opens that site and does not read the plan.

## Local preparation

```sh
npm ci
npx clasp login
npm run apps-script:init
cd .apps-script
../node_modules/.bin/clasp pull
cd ..
npm run apps-script:prepare
```

Review `.apps-script` before pushing it with clasp. This staging directory is
ignored by Git. A backup artifact can be restored by copying its complete source
into a fresh staging directory, running `apps-script:init` to restore its clasp
configuration, and pushing from that directory without running preparation.
Retain a private copy of the before artifact if a longer rollback period is needed.

## Verification

`npm test` includes malformed plans, both machines, section boundaries, API
failures for all three restock events, and execution of the generated bundle and
adapters in an Apps Script-like JavaScript context. It also checks that migration
preserves unrelated source, is repeatable, and refuses unknown project layouts.
Live Sheets/Nayax integration tests require the existing test workbook secrets.
