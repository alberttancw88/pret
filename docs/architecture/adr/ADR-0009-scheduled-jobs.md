# ADR-0009 — Scheduled jobs: Vercel Cron → Next.js handlers, MYT business dates, idempotent with catch-up

**Status:** Proposed · **Date:** 15/11/2026 · **Refs:** NFR-10, BRD H3, FR-EMP-07/09, F-ADM-06, F-LV-20/25, F-NTF-03/04, F-ADM-12

## Context
Status changes at 00:00 MYT, future-dated job changes, carry-forward and credit expiry,
reminders/escalations, alerts, access expiry, outbox and export draining must run on time
in Asia/Kuala_Lumpur, be idempotent, and alert SA on failure. The leave and payroll engines
are TypeScript.

## Options
1. **Vercel Cron calling Next.js route handlers** (shared code with the engines).
2. Supabase `pg_cron` + `pg_net` calling the same handlers, or running SQL-only jobs inside the database.
3. Supabase Edge Functions (Deno) — would duplicate the TS engines in a second runtime (Direct Order's ADR-0003 choice; less suitable here).

## Decision
Option 1. Each job: shared-secret check, advisory lock (one concurrent run), MYT business
date, `job_runs` row unique per (job, date) on success, **catch-up** for every missed date,
`pret_jobs` connection with `actor_label = 'system:<job>'`, failure → SA in-app + email,
hourly heartbeat. Schedules in `system-design.md` §9 (UTC cron for MYT times).

## Consequences
- (+) One language and codebase for engines and jobs; jobs are testable like Server Actions.
- (+) Missed or failed runs self-heal on the next run.
- (−) Requires Vercel Pro for minute-level crons; function duration limits are ample at 200 staff.
- (−) Access expiry does not depend on the job at all (checked live — ADR-0001), so a missed job cannot extend access.
