# ADR-0002 — Data access path: server-only, direct Postgres with user impersonation; no Data API

**Status:** Proposed · **Date:** 15/11/2026 · **Refs:** D7, FR-G-02, NFR-09, PRD §2.2; Direct Order system-design §1

## Context
PRET holds the most sensitive data Interact has (MyKad, bank, salary, health, religion).
Supabase's default exposes every table in exposed schemas through PostgREST/GraphQL to
anyone holding the public anon key plus a user JWT — so RLS alone stands between a
curious employee and the database. Approvals, disbursement and payroll need
multi-statement transactions; supabase-js cannot run a transaction except inside a
database function, which pushes logic into many `SECURITY DEFINER` functions (Direct
Order's recurring bug class: 0019/0020/0021/0026/0028).

## Options
1. **supabase-js through PostgREST** (Direct Order pattern) + RPC functions for multi-step writes.
2. **Server-only direct Postgres**: Next.js connects through the Supavisor pooler as `pret_app`, and each request runs in a transaction that does `SET LOCAL ROLE authenticated` and sets the **JWKS-verified** claims, so `auth.uid()` and RLS behave exactly as for PostgREST. Data API exposes no schema.
3. Service-role connection with authorisation only in TypeScript (rejected — no database backstop).

## Decision
Option 2. All business reads/writes go through `withUserTx(session, fn)` (typed queries via
Kysely). Jobs use `withJobTx` as `pret_jobs` (service role) with an `actor_label`. The
browser uses Supabase only for Auth cookies and direct Storage transfers with server-signed
URLs. PostgREST/GraphQL expose nothing (`pg_graphql` disabled); RLS stays complete anyway.

## Consequences
- (+) No public data API; attack surface = authenticated Next.js routes and Server Actions.
- (+) Real transactions in TypeScript with RLS active → fewer definer functions; the remaining ones are registered and tested.
- (+) RLS remains the backstop: a missing `where` in server code still cannot leak another employee's row.
- (−) Departs from Direct Order's client pattern; requires transaction-mode pooling (`prepare: false`) and a lint rule banning raw pool use.
- (−) The server sets claims — it must only ever pass claims from a verified JWT (single helper, tests). A compromised server is out of scope for RLS (as with any service-role design).
