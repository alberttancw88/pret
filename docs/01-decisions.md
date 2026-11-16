# PRET — Decisions Log

**Status:** Wave 1 — for review · **Last updated:** 2026-11-15

Each item is marked:
- ✅ **Decided** — locked by Albert.
- 🔷 **Recommended** — proposed default; proceeds unless Albert objects.
- ❓ **Needs your input** — a business/legal answer the team can't invent.

---

## Decided by Albert (2026-11-15)

| # | Area | Decision |
|---|------|----------|
| D1 | Purpose | ✅ Internal HRMS & Payroll for Interact Technology Sdn Bhd only — single company, not multi-tenant, not a product. |
| D2 | Users | ✅ Interact's permanent employees, plus an **outsourced admin/finance/payroll administrator** (non-employee) who operates the system. |
| D3 | Jurisdiction | ✅ All employees Malaysian and Malaysia-based → **Malaysian law only** (Employment Act 1955 as amended 2022, PDPA 2010 as amended 2024, EPF Act, SOCSO Act, EIS Act, Income Tax Act/PCB, HRDF). No foreign-worker or multi-country rules. |
| D4 | Phase 1 scope | ✅ Employee master records · Leave management · Claims management · Web employee portal (submit leave and claims, view leave balances) · **Payroll** (amended 2026-11-15, see D5). |
| D5 | Payroll in Phase 1 | ✅ *(Amended 2026-11-15 — supersedes "payroll = Phase 2".)* Payroll is in Phase 1 scope and goes through Gate 1/2 with the rest, delivered as a **second release**: **R1.0** employee master, leave, claims, portal go live (Kakitangan payroll keeps running; approved claims handed over monthly). **R1.1** payroll — statutory deductions (EPF, SOCSO, EIS, PCB/MTD, Zakat, HRDF, PTPTN), payslips, EA forms, statutory submission files — parallel-run against Kakitangan for 2–3 months and cut over only when every payslip, statutory amount and payment list reconciles to the sen. YTD opening balances imported, so cut-over need not wait for January. |
| D6 | Bank | ✅ **Hong Leong Bank Connect First** (business). *(Amended 2026-11-15)* **No bank interface for now — manual method.** The system produces a payment list/report (salary and claim reimbursements) that HR/finance keys or uploads into HLB Connect First by hand. No bank file format, no API. |
| D10 | Accounting | ✅ *(2026-11-15)* Interact records finance transactions (payroll, claims, etc.) in **AutoCount Accounting (Cloud)**. **No direct integration** — the system offers **.xlsx exports** of payroll and claims postings for AutoCount. Exact column layout to be confirmed from an AutoCount import template / sample. |
| D7 | Stack | ✅ Same as Direct Order: GitHub, Supabase (Postgres + Auth + Storage + RLS), Next.js App Router + TypeScript, MUI + Emotion + Inter, Vercel. |
| D8 | Governance | ✅ Same framework as Direct Order: AI-team operating model, 3 mandatory gates, backlog board, SemVer tag + CHANGELOG per commit, no push without approval. |
| D9 | Current system | ✅ **Kakitangan.com** is the incumbent; data and configuration will be migrated from it. |

## Decided by Albert at Gate 1 review (2026-11-15)

**GATE 1 approved 2026-11-15.** All PRD §17 open questions not answered below are accepted at their proposed defaults.

