# PRET — Non-Functional Design

**Work item:** W1-003 · **Author:** Solution Architect · **Status:** Proposed for GATE 2 (Design)
**Last updated:** 15/11/2026
**Meets:** PRD §15 (NFR-01 … NFR-13), FR-G-03/04/12/14, §8.4, §10.6 (Q29), BRD C2/C7; CLAUDE.md lessons (dd/mm/yyyy, RM 1,234.56)
**Companions:** [`system-design.md`](system-design.md) · [`data-model.md`](data-model.md) · [`rls-policies.md`](rls-policies.md) · ADR-0006, ADR-0009, ADR-0016

---

## 1. Formatting — one module, used everywhere (FR-G-03, FR-G-04, US-ADMIN-023)

All formatting and parsing lives in `src/lib/format/` and is the **only** way UI, CSV,
.xlsx, PDF and email templates render dates, times, money and days. Locale-dependent
`toLocaleString()` without explicit options is banned by lint.

| Value | Display | Parse / input | Storage | Notes |
|-------|---------|---------------|---------|-------|
| Date | `dd/mm/yyyy` (e.g. 05/03/2027) | date pickers and typed input accept **dd/mm/yyyy only**; imports reject other formats (EC-MIG-01) | `date` (a Malaysian calendar date; never shifted) | TS keeps business dates as `yyyy-mm-dd` strings (plain dates), never JS `Date`, to avoid midnight-UTC shifts. |
| Date-time | `dd/mm/yyyy HH:mm` 24 h, Asia/Kuala_Lumpur | — | `timestamptz` (UTC) | Audit viewer shows seconds (`HH:mm:ss`, AU1). |
| Month | `MMM yyyy` (e.g. Nov 2027) | month picker | `date` = 1st of month | Disbursement month, payroll period. |
| Money | `RM 1,234.56`; negative `-RM 1,234.56`; zero `RM 0.00`; right-aligned in tables | accepts `1234.56`, `1,234.56`, optional `RM`; max 2 dp | `numeric(14,2)` | MYR only (D3, Q22). |
| Rate per km | `RM 0.600/km` (3 dp) | 3 dp | `numeric(8,3)` | CC11. |
| Percentage | `13.0%` (as configured precision) | — | `numeric(7,4)` | EPF/HRDF rates (R1.1). |
| Leave days | `12.5 days` (1 dp) | ½-day steps | `numeric(5,1)` / ledger `numeric(6,1)` | FR-G-04. |
| MyKad | `******-**-5678` masked; `900101-14-5678` when revealed/own | 12 digits with or without dashes | encrypted + `last4` | FR-G-11, BR-EMP-01. |
| Bank account | `••••••1234` masked | digits | encrypted + `last4` | FR-G-11. |
| Phone | `+60 12-345 6789` | E.164 normalisation | `+60123456789` | BR-EMP-08. |

**Exports** (Q-ARCH-10 default): list CSVs use the display formats above (UTF-8 with BOM so
Excel opens them correctly); .xlsx uses real date cells formatted `dd/mm/yyyy` and numeric
money cells formatted `"RM "#,##0.00` (so totals still work); machine-import files for
HLB, AutoCount and statutory portals use the format their specification requires.

---

## 2. Time and timezone (NFR-10)

- Database server timezone stays **UTC**; every instant is `timestamptz`.
- "Today" for business rules = `app.today_myt()` = `(now() at time zone 'Asia/Kuala_Lumpur')::date` in SQL and `todayMyt()` in TS. Never `current_date` (UTC) in business logic.
- Effective dates switch at **00:00 MYT** (FR-EMP-07). Access ends at the end of the access-end date in MYT (BR-ADM-05) — enforced live by `app.current_app_user_id()`, so no job timing is involved.
- Scheduled jobs: Vercel Cron schedules are UTC; each job derives its MYT business date and is idempotent per (job, business date) with catch-up (ADR-0009). Malaysia has no daylight saving, so UTC offsets are fixed at +8.
- Working days for reminders/escalations use the **approver's** working pattern and PH calendar.

---

## 3. Money and rounding (NFR-08, BR-PAY-14, ADR-0006)

| Rule | Detail |
|------|--------|
| No floating point | Postgres `numeric`; TypeScript `decimal.js` (configured precision 34, `ROUND_HALF_UP`). Node-postgres returns `numeric` as strings; the DB layer maps them straight to `Decimal`. A lint rule forbids arithmetic on money typed as `number`. |
| Sen-exact default | Monetary results round **half away from zero to 2 dp** (Postgres `round(x, 2)` semantics; decimal.js `ROUND_HALF_UP`). Rounding happens **once per line**; totals are the sum of rounded lines (never re-rounded from unrounded sums). |
| Mileage | `amount = round(distance_km × rate_per_km, 2)` with the rate snapshotted at submission (BR-CLM-15) — also a CHECK constraint on `claim_lines`. |
| Claim totals | Header totals are sums of line amounts; batch totals are sums of claim totals; the HLB payment list total must equal the batch total (blocking). |
| Statutory amounts (R1.1) | Taken **as published** from verified band tables (no re-rounding); PCB/MTD rounding per the LHDN specification for the year, held as table parameters (`stat_parameters`), not code. |
| Net pay rounding (R1.1) | Off by default (PS9); if "nearest RM 0.05" is chosen, the difference is a visible payslip line. |
| Leave days | Pro-rating uses exact fractions (`numeric(10,6)` in `calc_detail`) then the configured rounding mode (LP4: up/nearest/down to ½, or EA rule) — stored results are always in ½-day steps (CHECK). |
| Determinism | Re-calculating a payroll run on the same snapshot and engine version yields identical figures (golden tests in CI). |

