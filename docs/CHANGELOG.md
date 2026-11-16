# Changelog

All notable changes to PRET (Interact's internal HR & Payroll system) are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versioning follows
[Semantic Versioning](https://semver.org/). **Every commit is tagged with a version.**

Convention: `PATCH` bumps per commit · `MINOR` bump at each wave/gate milestone ·
`MAJOR` stays `0` until Phase-1 production launch (`1.0.0`).

## [Unreleased]

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
