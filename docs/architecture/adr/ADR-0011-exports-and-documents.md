# ADR-0011 — Exports and documents: server-side generation, layouts as configuration, versioned outputs

**Status:** Proposed · **Date:** 15/11/2026 · **Refs:** FR-G-06, F-RPT-24/25, F-CLM-15/26/27, F-PAY-27–38, D6, D10, D16, Q37, Q41, Q46, PB13, BR-PAY-17

## Context
Every list needs CSV export of the filtered set; reports need .xlsx/PDF; the month-end
batch produces an HLB Connect First payment list (.xlsx + PDF, manual keying — no bank
format/API, D6) and AutoCount postings (.xlsx only, D10); R1.1 adds payslips, EA forms,
statutory files and the AutoCount journal. Exact AutoCount, HLB and statutory layouts are
not yet supplied (Q37, Q41, Q46). Outputs must be versioned, marked out of date when the
source changes, and every download access-logged.

## Options
1. Client-side generation — exposes full datasets (and account numbers) to the browser.
2. Headless-browser PDF rendering — heavy on serverless.
3. **Server-side generation**: streamed CSV via the same RLS-scoped query as the list; `exceljs` for .xlsx; `@react-pdf/renderer` for PDFs; column layouts for external formats stored as data (`export_layouts`); every output an `export_files` version in the private `generated` bucket.

## Decision
Option 3. Totals checks are blocking (payment list total = batch/run total; journal Σ debit
= Σ credit). Bulk outputs (payslip zips, attachment bundles, my-data export) run as
`export_jobs`. Layout changes need SA approval (`export_layouts.approved_by`). Parallel-mode
payroll outputs are watermarked.

## Consequences
- (+) Supplying the AutoCount/HLB/statutory templates later is a configuration change, not a code change.
- (+) Outputs reproducible and auditable (version, checksum, generator).
- (−) Layout configuration must be validated against real sample files during the parallel run (Q41).
