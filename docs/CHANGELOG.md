# Changelog

All notable changes to PRET (Interact's internal HR & Payroll system) are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versioning follows
[Semantic Versioning](https://semver.org/). **Every commit is tagged with a version.**

Convention: `PATCH` bumps per commit · `MINOR` bump at each wave/gate milestone ·
`MAJOR` stays `0` until Phase-1 production launch (`1.0.0`).

## [Unreleased]

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
