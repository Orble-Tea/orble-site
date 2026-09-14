# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: backend/contract.spec.js >> submit: stub endpoint accepts the page's real POST
- Location: tests/e2e/backend/contract.spec.js:77:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.check: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('[data-approve]').nth(8)
    - locator resolved to <input type="checkbox" data-approve="8" class="h-5 w-5 rounded accent-[#7AC4B3] ring-1 ring-gray-900"/>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <button id="complete" class="w-full rounded-2xl bg-orble-dark py-4 font-semibold text-white shadow-md transition text-base active:scale-[0.99]">↵Complete↵</button> from <div class="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white/95 p-4 backdrop-blur">…</div> subtree intercepts pointer events
    - retrying click action
    - waiting 20ms
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <label class="flex w-14 cursor-pointer items-center justify-center border-l border-gray-100 active:bg-orble-tint">…</label> from <div class="scroll-mt-36 scroll-mb-32 flex items-stretch overflow-hidden rounded-2xl border border-gray-300 bg-gray-100/70">…</div> subtree intercepts pointer events
  2 × retrying click action
      - waiting 100ms
      - waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="px-4 py-3">…</div> from <div class="sticky top-0 z-10 border-b border-gray-200 bg-white">…</div> subtree intercepts pointer events
  13 × retrying click action
       - waiting 500ms
       - waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <button id="complete" class="w-full rounded-2xl bg-orble-dark py-4 font-semibold text-white shadow-md transition text-base active:scale-[0.99]">↵Complete↵</button> from <div class="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white/95 p-4 backdrop-blur">…</div> subtree intercepts pointer events
     - retrying click action
       - waiting 500ms
       - waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <label class="flex w-14 cursor-pointer items-center justify-center border-l border-gray-100 active:bg-orble-tint">…</label> from <div class="scroll-mt-36 scroll-mb-32 flex items-stretch overflow-hidden rounded-2xl border border-gray-300 bg-gray-100/70">…</div> subtree intercepts pointer events
     - retrying click action
       - waiting 500ms
       - waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <div class="px-4 py-3">…</div> from <div class="sticky top-0 z-10 border-b border-gray-200 bg-white">…</div> subtree intercepts pointer events
     - retrying click action
       - waiting 500ms
       - waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <div class="px-4 py-3">…</div> from <div class="sticky top-0 z-10 border-b border-gray-200 bg-white">…</div> subtree intercepts pointer events
  - retrying click action
    - waiting 500ms
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <button id="complete" class="w-full rounded-2xl bg-orble-dark py-4 font-semibold text-white shadow-md transition text-base active:scale-[0.99]">↵Complete↵</button> from <div class="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white/95 p-4 backdrop-blur">…</div> subtree intercepts pointer events
  - retrying click action
    - waiting 500ms
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <label class="flex w-14 cursor-pointer items-center justify-center border-l border-gray-100 active:bg-orble-tint">…</label> from <div class="scroll-mt-36 scroll-mb-32 flex items-stretch overflow-hidden rounded-2xl border border-gray-300 bg-gray-100/70">…</div> subtree intercepts pointer events
  - retrying click action
    - waiting 500ms
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <div class="px-4 py-3">…</div> from <div class="sticky top-0 z-10 border-b border-gray-200 bg-white">…</div> subtree intercepts pointer events
  - retrying click action
    - waiting 500ms

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]: Load · 2026-07-10
      - generic [ref=e6]: 30TH
    - generic [ref=e7]:
      - generic [ref=e8]: "Slot #"
      - generic [ref=e9]: Product
      - generic [ref=e10]: Checkbox
  - generic [ref=e11]:
    - generic [ref=e12]:
      - generic [ref=e13]: "1"
      - generic [ref=e15]: 16oz Matcha Less Sugar with Lychee
      - checkbox [checked] [ref=e18]
    - generic [ref=e19]:
      - generic [ref=e20]: "2"
      - generic [ref=e22]: 16oz Strawberry Matcha Less Sugar
      - checkbox [checked] [ref=e25]
    - generic [ref=e26]:
      - generic [ref=e27]: "3"
      - checkbox [checked] [ref=e31]
    - generic [ref=e32]:
      - generic [ref=e33]: "4"
      - generic [ref=e35]: Empty
      - checkbox [checked] [ref=e38]
    - generic [ref=e39]:
      - generic [ref=e40]: "5"
      - generic [ref=e42]: Empty
      - checkbox [checked] [ref=e45]
    - generic [ref=e46]:
      - generic [ref=e47]: "6"
      - generic [ref=e49]: Empty
      - checkbox [checked] [ref=e52]
    - generic [ref=e53]:
      - generic [ref=e54]: "7"
      - generic [ref=e56]: Empty
      - checkbox [checked] [ref=e59]
    - generic [ref=e60]:
      - generic [ref=e61]: "8"
      - generic [ref=e63]: Empty
      - checkbox [checked] [ref=e66]
    - generic [ref=e67]:
      - generic [ref=e68]:
        - generic [ref=e69]: "9"
        - generic [ref=e71]: Empty
        - checkbox [ref=e74]
      - button "edit" [ref=e76] [cursor=pointer]
    - generic [ref=e77]:
      - generic [ref=e78]:
        - generic [ref=e79]: "10"
        - generic [ref=e81]: Empty
        - checkbox [ref=e84]
      - button "edit" [ref=e86] [cursor=pointer]
    - generic [ref=e87]:
      - generic [ref=e88]:
        - generic [ref=e89]: "11"
        - generic [ref=e91]: Empty
        - checkbox [ref=e94]
      - button "edit" [ref=e96] [cursor=pointer]
    - generic [ref=e97]:
      - generic [ref=e98]:
        - generic [ref=e99]: "12"
        - generic [ref=e101]: Empty
        - checkbox [ref=e104]
      - button "edit" [ref=e106] [cursor=pointer]
    - generic [ref=e107]:
      - generic [ref=e108]:
        - generic [ref=e109]: "13"
        - generic [ref=e111]: Empty
        - checkbox [ref=e114]
      - button "edit" [ref=e116] [cursor=pointer]
    - generic [ref=e117]:
      - generic [ref=e118]:
        - generic [ref=e119]: "14"
        - generic [ref=e121]: Empty
        - checkbox [ref=e124]
      - button "edit" [ref=e126] [cursor=pointer]
    - generic [ref=e127]:
      - generic [ref=e128]:
        - generic [ref=e129]: "15"
        - generic [ref=e131]: Empty
        - checkbox [ref=e134]
      - button "edit" [ref=e136] [cursor=pointer]
    - generic [ref=e137]:
      - generic [ref=e138]:
        - generic [ref=e139]: "16"
        - generic [ref=e141]: Empty
        - checkbox [ref=e144]
      - button "edit" [ref=e146] [cursor=pointer]
    - generic [ref=e147]:
      - generic [ref=e148]:
        - generic [ref=e149]: "17"
        - generic [ref=e151]: Empty
        - checkbox [ref=e154]
      - button "edit" [ref=e156] [cursor=pointer]
    - generic [ref=e157]:
      - generic [ref=e158]:
        - generic [ref=e159]: "18"
        - generic [ref=e161]: Empty
        - checkbox [ref=e164]
      - button "edit" [ref=e166] [cursor=pointer]
    - generic [ref=e167]:
      - generic [ref=e168]:
        - generic [ref=e169]: "19"
        - generic [ref=e171]: Empty
        - checkbox [ref=e174]
      - button "edit" [ref=e176] [cursor=pointer]
    - generic [ref=e177]:
      - generic [ref=e178]:
        - generic [ref=e179]: "20"
        - generic [ref=e181]: Empty
        - checkbox [ref=e184]
      - button "edit" [ref=e186] [cursor=pointer]
    - generic [ref=e187]:
      - generic [ref=e188]:
        - generic [ref=e189]: "21"
        - generic [ref=e191]: Empty
        - checkbox [ref=e194]
      - button "edit" [ref=e196] [cursor=pointer]
    - generic [ref=e197]:
      - generic [ref=e198]:
        - generic [ref=e199]: "22"
        - generic [ref=e201]: Empty
        - checkbox [ref=e204]
      - button "edit" [ref=e206] [cursor=pointer]
    - generic [ref=e207]:
      - generic [ref=e208]:
        - generic [ref=e209]: "23"
        - generic [ref=e211]: Empty
        - checkbox [ref=e214]
      - button "edit" [ref=e216] [cursor=pointer]
    - generic [ref=e217]:
      - generic [ref=e218]:
        - generic [ref=e219]: "24"
        - generic [ref=e221]: Empty
        - checkbox [ref=e224]
      - button "edit" [ref=e226] [cursor=pointer]
    - generic [ref=e227]:
      - generic [ref=e228]:
        - generic [ref=e229]: "25"
        - generic [ref=e231]: Empty
        - checkbox [ref=e234]
      - button "edit" [ref=e236] [cursor=pointer]
    - generic [ref=e237]:
      - generic [ref=e238]:
        - generic [ref=e239]: "26"
        - generic [ref=e241]: Empty
        - checkbox [ref=e244]
      - button "edit" [ref=e246] [cursor=pointer]
    - generic [ref=e247]:
      - generic [ref=e248]:
        - generic [ref=e249]: "27"
        - generic [ref=e251]: Empty
        - checkbox [ref=e254]
      - button "edit" [ref=e256] [cursor=pointer]
    - generic [ref=e257]:
      - generic [ref=e258]:
        - generic [ref=e259]: "28"
        - generic [ref=e261]: Empty
        - checkbox [ref=e264]
      - button "edit" [ref=e266] [cursor=pointer]
    - generic [ref=e267]:
      - generic [ref=e268]:
        - generic [ref=e269]: "29"
        - generic [ref=e271]: Empty
        - checkbox [ref=e274]
      - button "edit" [ref=e276] [cursor=pointer]
    - generic [ref=e277]:
      - generic [ref=e278]:
        - generic [ref=e279]: "30"
        - generic [ref=e281]: Empty
        - checkbox [ref=e284]
      - button "edit" [ref=e286] [cursor=pointer]
    - generic [ref=e287]:
      - generic [ref=e288]:
        - generic [ref=e289]: "31"
        - generic [ref=e291]: Empty
        - checkbox [ref=e294]
      - button "edit" [ref=e296] [cursor=pointer]
    - generic [ref=e297]:
      - generic [ref=e298]:
        - generic [ref=e299]: "32"
        - generic [ref=e301]: Empty
        - checkbox [ref=e304]
      - button "edit" [ref=e306] [cursor=pointer]
    - generic [ref=e307]:
      - generic [ref=e308]:
        - generic [ref=e309]: "33"
        - generic [ref=e311]: Empty
        - checkbox [ref=e314]
      - button "edit" [ref=e316] [cursor=pointer]
    - generic [ref=e317]:
      - generic [ref=e318]:
        - generic [ref=e319]: "34"
        - generic [ref=e321]: Empty
        - checkbox [ref=e324]
      - button "edit" [ref=e326] [cursor=pointer]
    - generic [ref=e327]:
      - generic [ref=e328]:
        - generic [ref=e329]: "35"
        - generic [ref=e331]: Empty
        - checkbox [ref=e334]
      - button "edit" [ref=e336] [cursor=pointer]
  - button "Complete" [ref=e338] [cursor=pointer]
