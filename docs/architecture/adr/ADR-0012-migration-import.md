# ADR-0012 — Kakitangan migration: staged CSV/XLSX import, shared validators, dry run, all-or-nothing commit

**Status:** Proposed · **Date:** 15/11/2026 · **Refs:** D9, R4, F-MIG-01–19, §13 PRD, EC-MIG-01–05, D13 (statutory correction), D5 (YTD import)

## Context
Interact's data and configuration move from Kakitangan (5 employees today) via templates
T1–T16. Real data must never enter the repository (R4, CLAUDE.md). Imports must validate
exactly like the UI, support a dry run, commit all-or-nothing, upsert on re-import, and
reconcile to zero variance with SA sign-off. Opening leave balances need the D13 statutory
correction as adjustments.

## Options
1. One-off SQL scripts run by a developer against production — bypasses validation, audit and RLS; needs developer access to real data.
2. **In-app import module** run by ADM/SA: upload → parse → validate with the same zod schemas/business rules → dry-run report → single-transaction commit as the importing user (RLS, triggers and audit apply) → reconciliation and sign-off.
3. Third-party ETL tool — another processor of personal data, no business rules.

## Decision
Option 2. `import_jobs` / `import_rows`; S1 identifiers encrypted at parse time (no
plaintext MyKad/bank in staging rows); two-pass resolution within a file; dd/mm/yyyy only;
error report with masked identifiers; upsert keys per template; opening balances as typed
ledger entries (`is_opening`); D13 corrections as adjustments with the fixed reason;
source files deleted 30 days after commit. An importing Admin's **own** adjustment rows
must be committed by another Admin or SA (not-own rule).

## Consequences
- (+) Migration is repeatable on staging with synthetic data and run on production by the people entitled to the data; full audit trail.
- (+) The same module serves R1.1 payroll imports (T13–T16).
- (−) Kakitangan export column shapes still unknown (Q1) — templates accept them once samples arrive.
