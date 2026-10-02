---
name: weekly-outstanding
description: Run the weekly outstanding-receivables report end to end (convert the OP workbook, update the tracker site, post the card to the Teams "Outstanding" chat). Use when the user says "미수금 주간보고", "주간보고", "이번주 미수 보고", "weekly outstanding report" or drops a new Outstanding_Report*.xlsx.
---

# Weekly outstanding report (미수금 주간보고)

The user (Global Ops) has given a standing instruction (2026-10-02): when they say "미수금 주간보고" or "주간보고",
update everything and post **without asking for confirmation**. Scope of that authorization: this week's report to the
tracker site and one card to the Teams group chat "Outstanding". Anything else (other chats, re-posting, emails) still
needs to be asked.

## Steps

1. **Find the workbook.** Newest `Outstanding_Report*.xlsx` in the user's Downloads (an attached path wins). If the newest
   file is older than 6 days, ask for this week's file instead of re-posting last week.
2. **Look before running.** Open it with openpyxl and compare with last week's copy in `automation/input/`:
   - invoice tab: `Outstanding` or a dated tab (`09-Oct`); **report date = that tab's date** (today if there is none)
   - invoices closed / new / balance changes; the `Noted` column ("Payment received …" = at the bank, not yet in ELLIS)
   - Tier sheet PIC differences vs `automation/config/pic-overrides.json` (overrides win; do not ask again)
   - new sellers without owner/tier, new internal-looking accounts (출장, 하드블럭), unknown columns or note wording
3. **Refresh the ELLIS channel directory** if the ELLIS MCP `list_channels` tool is available: write
   `automation/input/ellis-channels.json` (fields: sellerCompCode, sellerCompName, countryName, ownerCompCode, ownerCompName, activeYn).
4. **Run** from the repo root:
   ```bash
   npm run weekly -- --latest <YYYY-MM-DD> --push --push-teams
   ```
   (`.env` holds the site password and settings; never print or commit it.) This converts, runs the pipeline against last
   week's snapshot, builds the review workbook, pushes the encrypted site bundle and posts the card through Microsoft Graph.
5. **Verify.**
   - pipeline `RESULT`, `verification ok=true`, previous snapshot = last week's date
   - review workbook reconciles: ELLIS ledger = open receivables + received-not-in-ELLIS (recalculate in Excel, 0 formula errors)
   - GitHub Actions deploy of the new commit succeeded and the site serves the new `bundle.enc.json`
   - the runner printed `Teams Graph: posted`; a duplicate attempt must be refused, never forced
6. **Report back** in Korean: the headline numbers vs last week, what changed, anything that needs the user's decision.
   Write `handoff/leadership/핵심결론_대표님_재무팀_<date>.md` in the format of the previous weeks and send it with the
   review workbook.

## Stop and ask instead of posting when

- the converter or pipeline fails, or the workbook layout changed in a way the converter does not understand
- totals look implausible (e.g. real receivables jump more than 10× or the ledger does not reconcile)
- a report for the same date was already posted (ask whether a corrected `--resend` is wanted)
- the Graph token needs an interactive login (`--login`) or the target chat cannot be resolved

## Conventions that must hold

- Reporting currency JPY, Korean wording, internal accounts excluded, managing entity from ELLIS `list_channels`
- No customer-level ledgers in chat cards; plaintext data never leaves the machine (site data is the encrypted bundle only)
- One Teams post per report date; corrections only on request
- Record new decisions in `docs/DECISION_LOG.md` and update the memory notes when a convention changes
