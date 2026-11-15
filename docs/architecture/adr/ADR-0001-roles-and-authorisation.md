# ADR-0001 — Roles and authorisation: four roles, looked up live

**Status:** Proposed · **Date:** 15/11/2026 · **Refs:** D11, D14, PRD §3, §16, F-ADM-03/04/06/07, BR-ADM-04/06, FR-G-02

## Context
D11 fixes four roles: Super Admin (SA), Admin (ADM — HR, claims, payroll in one role),
Manager (MGR — of their reportees) and Employee (EMP). The outsourced administrator is an
external (non-employee) user holding ADM with an access window. Disabling a user must end
access within 5 minutes (BR-ADM-06). MFA is required for privileged roles (Q31). Direct
Order put roles into JWT custom claims and accepted staleness until token refresh
(its ADR-0006) — and hit an Auth-hook bug that blocked every sign-in (its migration 0019).

## Options
1. **JWT custom claims** (roles, reportee ids) injected by an Auth hook — fast, but stale until refresh; reportee lists in a token grow and go stale on every reporting-line change.
2. **Live lookup per statement** via `SECURITY DEFINER` helper functions over `app_users`, `user_roles`, `reporting_closure`, `approval_tasks`, `delegations`.
3. Application-only role checks with a service-role database connection — no database backstop (rejected: FR-G-02).

## Decision
Option 2.
- **SA / ADM**: explicit rows in `user_roles`, granted only by SA (CHECK not self-grant; ≥ 1 active SA by trigger). Effective only at `aal2` when MFA is required.
- **EMP**: implicit for every active employee user (`app_users.user_type = 'employee'`).
- **MGR**: derived from `reporting_closure` (direct + indirect, rebuilt whenever a job-history row becomes current). Decision rights come from routed approval tasks (reporting manager, F15/F16 override approver, active delegate).
- **External user**: `user_type = 'external'`, ADM only, `access_start_date … access_end_date` checked live; never manager or delegate.
- The JWT contributes only `sub` and `aal`. No custom access-token hook.

## Consequences
- (+) Disable, expiry, role revocation and reporting-line changes apply on the next statement — no token refresh, no stale reportee lists.
- (+) No Auth hook to break sign-in.
- (−) One small indexed lookup per statement (negligible at 200 staff; `(select fn())` initplan wrapping).
- (−) Helpers must be `SECURITY DEFINER` (to avoid RLS recursion) — they take no user-id parameter, are pinned and listed in `rls-policies.md` §10.