```

# Test source

```ts
  1  | // @steered AudibleSecurityContext 1.2 2026-09-14
  2  | // Layer 3: the page talks to the REAL API routes running the REAL service
  3  | // code; only Nayax and Google Sheets are faked (fixture-server.mjs). These
  4  | // tests exist for one bug class only: contract drift between what
  5  | // restock-service.js actually returns and what the page expects. No UI
  6  | // behavior re-testing here; layer 2 owns that.
  7  | import { test, expect } from "@playwright/test";
  8  | import { SCENARIO_DATES } from "../fixture-server.mjs";
  9  | 
  10 | const KEY = "test-key";
  11 | 
  12 | async function startLog(page, date) {
  13 |   await page.goto(`/restock?key=${KEY}`);
  14 |   await page.fill("#batch-date", date);
  15 |   await page.click("#start-log");
  16 | }
  17 | 
  18 | test("Load: real service output renders (field-name contract)", async ({
  19 |   page,
  20 | }) => {
  21 |   await startLog(page, SCENARIO_DATES.load);
  22 |   await expect(page.locator("#table-event")).toHaveText("Load");
  23 | 
  24 |   // Slot 1: plan assigns 3x Matcha, Nayax says 3 Thai Tea in the slot
  25 |   // (PAR 4 - missing 1). The page must render the service's expectedNew /
  26 |   // sweetnessLevel / previousDrink fields, not the spec-doc names.
  27 |   const slot1 = page.locator("#slot-list > div").first();
  28 |   await expect(slot1).toContainText("Matcha");
  29 |   await expect(slot1).toContainText(
  30 |     "replacing Thai Tea 16oz Less Sugar w/ Lychee",
  31 |   );
  32 |   await expect(slot1).toContainText("new: 3");
  33 |   await expect(slot1).toContainText("waste: 3");
  34 |   await expect(slot1).toContainText("Less Sugar"); // sweetnessLevel reached the qualifiers
  35 | 
  36 |   // Slot 3: Nayax reports an unparseable product name -> warnings[] flows
  37 |   // through the real route and lands on the row.
  38 |   const slot3 = page.locator("#slot-list > div").nth(2);
  39 |   await expect(slot3).toContainText(/unrecognized flavor code/i);
  40 | 
  41 |   // Slot 4 has drinks but no plan row: the real service leaves flavor null
  42 |   // (zero-quantity/unplanned contract) and the page renders the retiring
  43 |   // instruction, never the old drink as if it were incoming.
  44 |   const slot4 = page.locator("#slot-list > div").nth(3);
  45 |   await expect(slot4).toContainText("Empty");
  46 |   await expect(slot4).toContainText("removing Taro 16oz");
  47 |   await expect(slot4).toContainText("waste: 2");
  48 | 
  49 |   // Slot 5 has no product and no plan row: the truly-empty card.
  50 |   await expect(page.locator("#slot-list > div").nth(4)).toContainText("Empty");
  51 | });
  52 | 
  53 | test("Topoff: real allocation and previous counts flow through", async ({
  54 |   page,
  55 | }) => {
  56 |   await startLog(page, SCENARIO_DATES.topoff);
  57 |   await expect(page.locator("#table-event")).toHaveText("Topoff");
  58 | 
  59 |   // Real determineEvent read the fixture Restock Log's Load row for this
  60 |   // batch. Inventory allocates from "To 30TH"; slot 1 keeps its drink.
  61 |   const slot1 = page.locator("#slot-list > div").first();
  62 |   await expect(slot1).toContainText("previous: 3");
  63 |   await expect(slot1).toContainText("waste: 0");
  64 |   await expect(slot1).not.toContainText("replacing");
  65 | });
  66 | 
  67 | test("fully-logged batch: real 409 fires the terminal error card", async ({
  68 |   page,
  69 | }) => {
  70 |   await startLog(page, SCENARIO_DATES.done);
  71 |   await expect(page.locator("#start-status")).toContainText(
  72 |     /already loaded and topped off/i,
  73 |   );
  74 |   await expect(page.locator("#view-table")).toBeHidden();
  75 | });
  76 | 
  77 | test("submit: stub endpoint accepts the page's real POST", async ({ page }) => {
  78 |   await startLog(page, SCENARIO_DATES.load);
  79 |   await expect(page.locator("#table-event")).toHaveText("Load");
  80 |   for (const box of await page.locator("[data-approve]").all())
> 81 |     await box.check();
     |               ^ Error: locator.check: Test timeout of 30000ms exceeded.
  82 |   await page.click("#complete");
  83 |   // Real route validated key + required fields and acknowledged.
  84 |   await expect(page.locator("#view-submitted")).toBeVisible();
  85 | });
  86 | 
```