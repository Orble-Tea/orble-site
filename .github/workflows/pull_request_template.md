# Munch Pull Request Review Template

## Summary
> **Provide a concise summary** of what this PR does and why it’s needed.
---

## Context / Background
> **Include relevant context** for this change:
- **JIRA ticket:** (JIRA, GitHub Issue links, etc.)
- **Documentation** Relevant Confluence page
- **Links to related issues or tasks:** JIRA / GitHub Issue links that this PR builds on or depends on
- **Context on previous decisions:** that this PR builds on or modifies
- **Demo:** number, description, and why it fits under that demo
---

## Implementation Details
> **Explain the approach** used in this PR:
 - Describe key classes, functions, or modules that were modified or added
 - Highlight any important decisions and trade-offs made

---

## Mini Runbook
> **Describe what someone needs to do to run your code. Include what repositories need to be pulled in and what commands your reviewers should run.**

---

## Testing
> **Describe how this PR has been tested**:
- [ ] Unit tests were added and code coverage of worked-on files exceeds 70% across functions, statements, and branches. If not, explain why.
- [ ]  Integration or end to end tests were added. If yes, mention scenarios covered.

### (Optional) Other testing performed
> **Describe any other ways how this PR has been tested**:

---

## Potential Impact
> **List areas this PR might impact**:
- **Dependencies:** What other parts of the code base are affected by this change? 
- **Worst case scenario**: If everything goes wrong with this change, what would be the effect on the application as a whole?
- **Security Considerations** Can this change introduce security risks and, if so, how are you mitigating them?
---

## Checklist
- [ ] I have run a linter, commented my code, and removed unused statements
- [ ] I have updated the documentation on Confluence. If not, describe why it is unnecessary for this change.
- [ ]  My build succeeds locally and remotely. If not, explain why.
---

## Reviewer Notes
> **Any areas where feedback is especially helpful**:
- **Alternate approaches** considered
- **Concerns** regarding maintainability, scalability, or readability. Did you knowingly cut any corners?
- **Follow-on work** What issues did you discover along the way that are out of scope, but added to the backlog?
- **Specific parts of the code** that need thorough review
