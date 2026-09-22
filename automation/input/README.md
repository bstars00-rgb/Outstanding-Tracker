# automation/input — manual run mode (DATA_SOURCE=file)

Save the ELLIS MCP tool results here (git-ignored) and run `DATA_SOURCE=file npx tsx automation/weekly-report.ts`.
Accepted layouts:
1. Raw export: `{ "asOf": "...", "reportingCurrency": "JPY", "sellerInvoices": [...], "payments": [...], "traders": [...], "appliedRates": [...] }`
   (arrays = the tool responses `list` concatenated over all pages; field names per handoff spec / ellis-entities.ts).
2. A full `ReceivablesDataset` JSON (tracker schema).
See docs/RUNBOOK_MANUAL_RUN.md.