---

## 4. Performance and capacity (NFR-01, NFR-02, FR-PRT-03)

| Target | Design |
|--------|--------|
| 200 employees, 10 concurrent users, 10 years | Volumes in `data-model.md` §16 (largest table ≈ 2.5 M audit rows in 10 years) — comfortably within the smallest dedicated Supabase compute. |
| Lists/detail ≤ 2 s desktop, ≤ 3 s 4G (P95) | Vercel functions in **sin1** next to Supabase **ap-southeast-1** (single-digit ms round trips); RLS helpers wrapped in `(select …)` (initplan); covering indexes on every FK and filter; offset pagination with `count(*) over ()`; React Server Components stream above-the-fold content; MUI tree-shaken; images (receipts, photos) served via signed URLs with client-side thumbnails. |
| Employee home ≤ 3 s on 4G | Home queries limited to the employee's own summary rows (`leave_balance_summary`, last 3 claims, next PHs); no client data waterfalls. |
| Payroll run for 200 employees ≤ 60 s (R1.1) | Pure TS engine in-process; snapshot loaded in a handful of set-based queries; results inserted with multi-row inserts in one transaction. |
| CSV export of any list | Streamed (no full materialisation in memory). |
| Connection limits | Supavisor transaction-mode pooler for serverless; `prepare: false`; statement timeout 15 s for interactive requests, 300 s for jobs. |

Budgets are verified in Wave 3 with a synthetic 200-employee / 10-year dataset (no real data).

---

## 5. Availability, backup and recovery (NFR-03, NFR-04)

| Item | Design |
|------|--------|
| Availability ≥ 99.5 % | Managed Vercel + Supabase (Pro); no self-hosted components; planned maintenance announced 48 h ahead and done outside 08:00–20:00 MYT. |
| Database backups | Supabase Pro daily backups (RPO ≤ 24 h). Optional point-in-time recovery add-on (Q-ARCH-06). Weekly encrypted logical dump (`pg_dump`) to the off-site location so a deleted project is recoverable. |
| File backups | Supabase backups **do not include Storage objects** → nightly job copies new/changed objects (encrypted) to an off-site store in Singapore (Q-ARCH-06). |
| Encryption keys | Field-encryption keys escrowed offline (Q-ARCH-08); without them a restore cannot reveal MyKad/bank numbers. |
| RTO ≤ 8 h | Runbook: restore DB backup or dump into a new project in Singapore → restore Storage copy → set env + keys in Vercel → smoke tests. **Restore rehearsed before R1.0 and before R1.1 go-live** (NFR-04). |
| Payroll-period safety (R1.1) | Finalised runs are immutable; re-open creates a new version — a restore never loses which version employees were paid from. |

---

## 6. Retention (§10.6, Q29 defaults, F-ADM-16)

| Data | Retention | Mechanism |
|------|-----------|-----------|
| Employee master, job history, leave | 7 years after separation | `anonymisation_requests` (SA approves per employee) — removes identity, contact, family, bank, statutory numbers, documents and attachments; keeps aggregates |
| Payroll results, payslips, EA, statutory files (R1.1) | 7 years after the year of assessment | not anonymised before then |
| Claims and receipts | 7 years after payment | receipts deleted by `retention` job (`files.retention_delete_after`) |
| MC / medical attachments | 7 years, then deleted (aggregate days kept) | file retention date set at upload |
| MyKad copies, bank proofs | deleted at anonymisation | anonymisation job |
| Audit and access logs | 7 years from the event | `audit.purge_expired()` (only deletion path, logged; Q-ARCH-11) |
| Import source files and parsed rows | 30 days after commit | `retention` job |
| Expired upload intents, download grants | hours / minutes | `retention` job |
| Sessions, login events | 2 years (security investigation) | `retention` job |

Retention periods are SA-only settings (`security_settings`) — subject to the legal
adviser's confirmation (Q29).

---

## 7. Hosting and environments (R1, D14, NFR-06 — ADR-0016)

