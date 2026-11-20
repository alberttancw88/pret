# Changelog

All notable changes to PRET (Interact's internal HR & Payroll system) are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versioning follows
[Semantic Versioning](https://semver.org/). **Every commit is tagged with a version.**

Convention: `PATCH` bumps per commit · `MINOR` bump at each wave/gate milestone ·
`MAJOR` stays `0` until Phase-1 production launch (`1.0.0`).

## [Unreleased]

## [0.2.8] — 2026-11-20 — W2-004 Leave management built
### Added
- Leave setup (ADM/SA): leave types with Employment Act minimum warning, service-band
  entitlements, policy settings, approval workflows; statutory leave types seeded (D13).
- Leave engine (in the database, mirrored in TypeScript): working-day count by pattern and
  state holidays, half days, pro-rating, sick + hospitalisation 60-day pool, maternity 98 /
  paternity 7, overlap and back-date checks, EMERGENCY flag, ledger-only balances, carry-forward
  and credit expiry, year-end roll-over with preview, leaver final balance.
- Generic approval engine (ADR-0004) for leave now and claims next: multi-level workflows,
  delegation with re-routing, reassign, reminders and escalation, bulk decisions; no
  self-approval (incl. delegates) enforced in the database.
- Screens: admin L1–L14; employee apply / my leave / balances / ledger / replacement credits /
  calendar; approvals inbox and decision views; Home leave tiles; phone layouts.
- From W2-003: profile Leave tab, opening balances on new-employee wizard, leaver leave on
  separation, team leave columns.
- Nightly pg_cron job `pret-leave-daily` (00:10 MYT).
- Database: 8 migrations on `pret-dev` (22 new tables, RLS forced on all); synthetic leave
  seed for sample employees only.
- Tests: W2-004 role matrix 130/130, W2-003 90/90, W2-002 91/91, foundation 86/86, unit 82/82.
- Decision D30: W2-004 open questions accepted at their defaults.
### Deferred
- Claims parts of Home/inbox → W2-005; notification delivery, leave reports, XLSX export → W2-007;
  My public holidays (P11) and delegation tab (G6) → W2-006.
### Known gaps
- Not yet exercised in a browser. No published public-holiday calendar on pret-dev yet, so
  holidays are not deducted until one is published.

## [0.2.7] — 2026-11-19 — Cron key live, Super Admin employee record
### Changed
- `CRON_SECRET` set in Vercel; `/api/cron/daily` now rejects unauthenticated calls (401).
- pret-dev: Super Admin's own employee record created with the reserved id (via
  `supabase/seed/owner_employee.mjs`, MyKad encrypted, output never saved); FK
  `fk_app_users_employee` validated; grade, position and Petaling Jaya work location added.
- Backlog log updated (no personal data in the repo).

## [0.2.6] — 2026-11-19 — W2-003 Employee master records built
### Added
- Employee records (M1, ADM/SA): employee list with completeness, 6-step new-employee wizard
  (MyKad validation, DOB/gender derivation, duplicate check), 15-tab profile, job changes
  (effective-dated, future-dated applied nightly), probation, separation, withdraw resignation,
  rehire, documents (private Storage, logged downloads), bank details (D15), statutory and PCB
  relief profile, HR notes, change history and activity log, change-request queue and review,
  bulk update via CSV, bulk actions; NRIC and bank numbers encrypted with blind index (ADR-0003),
  masked, logged reveal.
- Self-service and team: My profile, request a change (all 9 categories), my change requests,
  my documents, team list and limited team-member profile with probation recommendation, staff
  directory, org chart.
- From W2-002: department head, O8 reporting lines (reassign, CSV), group members (incl. add by
  department/location), employee-user invites; F-ADM-06 leavers lose access automatically.
- Jobs: nightly pg_cron job (00:05 MYT); Vercel cron `/api/cron/daily` (00:15 MYT) sends scheduled
  invitations, protected by `CRON_SECRET`.
- Database: 7 migrations on `pret-dev` (26 new tables, RLS forced on all); synthetic seed of 8
  sample employees (generator `supabase/seed/w2_003_employees.mjs`); owner-record script
  `supabase/seed/owner_employee.mjs`.
- Tests: W2-003 role matrix 90/90, W2-002 91/91, foundation 86/86, unit 58/58.
- Decision D29: W2-003 open questions accepted at their defaults.
### Deferred
- Leave tab and leaver leave → W2-004; Claims tab → W2-005; compensation → R1.1; notification
  delivery → W2-007; privacy A12–A14 → later item.
### Known gaps
- Not yet exercised in a browser. `CRON_SECRET` not yet set in Vercel. Super Admin's own
  employee record not yet created (FK `fk_app_users_employee` still NOT VALID).

## [0.2.5] — 2026-11-19 — Token lifetime decision, personal-folder rule
### Added
- Decision D28: Supabase access-token lifetime stays at 1 hour (replaces 10 minutes in
  ADR-0014); PRET's live role checks and idle sign-out still apply.
- `CLAUDE.md` rule and `.gitignore` entry: Albert's personal folder is never read or committed.
### Changed
- Dev setup guide step 6 closed (D28); backlog log: idle sign-out confirmed on the live site.

## [0.2.4] — 2026-11-19 — PRET live on Vercel
### Added
- Decision D27: Supabase and Vercel on free tiers only, for dev and the live version
  (replaces the Pro plans in D20/D25); PRET's own backup job becomes mandatory before go-live.
### Changed
- PRET deployed to https://pret-zeta.vercel.app (Vercel Hobby, Singapore) from `main`;
  Vercel project re-linked to `alberttancw88/pret`; Supabase Auth Site URL and redirect URLs
  set for the live address. First live sign-in with MFA verified.
- Backlog log: Vercel setup, environment-variable mix-up and clean-up, MFA re-enrolment.
### Known gaps
- Security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) not yet
  set (for GATE 3). 600-second session expiry not yet verified.

