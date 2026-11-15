# ADR-0007 — File storage: private buckets, registry-gated signed URLs, logged download grants

**Status:** Proposed · **Date:** 15/11/2026 · **Refs:** FR-G-12, F-EMP-18, F-CLM-06/26, LA11, Q18, BR-ADM-21, EC-CLM-09, EC-PRT-04, §8.4

## Context
MCs (health data), MyKad copies, bank proofs, receipts, documents and generated payment
lists/payslips must be private, access-checked on every download and logged. Phones
upload large photos (often HEIC). Direct Order hit a Server Action 1 MB body limit and an
RLS name-collision bug in Storage policies (its 0026).

## Options
1. Upload through Server Actions, serve through the server — simple, but large bodies and memory pressure on serverless.
2. **Direct browser ↔ Storage transfers with server-issued signed URLs**, authorised by an `app.files` registry: upload only to a pre-registered intent path; download only with a short-lived grant row whose insert is RLS-checked and logged by trigger.
3. Path-parsing Storage policies alone — couples authorisation to path strings and repeats complex rules in policy SQL.

## Decision
Option 2. Seven private buckets with `emp/<employee_id>/…` path conventions; Storage policies
call `app.storage_upload_allowed()` / `app.storage_read_allowed()` (qualified
`objects.name`); grants expire in 2 minutes, signed URLs in 60 seconds. Photos, logo and
privacy notice need no grant. HEIC converted in the browser (fallback server rendition);
images re-encoded on confirm; magic-byte sniffing; ≤ 10 MB; no UPDATE/DELETE for users.
No third-party malware scanning in R1.0 (Q-ARCH-05).

## Consequences
- (+) Every non-public download is authorised and logged by the database; manager MC access ends when the item is decided.
- (+) Large phone uploads bypass the server.
- (−) Two-step upload (intent → upload → confirm); orphaned intents cleaned by the retention job.
- (−) Residual malware risk accepted pending Q-ARCH-05.
