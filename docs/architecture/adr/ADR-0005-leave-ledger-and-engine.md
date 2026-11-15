# ADR-0005 — Leave: append-only ledger, per-day application rows, pure TypeScript engine

**Status:** Proposed · **Date:** 15/11/2026 · **Refs:** F-LV-04/06/19/20/21/28, BR-LV-11–27, BR-LV-52/53, BR-LV-70–84, D13, EC-LV-01–14

## Context
Balances combine entitlement (service bands, pro-rating, rounding, EA floor, overrides),
carry-forward with expiry, replacement credits (FIFO, expiry), adjustments, taken and
pending (BR-LV-20). Holidays can change after approval (recount), applications can span
two leave years, unpaid days feed payroll by month (R1.1), and overlap must be impossible
even with double-taps on a slow phone.

## Options
1. A mutable "balance" number per employee/type/year — fast but untraceable and race-prone.
2. **Append-only ledger** (`leave_ledger`) + per-date application rows (`leave_application_days`) + a trigger-maintained summary cache; calculations in a pure TS engine; overlap prevented by an exclusion constraint.
3. All calculation in PL/pgSQL — hard to unit-test, duplicates TS validation used by forms and imports.

## Decision
Option 2.
- Ledger entry types: entitlement (incl. recompute deltas), carry_forward, credit_earned, taken, taken_reversal, adjustment, expired, forfeited; opening balances flagged `is_opening`.
- `leave_application_days` stores weight per date (pattern, PH calendar of the work state, sessions) and an `int4range` AM/PM slot under a GiST **exclusion constraint** while the application blocks.
- Balance checks run under a per-employee advisory lock; accrual "earned to date" is computed at read time at the last leave day (BR-LV-14).
- Carry-forward consumption judged by leave date ≤ expiry (Q-ARCH-03).

## Consequences
- (+) Every balance is explainable line by line (F-LV-28); recounts and roll-over are reversible and idempotent.
- (+) Overlaps impossible at the database level; monthly unpaid days directly available to payroll.
- (−) Summary cache must be kept consistent by triggers (tested; rebuildable by a maintenance function).
- (−) Engine and database must share calendar inputs exactly — single calendar resolver used by every path.
