# ADR-0003 — Sensitive data: vertical partitioning by audience + application-layer encryption of identifiers + logged reads

**Status:** Proposed · **Date:** 15/11/2026 · **Refs:** FR-G-10/11, F-EMP-20, BR-EMP-21, BR-ADM-21, §3 (MGR restrictions), NFR-05, PDPA s4/s9 (L-15, L-18), D14, D15

## Context
The PRD sets visibility per **field** (e.g. a manager sees a reportee's phone and position
but never MyKad, bank, family, statutory numbers or religion; peers see only directory
fields). Postgres RLS filters **rows**, not columns. MyKad and bank numbers must be masked
by default with logged reveal; religion/OKU views by HR must be logged; the outsourced
Admin sees everything by role — so "protected at the database" must also hold against a
leaked backup or an over-broad query.

## Options
1. One wide employee table + UI/DTO column hiding — fails "not just the UI".
2. Security-definer views that mask columns per caller — works but scatters authorisation into view code and trips advisor errors; still plaintext at rest.
3. **Vertical partitioning by audience** (tiers T0–T5) so each table's RLS matches one audience; **application-layer AES-256-GCM** for identifier columns (keys outside the database) with last-4 and HMAC blind index; special-category data readable by HR only through a definer function that writes the access log in the same transaction.
4. Database-side encryption (pgsodium Transparent Column Encryption) — Supabase no longer recommends it for new projects, and the key would sit in the same trust domain as the data.

## Decision
Option 3.
- **Tiers**: T0 directory (all), T1 team (self/manager/approver/HR), T2 self + HR, T3 HR only, T4 special category (self direct; HR via logged functions), T5 security (SA). Each PRD field lives in the table of its audience (`data-model.md` §2).
- **Encrypted identifiers (S1)**: employee/spouse/child MyKad, bank and ASNB account numbers, HLB paying account. Associated data binds ciphertext to table/column/row. Plaintext only in the server, for the owner or after a reasoned, logged reveal.
- **Not encrypted**: salary and payroll figures (must be summed and calculated) — protected by T2 RLS and absence of any manager policy.
- **Logged reads in the database** for T4 and for every file download (grant table + trigger).

## Consequences
- (+) A manager or peer cannot obtain T2–T4 data through any path; a database dump without the keys does not reveal MyKad/bank numbers.
- (+) Masking is structural, reveal logging cannot be skipped by the UI.
- (−) More tables/joins; profile loads compose several queries (views help).
- (−) Key management: escrow, rotation, per-environment keys (Q-ARCH-08); no SQL search on identifiers beyond last 4 and exact-match blind index.
- (−) Non-sensitive column differences within T1 (emergency-contact email, job remarks) remain DTO-projected — listed and tested (`rls-policies.md` §8).
