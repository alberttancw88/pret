# ADR-0004 — Approval engine: one task table, definer routing and decision, first decision wins

**Status:** Proposed · **Date:** 15/11/2026 · **Refs:** D12, F-LV-09/24/25/32, BR-LV-60–64, F-CLM-09/25/30, BR-CLM-20/25, F-EMP-19, PB8, F-PAY-23, FR-PAY-02, FR-G-16, EC-CLM-04

## Context
PRET has several approval shapes: multi-level leave workflows (default Direct Manager →
Admin) with delegation, re-routing and escalation; **single-level** claims decided by the
claimant's Manager **or** any ADM **or** any SA, whoever acts first (D12); ADM/SA pool for
change requests; SA-only approvals (optional disbursement batches, payroll runs,
statutory-table verification) with approver ≠ preparer. Nobody may decide their own item
in any role.

## Options
1. Separate approval logic and columns per module.
2. A workflow/BPM library or service — heavy, another runtime, harder to secure with RLS.
3. **One `approval_tasks` table** (one row per level per subject, typed subject FKs), routing in `app.route_approval()` and decisions in `app.decide_task()` — both `SECURITY DEFINER`, re-checking the caller, locking the subject row.

## Decision
Option 3.
- Sources: direct manager, leave-approver override, manager's manager, specific employee, Admin pool, SA pool, and the claim pool (manager/override/delegate + any ADM + any SA).
- Routing skips the applicant, applies delegation and on-leave re-routing, merges identical consecutive approvers, resolves top-of-org to SA (Q11).
- Decision: `select … for update` on task and subject, eligibility via `app.can_act_on_task()`, `status = 'open'` check → **first decision wins**; the loser gets "Already decided by … at dd/mm/yyyy HH:mm".
- Self-approval blocked in eight layers (`rls-policies.md` §7), including table CHECKs on `decided_by_employee_id` that a trigger fills from the session.
- Reminders/escalation by the daily job; no auto-approval.

## Consequences
- (+) One audit trail and one approvals inbox query for every module (F-PRT-11).
- (+) Concurrency-safe by row locks; idempotent on retry.
- (−) Two important definer functions concentrate risk — mitigated by the register, caller re-checks, pgTAP suites and GATE-3 security review.
- (−) Workflow definitions are limited to 3 levels and the listed sources (matches the PRD).
