# orble-site conventions

## Code style

- Comments: tersest one-line form, only where non-obvious. One phrase everywhere; limit `;` and `:`, which should not be necessary. No em dashes anywhere.
- Strings: consts at the top of the view that uses them. Shared UI holds only multi-view strings.
- Numbers: no magic numbers. Named const at the top of the file, or shared (HTTP statuses live in `HTTP`).
- Inline single-use one-liner helpers. Descriptive names in destructuring, never a/b.
- Changes that alter semantics get discussed before applying.

## PRs

- Munch template, single commit per PR, amend and force-push.
- Stack: `restock-ui` (base master) then `restock-tests`. After amending restock-ui: `git rebase --onto restock-ui HEAD~1 restock-tests`.
- Revision changes go in the PR description, never as comments.

## Testing gates

- Never push a failing suite. Gate pushes with `set -o pipefail` and assert the explicit "N passed" summary line.
- Playwright config exists only on `restock-tests`; run `npm install` after switching branches.
- Verify UI on the Netlify deploy preview. When iterating, always provide screenshots.
- Screenshots via a throwaway spec inside the Playwright harness; standalone scripts miss `astro.config.playwright.mjs`.
