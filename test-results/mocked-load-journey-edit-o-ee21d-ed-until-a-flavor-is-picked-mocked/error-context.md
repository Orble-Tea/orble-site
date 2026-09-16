# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mocked/load-journey.spec.js >> edit on a retiring slot: Empty preselected, chips greyed until a flavor is picked
- Location: tests/e2e/mocked/load-journey.spec.js:95:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('[data-edit]').nth(2)
    - locator resolved to <button data-edit="2" class="rounded-full bg-orble-light/20 px-5 py-2 text-sm font-medium text-orble-ink active:bg-orble-light/40">edit</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <button id="complete" class="w-full rounded-2xl bg-orble-dark py-4 font-semibold text-white shadow-md transition text-base active:scale-[0.99]">↵Complete↵</button> from <div class="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white/95 p-4 backdrop-blur">…</div> subtree intercepts pointer events
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="text-[13px] text-gray-400">removing Taro 16oz</div> from <div class="flex items-stretch bg-white shadow-sm">…</div> subtree intercepts pointer events
    - retrying click action
      - waiting 100ms
    14 × waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <div class="text-[13px] text-gray-400">removing Taro 16oz</div> from <div class="flex items-stretch bg-white shadow-sm">…</div> subtree intercepts pointer events
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
       - <div class="text-[13px] text-gray-400">removing Taro 16oz</div> from <div class="flex items-stretch bg-white shadow-sm">…</div> subtree intercepts pointer events
     - retrying click action
       - waiting 500ms
       - waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <div class="text-[13px] text-gray-400">removing Taro 16oz</div> from <div class="flex items-stretch bg-white shadow-sm">…</div> subtree intercepts pointer events
     - retrying click action
       - waiting 500ms
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <div class="text-[13px] text-gray-400">removing Taro 16oz</div> from <div class="flex items-stretch bg-white shadow-sm">…</div> subtree intercepts pointer events
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
      - generic [ref=e13]:
        - generic [ref=e14]: "1"
        - generic [ref=e16]:
          - generic [ref=e17]: Matcha
          - generic [ref=e18]: replacing Thai Tea 16oz Less Sugar w/ Lychee
          - generic [ref=e19]: 16oz
          - generic [ref=e20]: Lychee
          - generic [ref=e21]: Less Sugar
        - generic [ref=e22]:
          - generic [ref=e23]: "waste: 3"
          - generic [ref=e24]: "new: 3"
          - generic [ref=e25]: "total: 3"
        - checkbox [ref=e27]
      - button "edit" [ref=e29] [cursor=pointer]
    - generic [ref=e30]:
      - generic [ref=e31]:
        - generic [ref=e32]: "2"
        - generic [ref=e34]:
          - generic [ref=e35]: Matcha
          - generic [ref=e36]: 16oz
          - generic [ref=e37]: Less Sugar
        - generic [ref=e38]:
          - generic [ref=e39]: "waste: 2"
          - generic [ref=e40]: "new: 2"
          - generic [ref=e41]: "total: 2"
        - checkbox [ref=e43]
      - button "edit" [ref=e45] [cursor=pointer]
    - generic [ref=e46]:
      - generic [ref=e47]:
        - generic [ref=e48]: "3"
        - generic [ref=e50]:
          - generic [ref=e51]: Empty
          - generic [ref=e52]: removing Taro 16oz
        - generic [ref=e53]:
          - generic [ref=e54]: "waste: 2"
          - generic [ref=e55]: "new: 0"
          - generic [ref=e56]: "total: 0"
        - checkbox [ref=e58]
      - button "edit" [ref=e60] [cursor=pointer]
    - generic [ref=e61]:
      - generic [ref=e62]:
        - generic [ref=e63]: "4"
        - generic [ref=e65]: Empty
        - checkbox [ref=e68]
      - button "edit" [ref=e70] [cursor=pointer]
  - button "Complete" [ref=e72] [cursor=pointer]
