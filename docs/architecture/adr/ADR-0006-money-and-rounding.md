# ADR-0006 — Money: exact decimals end to end, round once per line, sen-exact

**Status:** Proposed · **Date:** 15/11/2026 · **Refs:** FR-G-04, NFR-08, BR-CLM-11/15, BR-PAY-14, D5 (reconcile to the sen), CLAUDE.md (RM 1,234.56)

## Context
Payroll must reconcile to Kakitangan to the sen before cut-over (D5); claims, batches and
payment lists must total exactly. JavaScript `number` is binary floating point.

## Options
1. Integers in sen everywhere — exact, but rates (RM/km, percentages) and PCB formulas need fractional intermediates.
2. **`numeric` in Postgres + `decimal.js` in TypeScript**, explicit rounding rules.
3. Floats with rounding at display — rejected.

## Decision
Option 2. Money `numeric(14,2)`; rates `numeric(8,3)` / `numeric(7,4)`; leave days
`numeric(5,1)`. Node-postgres numerics are mapped straight to `Decimal` (never through
`number`). Default rounding: **half away from zero to 2 dp, once per line**; totals = sum of
rounded lines; mileage `round(km × rate, 2)` (also a CHECK); statutory amounts as published
from verified tables; PCB rounding from the year's LHDN parameters. Display through one
formatter: `RM 1,234.56`.

## Consequences
- (+) Deterministic, auditable figures; payroll recalculation reproduces results to the sen.
- (−) Developers must use the Decimal type and formatter consistently — enforced by lint and code review.
