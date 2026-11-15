# ADR-0016 — Hosting, environments and backups: Singapore, three isolated environments, off-site file copy

**Status:** Proposed · **Date:** 15/11/2026 · **Refs:** R1, D7, D14, NFR-03/04/06, R4, CLAUDE.md (secrets, synthetic data)

## Context
Data stays in Singapore (R1, D14). Real employee data must never reach the repository,
tests or non-production environments (R4). NFR-04 requires daily backups of the database
**and files** with RPO ≤ 24 h, RTO ≤ 8 h and a tested restore before each go-live.
Supabase managed backups cover the database, not Storage objects.

## Decision
- **Hosting**: Supabase `ap-southeast-1` (Pro plan) and Vercel functions pinned to `sin1`.
- **Environments**: dev (local Supabase CLI, synthetic seed), staging (`pret-staging`, synthetic only, allow-listed email), prod (`pret-prod`). Separate keys per environment; production keys only in Vercel production env. Never copy production data down.
- **Backups**: Supabase daily backups; weekly encrypted logical dump and nightly encrypted copy of new Storage objects to an off-site Singapore location (second Supabase project or S3 ap-southeast-1 — Q-ARCH-06); PITR optional. Encryption keys escrowed offline (Q-ARCH-08). Restore rehearsed before R1.0 and R1.1.
- **Changes**: migrations through CI only; advisors clean before promotion; no standing developer access to production.

## Consequences
- (+) Residency, isolation and recoverability meet the PRD.
- (−) The off-site copy adds one storage location and a nightly job to operate (decision Q-ARCH-06).
