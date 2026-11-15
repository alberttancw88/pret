# ADR-0015 — Reference numbers, idempotency and concurrency

**Status:** Proposed · **Date:** 15/11/2026 · **Refs:** FR-G-15, EC-LV-09, EC-PRT-01, EC-CLM-02/04, BR-CLM-25, BR-LV-52/53, NFR-09; Direct Order ADR-0004/0005/0011

## Context
Human-readable numbers (`LV-yyyy-nnnnn`, `CL-yyyy-nnnnn`, `PB-yyyy-nnn`, `CR-yyyy-nnnnn`,
`RL-yyyy-nnnnn`, `IM-yyyy-nnn`, `PR-yyyy-mm-nn`) must be unique and never reused.
Double-taps on slow phones must not duplicate items. Limit and balance checks must hold
under concurrent submissions; two approvers acting at once must produce one decision.

## Decision
- **Numbers**: `private.next_doc_no(doc_type, year)` — `update … set last_no = last_no + 1 returning` inside the business transaction (row lock); a rolled-back transaction may skip a number (never reuses one).
- **Idempotency**: client-generated `idempotency_key` per form instance, `unique` on leave applications, claims, credits and change requests; on conflict the existing row is returned.
- **Per-employee serialisation**: `pg_advisory_xact_lock` on `leave:<employee>` / `claim:<employee>` around balance and limit checks.
- **Overlap**: GiST exclusion constraint on leave days (ADR-0005).
- **Decisions**: row lock + `status = 'open'` (ADR-0004); mutable workflow rows carry `version` for optimistic locking of edits.

## Consequences
- (+) Correct under concurrency without application-level mutexes; safe retries.
- (−) Gaps in sequences are possible after rollbacks (acceptable: "never reused", not "gap-free").