## [0.2.3] — 2026-11-17 — MFA enrol fix, dev setup complete, Vercel ready
### Fixed
- Admin or Super Admin without an authenticator was sent to the code-entry screen instead of
  the QR enrolment screen; `/mfa` now enrols whenever no factor exists.
### Added
- Decision D26: PRET hosted on Vercel Hobby, including the live version (replaces Vercel Pro
  in D20).
- Vercel deployment prep: database CA cert can be supplied as base64 in `DATABASE_CA_CERT`.
### Changed
- Dev setup guide: CA cert, secret key, Data API off and first Super Admin marked done.
- First browser sign-in verified (Super Admin, MFA aal2).
### Known gaps
- Password-reset sign-in does not write a login-history row (for GATE 3).

## [0.2.2] — 2026-11-16 — W2-002 Organisation setup + Users & access built
### Added
- Organisation (M5, ADM/SA): company profile and statutory employer numbers, departments,
  positions, grades, work locations, working-week patterns (versioned, ≥ 1 rest day),
  public-holiday calendars (replacement holidays, company/special holidays, copy to next year,
  publish checks), cost centres, employee groups, system settings.
- Users & access (M6): user list, invite external administrator, assign/revoke Admin and
  Super Admin, access window, deactivate/reactivate/unlock, password and MFA reset, login
  history, role permission reference, audit & access log viewer (SA, masked values with
  logged reveal), monthly access review, company privacy notice.
- Shared contract `src/server/contracts/` (zod schemas, types, function register) used by
  both lanes; queries and Server Actions with role checks, audit and access logging.
- Database: 6 migrations on `pret-dev` (18 tables, RLS forced on all), guards for self-role
  changes, last Super Admin, rest days, unique codes; synthetic sample seed.