| Environment | Supabase project | Vercel | Data | Keys / email |
|-------------|------------------|--------|------|--------------|
| **dev** | local Supabase CLI stack (Docker) | `next dev` | **synthetic seed only** (`supabase/seed.sql`, generated names, MyKad-shaped test numbers that fail the JPN code check on purpose) | dev keys; email to a local catcher (Inbucket) |
| **staging** | `pret-staging`, ap-southeast-1 | preview/staging deployment, sin1, password-protected | synthetic only — **never a copy of production** | separate keys; email restricted to an allow-list of internal addresses |
| **prod** | `pret-prod`, ap-southeast-1 (Pro) | production, sin1 | real data (migrated from Kakitangan, R4) | production keys only in Vercel production env; real email |

- Migrations flow dev → staging → prod through CI (`supabase db push`), never ad-hoc SQL in production; Supabase security and performance advisors must be clean (or findings accepted in `rls-policies.md` §10) before promotion.
- Data API disabled (no exposed schemas) and `pg_graphql` disabled in staging and prod.
- Developers have no standing access to the production database; break-glass access is SA-approved and logged.
- Cross-border transfer basis for Singapore hosting is Interact's matter outside the system (D14, L-24).

---

## 8. Security controls

### 8.1 Transport and headers (NFR-05)

Set in middleware/`next.config` for every response:

| Header | Value |
|--------|-------|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'nonce-<per-request>' 'strict-dynamic'; style-src 'self' 'nonce-<per-request>'; img-src 'self' blob: data: https://<project>.supabase.co; connect-src 'self' https://<project>.supabase.co; font-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'` (Inter self-hosted via `next/font`) |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` (signed-URL links: `no-referrer`) |
| `Permissions-Policy` | `camera=(self), microphone=(), geolocation=(), payment=()` (camera for receipt/MC capture) |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cache-Control` | `no-store` on every authenticated page, Server Action and file response |

Cookies: `Secure; HttpOnly; SameSite=Lax`; Server Actions rely on Next.js origin checks
(allowed origins pinned to the production domain).

### 8.2 Rate limits (Postgres-backed fixed windows, `private.rate_limit_counters`)

| Action | Limit | On breach |
|--------|-------|-----------|
| Sign-in attempts | 5 per account per 30 min (lockout, F-ADM-13); 20 per IP per 10 min | lock + N-52; CAPTCHA required |
| Password reset / invite resend | 3 per account per hour | silent (no enumeration) |
| Server Actions (mutations) | 60 per user per minute | 429 |
| Sensitive reveals (MyKad/bank) | 30 per user per hour | blocked + in-app alert to SA |
| Exports and file grants | 30 per user per 10 min | 429 |
| Uploads (intents) | 30 per user per 10 min | 429 |
| Job endpoints | shared secret + Vercel Cron header; 1 concurrent run per job (advisory lock) | 403 / skip |

### 8.3 Other controls

- **Secrets**: Supabase service-role key, DB passwords, field-encryption and blind-index keys, email API key and cron secret only in Vercel encrypted env (per environment); never in the repo; `.env*` git-ignored (CLAUDE.md); `info-blank.txt` never read.
- **Dependencies**: lockfile committed; automated vulnerability alerts; no runtime CDN scripts.
- **Logging / observability (NFR-12)**: structured server logs with request id; **no personal data** in logs or error reports (scrubbing of request bodies, emails, NRIC/bank patterns); error monitoring configured with PII scrubbing and Singapore/EU data region where offered; job logs in `job_runs`.
- **Accessibility (NFR-07)** and browser support (NFR-11, §8.4): owned by UX/UI lanes; architecture supplies server-rendered pages that work at 360 px and keyboard-only navigation.

---

## 9. NFR → mechanism traceability

| NFR | Mechanism | Where |
|-----|-----------|-------|
| NFR-01 capacity | volumes, indexes, small compute | `data-model.md` §16, §4 here |
| NFR-02 performance | co-located regions, initplan RLS, streaming, pure engines | §4 |
| NFR-03 availability | managed services, maintenance window | §5 |
| NFR-04 backups | DB backups + dump + Storage copy + rehearsed restore | §5, Q-ARCH-06 |
| NFR-05 security | TLS/HSTS, headers, RLS, encryption, MFA, rate limits | §8, `rls-policies.md`, ADR-0003 |
| NFR-06 residency | Singapore for DB, files, functions | §7, ADR-0016 |
| NFR-07 accessibility | UX/UI lanes | §8.3 |
| NFR-08 calculation integrity | decimal everywhere, rounding rules, deterministic engine | §3, ADR-0006, ADR-0013 |
| NFR-09 concurrency & idempotency | idempotency keys, advisory locks, exclusion constraint, first-decision-wins | `system-design.md` §4–6, ADR-0015 |
| NFR-10 time & jobs | MYT business dates, idempotent catch-up jobs, SA alerts | §2, ADR-0009 |
| NFR-11 browsers | responsive from 360 px | UX/UI |
| NFR-12 observability | PII-free logs, job_runs, heartbeat | §8.3 |
| NFR-13 email deliverability | SPF/DKIM/DMARC, provider adapter | `system-design.md` §7, ADR-0010 |
