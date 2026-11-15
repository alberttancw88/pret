# ADR-0008 — Audit trail and access log: database triggers, append-only privileges, daily seals

**Status:** Proposed · **Date:** 15/11/2026 · **Refs:** F-ADM-09/10/11/17, BR-ADM-20–24, FR-G-09, F-EMP-21/28, F-PAY-41

## Context
Every create/update/status change needs before/after values; every sensitive view, reveal,
download and export needs an access-log row; external-administrator sessions log every
record opened; nobody — including SA — may edit or delete log entries through the app.

## Options
1. Application-written audit — easy to forget on a new code path.
2. **Generic trigger `audit.tg_log_change()` on every business table** with request context passed via `set_config` (actor, reason, on-behalf, IP, request id), plus `audit.access_log` written by database triggers (file grants, T4 reads) and a narrow definer function for server-side events (reveals, exports, record opens).
3. Supabase platform logs / pgAudit only — not queryable by SA in-app, no business context.

## Decision
Option 2. `audit` schema with no UPDATE/DELETE/TRUNCATE privilege for any login role
(`service_role` included); inserts only through `audit_writer`-owned functions; SA-only
read. Nightly SHA-256 chain per day (`audit.daily_seals`) for tamper evidence. Retention
7 years via `audit.purge_expired()` — the only deletion path, itself logged.

## Consequences
- (+) Coverage by construction; reasons and on-behalf context in every row.
- (+) Breach-readiness and DSR extracts query one place (GIN on data subjects).
- (−) Database superuser can still alter rows — detectable via seals, not preventable; acceptable for a managed platform.
- (−) Audit rows hold personal data for 7 years (Q-ARCH-11).