- Tests: W2-002 role matrix 91/91, foundation 86/86, unit 40/40.
- Invitation emails via Resend (`RESEND_API_KEY`, `PRET_EMAIL_FROM` in `.env.example`).
- Pret-dev setup progress: database CA cert installed, first Super Admin bootstrapped.
### Deferred
- To W2-003: department head, reporting lines, employee-user invite, auto-deactivate
  leavers, privacy A12–A14. Import of GL list and holidays with M9. All-users privacy-notice
  page (S-GL-09).
### Known gaps
- Not yet exercised in a browser (waits on the remaining pret-dev setup steps).

## [0.2.1] — 2026-11-16 — W2-001 Foundation built
### Added
- Next.js 15 + React 19 scaffold; MUI 7 theme (Inter, `#5A5FF2` primary, dd/mm/yyyy
  date pickers), Vercel region `sin1`.
- App shell: role-filtered left nav, collapsible rail, phone drawer + bottom bar, role chip,
  notifications panel, user menu, idle timeout.
- Shared components: StatusChip (15 status sets), ListPage, MoneyText (`RM 1,234.56`),
  DateText, empty/error/loading states, confirm and reason dialogs, toasts, dashboard tiles.
- Auth screens and server actions: sign-in, MFA enrol/verify (mandatory for Admin and
  Super Admin), accept invite, forgot/reset password (12-character rule), sign-out.
- Server-only data access (ADR-0002): Postgres via Supavisor with verified TLS, every query
  run as the signed-in user so RLS applies; live role lookup (ADR-0001).
- Field encryption for NRIC/bank numbers with key versions and blind index (ADR-0003);
  append-only audit and access log; private Storage helpers with signed URLs.
- Database (9 migrations on `pret-dev`): 22 core tables, RLS forced on all, 45 table + 2
  Storage policies, 7 private buckets, `private.bootstrap_super_admin`; synthetic seed and
  role-matrix test.
- Formatting library (`src/lib/format`) with unit tests; `/dev/components` gallery (dev only).
- Interact logo and "i" mark (high-resolution, transparent) from Albert.
- Dev setup guide `docs/guides/dev-setup-pret-dev.md`; `.env.example`.
### Known gaps
- Not yet exercised in a browser (waits on the remaining pret-dev setup steps).
- Idle-timeout re-sign-in does not keep unsaved form data; DataGrid not installed (plain
  table); `sharp` needed for upload image re-encoding.

## [0.2.0] — 2026-11-15 — GATE 2 (Design) approved
### Added
- Architecture: system design, data model (141 tables incl. R1.1 payroll design), RLS
  policies for every table, non-functional design, ADR-0001 to ADR-0016.
- UX: screen inventory (165 screens), information architecture per role, field-level
  wireframes by module, interaction notes.
- UI: MUI design-system tokens (AA-compliant palette), component specs, dashboard visuals.
- GATE 2 review pack (`docs/gate-2-review.md`) and decisions D18–D24.
### Changed
- System renamed **PRET** across docs; GitHub remote `alberttancw88/pret` recorded.
- UI reference updated to the four roles (D11) and claim statuses (D12).

## [0.1.0] — 2026-11-15 — GATE 1 (Scope) approved
### Added
- Project governance adopted from Direct Order: Delivery Lead instructions (`CLAUDE.md`),
  AI-team operating model, six specialist agent definitions, decisions log, delivery board,
  Interact UI reference and brand assets.
- Anonymised study of Interact's current Kakitangan.com setup (`docs/reference/`).
- Phase-1 scope artefacts approved at GATE 1: BRD, field-level PRD (function catalogue,
  modules M1–M10, access matrix, open questions with defaults) and user stories with
  Given/When/Then acceptance criteria. R1.0 = employee master, leave, claims, portal;
  R1.1 = payroll after a parallel run against Kakitangan.
- System named **PRET** (D17).
- Decisions D1–D16, including four roles (Super Admin, Manager, Employee, Admin),
  single-level claim approval with month-end disbursement, statutory leave entitlements,
  bank details maintained by Super Admin or Admin, and all payments made manually through
  Hong Leong Bank Connect First (AutoCount gets .xlsx exports only).
