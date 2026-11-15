# Architecture Decision Records — PRET

Each ADR records one significant decision: context, options, decision, consequences.
**Proposed** = awaiting Albert at GATE 2; **Accepted** = confirmed at GATE 2.
Numbering is PRET's own (Direct Order's ADRs are referenced by name, e.g. "Direct Order ADR-0008").
A UI-theme ADR, if the UI lane needs one, will take the next free number.

| ADR | Decision | Status | Main refs |
|-----|----------|--------|-----------|
| [0001](ADR-0001-roles-and-authorisation.md) | Four roles (D11) resolved live per statement; MGR derived from reporting-line closure; external user = ADM with access window; MFA (aal2) for privileged rights | Proposed | D11, F-ADM-03/04/07, BR-ADM-06 |
| [0002](ADR-0002-data-access-path.md) | Server-only data access: direct Postgres with user impersonation (RLS active); no Data API | Proposed | FR-G-02, NFR-09 |
| [0003](ADR-0003-sensitive-data-protection.md) | Vertical partitioning by audience (tiers T0–T5) + AES-256-GCM identifier encryption outside the DB + logged reads | Proposed | FR-G-10/11, BR-ADM-21, §3 |
| [0004](ADR-0004-approval-engine.md) | One `approval_tasks` table; definer routing/decision; first decision wins; eight-layer no-self-approval | Proposed | D12, F-LV-09/24, F-CLM-09, FR-G-16 |
| [0005](ADR-0005-leave-ledger-and-engine.md) | Append-only leave ledger, per-day rows with exclusion constraint, pure TS leave engine | Proposed | F-LV-04/06/19/20, BR-LV-20/52 |
| [0006](ADR-0006-money-and-rounding.md) | `numeric` + decimal.js; round half away from zero once per line; sen-exact | Proposed | FR-G-04, NFR-08, BR-PAY-14 |
| [0007](ADR-0007-file-storage.md) | Private buckets; registry-gated signed upload/download; logged grants; HEIC handling | Proposed | FR-G-12, Q18, EC-CLM-09 |
| [0008](ADR-0008-audit-and-access-log.md) | Trigger-based audit, append-only privileges, daily seals, 7-year retention | Proposed | F-ADM-09–11, BR-ADM-20 |
| [0009](ADR-0009-scheduled-jobs.md) | Vercel Cron → Next.js handlers; MYT business dates; idempotent with catch-up | Proposed | NFR-10 |
| [0010](ADR-0010-notifications-outbox.md) | In-app first + transactional email outbox; PDPA-safe templates; DB-raised bank-change alert | Proposed | F-NTF-01–08, D15 |
| [0011](ADR-0011-exports-and-documents.md) | Server-side CSV/.xlsx/PDF; external layouts as configuration; versioned outputs | Proposed | F-CLM-15/27, F-PAY-28/38, D6, D10 |
| [0012](ADR-0012-migration-import.md) | In-app staged import with shared validators, dry run, all-or-nothing commit, reconciliation | Proposed | F-MIG-01–19, D9, R4 |
| [0013](ADR-0013-payroll-engine.md) | R1.1 pure TS payroll engine; verified dated statutory tables; snapshot runs; parallel-run reconciliation | Proposed | D5, F-PAY-*, NFR-08 |
| [0014](ADR-0014-authentication-and-sessions.md) | Supabase Auth + own 72 h invites, lockout, TOTP MFA, role-based idle timeout | Proposed | R3, Q31, F-ADM-13/14 |
| [0015](ADR-0015-reference-numbers-idempotency-concurrency.md) | Doc counters, idempotency keys, advisory locks, optimistic versions | Proposed | FR-G-15, NFR-09 |
| [0016](ADR-0016-hosting-environments-backups.md) | Singapore hosting, dev/staging/prod isolation, off-site file copy, restore rehearsal | Proposed | R1, NFR-03/04/06 |
