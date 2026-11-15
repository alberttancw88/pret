# ADR-0013 — Payroll calculation engine (R1.1): pure TypeScript engine, verified dated tables, snapshot-based runs

**Status:** Proposed · **Date:** 15/11/2026 · **Refs:** D5, D6, D10, D16, F-PAY-01–42, BR-PAY-01–19, NFR-02, NFR-08, FR-PAY-02/10, Q41–Q44

## Context
R1.1 computes EPF, SOCSO (+ SKBBK), EIS, PCB/MTD (LHDN computerised method incl.
additional remuneration, zakat offset), HRDF, PTPTN, CP38, proration, unpaid leave and
claims; it must reproduce Kakitangan to the sen during a 2–3 month parallel run, from
statutory tables that change by effective date and are never hard-coded.

## Options
1. PL/pgSQL calculation in the database — transactional, but the PCB method is long and hard to unit-test; poor traceability tooling.
2. **Pure TypeScript engine** (`src/domain/payroll`, decimal.js, no I/O) executed by the server inside the run's transaction, fed by a persisted input snapshot.
3. A separate payroll microservice — extra runtime and hosting outside the fixed stack.
4. Third-party payroll API — contradicts in-house payroll and adds a personal-data processor.

## Decision
Option 2.
- **Inputs**: effective-dated compensation and recurring items; statutory profile; table versions **verified by SA ≠ entered by** with the version effective for the payroll month; unpaid days and claims from R1.0 tables; TP1/TP3/CP38; YTD (live or parallel scope, opening balances from T14).
- **Snapshot** per employee (`payroll_run_employees.input_snapshot` + hash) and `ENGINE_VERSION` ⇒ deterministic recalculation; every figure carries a `calc_trace`.
- **Lifecycle** Draft → In Review → Pending Approval → Approved (SA, ≠ preparer) → Finalised → (SA re-open, version + 1).
- **Parallel mode** isolated (own YTD scope, watermark, no publish, no claim status change); reconciliation per element to the sen against imported Kakitangan results.
- **Golden tests** in CI from anonymised Kakitangan payslips (Q44); payroll specialist verifies tables before R1.1 GATE 3.

## Consequences
- (+) Fast, unit-testable, traceable; 200 employees well within 60 s.
- (+) Statutory changes are data with maker-checker, not deployments.
- (−) Engine correctness depends on the yearly LHDN specification being transcribed into parameters correctly — mitigated by golden tests and the parallel run.