| # | Area | Decision |
|---|------|----------|
| D11 | Roles (PRD Q3) | ✅ **Four roles:** **Super Admin** (everything) · **Manager** (of their employees) · **Employee** · **Admin** (one role covering finance, payroll and employee records). Replaces the PRD's separate HR Admin / Finance / Payroll Admin roles. |
| D12 | Claims flow (PRD Q4, Q20) | ✅ Employee submits → **one approval** by the employee's Manager **or** an Admin **or** a Super Admin → at **month end the Admin processes payment** to the employee. Statuses: **New, Submitted, Approved, Disbursed, Rejected, Withdrawn** (by employee), **Cancelled** (by manager). |
| D13 | Leave entitlements (PRD Q7) | ✅ Correct entitlements to the **statutory minimum** (Employment Act 1955 as amended 2022): fixes the four Kakitangan gaps (maternity 98, paternity 7, hospitalisation 60, service-banded sick and annual leave). |
| D15 | Bank details | ✅ Employee bank details can be maintained by **Super Admin or Admin** — no Super Admin confirmation step for Admin changes (changes still logged). |
| D16 | Payment route | ✅ **All payments go through Hong Leong Bank directly** (manual HLB Connect First, per D6) — claims reimbursements in R1.0 and salaries in R1.1. No Kakitangan payroll handover for claims. |
| D17 | System name | ✅ The system is called **PRET** (Interact's internal HR & Payroll system). GitHub repository: `alberttancw88/pret` (private), linked as `origin` 15/11/2026. |
| D14 | PDPA extras (PRD Q30) | ✅ **Not required** as system features: no data-processing-agreement fields or go-live block for the outsourced Admin, no DPO setup, no privacy-notice acknowledgement workflow. Hosting stays Singapore (R1). |

## Recommended (proceeds unless Albert objects)

| # | Area | Recommendation |
|---|------|----------------|
| R1 | Hosting region | 🔷 Supabase + Vercel in **Singapore** (closest region; Direct Order is moving there too). |
| R2 | Language | 🔷 English only in Phase 1. |
| R3 | Sign-in | 🔷 Supabase Auth email + password; Microsoft 365 / Google SSO as a later option. |
| R4 | Real data | 🔷 No real employee data in the repo, tests or seeds; migration from Kakitangan is a one-off scripted import run against production only. |

## Needs Albert's input

Tracked in `docs/product/PRD.md` → "Open Questions for Albert" once Gate-1 artefacts exist.

## Decided by Albert at Gate 2 review (2026-11-15)

**GATE 2 approved 2026-11-15** — architecture (`docs/architecture/`), UX (`docs/design/ux/`) and UI (`docs/design/ui/`) as summarised in `docs/gate-2-review.md`, with every open question at its proposed default (Q-ARCH-01–13, UXQ-01–14, UI-1–5).

| # | Area | Decision |
|---|------|----------|
| D18 | Data access | ✅ Server-only data access; Supabase Data API (PostgREST/GraphQL) off (ADR-0002). Departs from Direct Order's browser-to-Supabase pattern. |
| D19 | Security | ✅ MFA (authenticator app) mandatory for Admin and Super Admin, incl. the outsourced administrator; NRIC and bank numbers encrypted at the application layer with keys outside the database; Albert holds an offline key copy (ADR-0003, ADR-0014, Q-ARCH-08). |
| D20 | Backups & plans | ✅ Nightly encrypted off-site copy of Storage files (+ weekly logical DB dump) to a second location in Singapore; Supabase **Pro** and Vercel **Pro** (Q-ARCH-06, Q-ARCH-07). |
| D21 | Email & uploads | ✅ Same transactional email provider as Direct Order, no sensitive data in emails; no third-party malware scanning in R1.0 (Q-ARCH-05, Q-ARCH-09). |
| D22 | Second Super Admin | ✅ A second Super Admin to be added before R1.1; until then the Admin prepares payroll runs and Albert approves. **Holder to be named by Albert.** |
| D23 | Cheque/cash payees | ✅ Shown in a separate "Pay by cheque/cash" section of the claims batch, excluded from the HLB list (UXQ-06). |
| D24 | Visual | ✅ Buttons/active nav `#5A5FF2` (AA); brand `#666CFF` for accents; light mode only; phone bottom bar. Logo SVG + "i" mark **to be supplied by Albert**. |
| D25 | Supabase org | ✅ PRET projects live in the existing Supabase organisation ("Interact Direct Order"). Dev project `pret-dev`, Singapore, free plan. Production project (Pro, D20) created at Wave 4. |

## Decided by Albert during Wave 2 (2026-11-17)

| # | Area | Decision |
|---|------|----------|
| D26 | Hosting plan | ✅ PRET is hosted on **Vercel Hobby**, including the live (production) version, because Interact has very few employees. *Supersedes the "Vercel Pro" part of D20; Supabase Pro for production is unchanged.* PRET runs on Vercel, not localhost. Albert accepts the trade-offs: Vercel's Hobby terms are for non-commercial use, Hobby has a single account owner (no team seats), and there is no Vercel support SLA. Revisit if Vercel objects or usage grows. |