```

# Test source

```ts
  1   | // @steered AudibleSecurityContext 1.2 2026-09-14
  2   | // Layer 2: the page is real, the backend is faked at the network layer.
  3   | // One dense journey carries the tier: table shape, approve gate, fold, edit
  4   | // math, and the highest-value assertion in the suite: the exact POST body the
  5   | // follow-up submit PR will feed into Nayax and the Restock Log.
  6   | import { test, expect } from "@playwright/test";
  7   | import {
  8   |   loadPayload,
  9   |   topoffPayload,
  10  |   mockData,
  11  |   mockSubmit,
  12  |   startLog,
  13  |   approveAll,
  14  | } from "./helpers.mjs";
  15  | 
  16  | test("full Load visit: render, gate, edit, fold, submit payload", async ({
  17  |   page,
  18  | }) => {
  19  |   await mockData(page, loadPayload());
  20  |   const posts = await mockSubmit(page);
  21  |   await startLog(page, "2026-07-10");
  22  | 
  23  |   // Table renders the Load work order.
  24  |   await expect(page.locator("#table-event")).toHaveText("Load");
  25  |   const slot1 = page.locator("#slot-list > div").first();
  26  |   await expect(slot1).toContainText("Matcha");
  27  |   await expect(slot1).toContainText(
  28  |     "replacing Thai Tea 16oz Less Sugar w/ Lychee",
  29  |   );
  30  |   await expect(slot1).toContainText("waste: 3");
  31  |   // Same-drink slot shows no replacing line; empty slot renders greyed.
  32  |   await expect(page.locator("#slot-list > div").nth(1)).not.toContainText(
  33  |     "replacing",
  34  |   );
  35  |   await expect(page.locator("#slot-list > div").nth(2)).toContainText("Empty");
  36  | 
  37  |   // Approve gate: Complete with nothing approved fires NO request.
  38  |   await page.click("#complete");
  39  |   await expect(page.locator("#complete-hint")).toContainText(
  40  |     "Not approved: slots 1, 2, 3",
  41  |   );
  42  |   expect(posts).toHaveLength(0);
  43  | 
  44  |   // Edit slot 1: math updates live and waste is capped at previous.
  45  |   await page.locator("[data-edit]").first().click();
  46  |   await page.locator('[data-step="newCount:1"]').click(); // new 3 -> 4
  47  |   await expect(page.locator("#edit-total")).toHaveText("4"); // 3 - 3 + 4
  48  |   await page.locator('[data-step="waste:1"]').click(); // waste already at previous(3): capped
  49  |   await expect(page.locator("#edit-m-waste")).toHaveText("3");
  50  |   await page.click("#edit-save");
  51  | 
  52  |   // Approving folds the row to a single line with the full drink name.
  53  |   await approveAll(page);
  54  |   await expect(page.locator("#slot-list > div").first()).toContainText(
  55  |     "16oz Matcha Less Sugar with Lychee",
  56  |   );
  57  | 
  58  |   // Complete now submits; the POST body is the contract.
  59  |   await page.click("#complete");
  60  |   await expect(page.locator("#view-submitted")).toBeVisible();
  61  |   expect(posts).toHaveLength(1);
  62  |   const body = posts[0];
  63  |   expect(body.batchId).toBe("30TH-2026-07-10");
  64  |   expect(body.event).toBe("Load");
  65  |   expect(body.machine).toBe("30TH");
  66  |   expect(body.date).toBe("2026-07-10");
  67  |   expect(body.duration).toMatch(/^\d+m \d+s$/);
  68  |   // Empty slot 4 is excluded; the retiring slot's waste IS recorded;
  69  |   // the edited value made it through.
  70  |   expect(body.slots).toEqual([
  71  |     { slot: 1, waste: 3, new: 4 },
  72  |     { slot: 2, waste: 2, new: 2 },
  73  |     { slot: 3, waste: 2, new: 0 },
  74  |   ]);
  75  | });
  76  | 
  77  | test("Topoff renders previous line, zero waste, no replacing", async ({
  78  |   page,
  79  | }) => {
  80  |   await mockData(page, topoffPayload());
  81  |   await startLog(page, "2026-07-13");
  82  | 
  83  |   await expect(page.locator("#table-event")).toHaveText("Topoff");
  84  |   const slot1 = page.locator("#slot-list > div").first();
  85  |   await expect(slot1).toContainText("previous: 3");
  86  |   await expect(slot1).toContainText("waste: 0");
  87  |   await expect(slot1).toContainText("total: 5");
  88  |   await expect(slot1).not.toContainText("replacing");
  89  |   // Topoff order: previous, waste, new, total (total always last).
  90  |   await expect(slot1.locator(".text-right")).toHaveText(
  91  |     /previous:.*waste:.*new:.*total:/s,
  92  |   );
  93  | });
  94  | 
  95  | test("edit on a retiring slot: Empty preselected, chips greyed until a flavor is picked", async ({
  96  |   page,
  97  | }) => {
  98  |   await mockData(page, loadPayload());
  99  |   await startLog(page, "2026-07-10");
> 100 |   await page.locator("[data-edit]").nth(2).click(); // slot 3, the retiring one
      |                                            ^ Error: locator.click: Test timeout of 30000ms exceeded.
  101 | 
  102 |   // The strip says removing (not replacing), Empty is the selected flavor,
  103 |   // and the drink attribute chips are disabled: nothing is going in.
  104 |   await expect(page.locator("#edit-body")).toContainText("removing Taro 16oz");
  105 |   await expect(page.locator("#edit-flavor")).toHaveValue("__empty__");
  106 |   await expect(page.locator("#edit-chips input").first()).toBeDisabled();
  107 | 
  108 |   // The New stepper is zeroed and locked too: nothing goes into a cleared slot.
  109 |   await expect(page.locator('[data-step="newCount:1"]')).toBeDisabled();
  110 |   await expect(page.locator("#edit-newCount")).toHaveText("0");
  111 | 
  112 |   // Picking a real flavor re-enables everything.
  113 |   await page.selectOption("#edit-flavor", { index: 0 });
  114 |   await expect(page.locator("#edit-chips input").first()).toBeEnabled();
  115 |   await expect(page.locator('[data-step="newCount:1"]')).toBeEnabled();
  116 | });
  117 | 
```