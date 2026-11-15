# ADR-0010 — Notifications: in-app first, transactional email outbox, PDPA-safe templates

**Status:** Proposed · **Date:** 15/11/2026 · **Refs:** F-NTF-01–08, BR-NTF-01–07, N-01…N-59, NFR-13, D15 (N-41); Direct Order ADR-0008

## Context
About 50 events notify employees, approvers, ADM and SA in-app and by email. Email must
never contain NRIC, bank numbers, salary, diagnosis, religion, family details or
attachments. The bank-change alert (N-41) is the main compensating control for D15 (no
confirmation step) and must never be skipped.

## Options
1. Send email inline in the request — couples user actions to provider latency/failure.
2. **Write `notifications` + `email_outbox` rows in the same transaction as the business change; a worker sends with retries.**
3. Email only — no durable in-app record.

## Decision
Option 2 (same principle as Direct Order). Templates in code with a whitelist of payload
keys per template and a test that rejects sensitive fields; retries with back-off then
`failed` → SA alert; FYI opt-out only; daily digest for approvers; N-41 raised by a
database trigger on `employee_bank_accounts` to work **and** personal email and every SA.
Provider behind an adapter (Q-ARCH-09); SPF/DKIM/DMARC; Supabase Auth emails via custom SMTP.

## Consequences
- (+) No lost notifications; outbox doubles as the notification log (F-NTF-07).
- (+) PDPA-safe content enforced in code and tests, fraud alert enforced in the database.
- (−) One-minute delivery latency from the worker cadence — acceptable for HR workflows.
