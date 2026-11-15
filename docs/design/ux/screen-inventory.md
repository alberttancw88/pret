# PRET — Screen Inventory (Phase 1: R1.0 + R1.1)

**Work item:** W1-004 · **Author:** UX Designer · **Status:** Draft for GATE 2 (Design)
**Last updated:** 15/11/2026
**Inputs:** `docs/product/PRD.md` (GATE 1 approved 15/11/2026, amended D11–D16), `docs/product/user-stories.md`, `docs/01-decisions.md` (D1–D17), `docs/reference/kakitangan-study.md`, `docs/design/reference-interact-ui.md`.
**Companions:** [`information-architecture.md`](information-architecture.md) · [`wireframes.md`](wireframes.md) (index of module wireframe files) · [`interaction-notes.md`](interaction-notes.md).

> Every Phase-1 screen, dialog and panel, organised by the **four roles of D11** —
> **EMP** Employee · **MGR** Manager (derived from the reporting line, or an active
> delegate) · **ADM** Admin (one role: employee records, leave admin, claims/finance,
> payroll; the outsourced administrator is an *External user* holding ADM) · **SA** Super
> Admin. Each row traces to PRD function ids (`F-…`) and story ids (`US-…`) and points to
> the wireframe that specifies it at field level. Nothing is added or dropped against the
> approved scope; gaps are listed in **Open UX questions for Albert** at the end.

## 0. How to read this inventory

- **ID** `S-<area>-nn` — areas: **GL** global (all roles) · **PT** self-service portal ·
  **AP** approvals & team · **EM** employee records · **LV** leave admin · **CL** claims
  admin · **OR** organisation & settings · **RP** dashboards & reports · **IM** imports &
  migration · **AC** users, access, audit, privacy, notifications · **PY** payroll (R1.1).
- **Type** — **Page** (own route) · **Dialog** (modal / bottom sheet on phone) · **Panel**
  (section embedded in a page) · **Variant** (same screen, different mode/scope).
- **Roles** — who can open it. `own` = own records · `team` = reportees (direct +
  indirect) · `all` = every record. Role restrictions are enforced server-side on every
  route and action (FR-G-02); hiding a nav item is never the control.
- **Mobile** — **Full** = designed phone-first at 360 px (EMP/MGR flows, FR-G-14, §8.4);
  **Usable** = responsive (tables collapse to cards < 600 px) but desktop-first (admin).
- **Rel** — R1.0 (HR, leave, claims, portal) or R1.1 (payroll, D5).
- **WF** — wireframe file and section: `WF-G` = `wireframes.md`, `WF-P` =
  `wireframes-portal.md`, `WF-E` = `wireframes-employees.md`, `WF-L` =
  `wireframes-leave-admin.md`, `WF-C` = `wireframes-claims-admin.md`, `WF-O` =
  `wireframes-org-setup.md`, `WF-R` = `wireframes-reports.md`, `WF-A` =
  `wireframes-access-imports.md`, `WF-Y` = `wireframes-payroll.md`.

---

## 1. Global — all roles (S-GL)

| ID | Screen | Type | Roles | Rel | Mobile | Functions | Stories | WF |
|----|--------|------|-------|-----|--------|-----------|---------|----|
| S-GL-01 | Sign in | Page | All | R1.0 | Full | F-PRT-01, F-ADM-13 | US-PORTAL-001, US-ADMIN-013 | WF-G §G1 |
| S-GL-02 | Forgot password | Page | All | R1.0 | Full | F-PRT-01 | US-PORTAL-002 | WF-G §G2 |
| S-GL-03 | Set password (accept invite / reset link) | Page | All | R1.0 | Full | F-PRT-01, F-ADM-02 | US-PORTAL-002, US-ADMIN-002 | WF-G §G3 |
| S-GL-04 | Two-factor enrol / verify | Page | ADM, SA (EMP optional) | R1.0 | Full | F-ADM-07 | US-ADMIN-007, US-PORTAL-001 | WF-G §G4 |
| S-GL-05 | App shell — left nav, top bar, role chip, bell (frame for every page) | Frame | All | R1.0 | Full | F-PRT-18 | US-PORTAL-015 | WF-G §0.1 |
| S-GL-06 | Notification panel (bell drop-down) | Panel | All | R1.0 | Full | F-PRT-13, F-NTF-02 | US-PORTAL-013, US-NOTIF-004 | WF-G §G5 |
| S-GL-07 | Notifications (full list) | Page | All | R1.0 | Full | F-PRT-13, F-NTF-02 | US-PORTAL-013 | WF-G §G5 |
| S-GL-08 | Account settings (Password · Notifications · Delegation) | Page | All (Delegation tab: MGR, ADM, SA) | R1.0 | Full | F-PRT-14, F-NTF-06, F-LV-24 | US-PORTAL-014, US-LEAVE-031, US-NOTIF-009 | WF-G §G6 |
| S-GL-09 | Privacy notice (view current + history) | Page | All | R1.0 | Full | F-ADM-15 | US-ADMIN-015 | WF-G §G7 |
| S-GL-10 | Not found or no access | Page | All | R1.0 | Full | FR-G-02 | US-ADMIN-020, US-ADMIN-021 | WF-G §G8 |
| S-GL-11 | Session expired / re-authenticate | Dialog | All | R1.0 | Full | F-ADM-14 | US-ADMIN-014 | WF-G §G9 |
| S-GL-12 | Staff directory | Page | All employee users, ADM, SA | R1.0 | Full | F-EMP-23 | US-EMP-020 | WF-G §G10 |
| S-GL-13 | Org chart | Page | All employee users, ADM, SA | R1.0 | Usable | F-EMP-22 | US-EMP-025 | WF-G §G11 |

## 2. Employee self-service — EMP (also MGR, and ADM/SA who are employee users) (S-PT)

External administrators never see "My" screens (FR-PRT-12, EC-PRT-02).

| ID | Screen | Type | Roles | Rel | Mobile | Functions | Stories | WF |
|----|--------|------|-------|-----|--------|-----------|---------|----|
| S-PT-01 | Home (employee dashboard + manager panel) | Page | EMP (+ MGR panel) | R1.0 | Full | F-PRT-03, F-RPT-22 | US-PORTAL-004, US-REPORT-022 | WF-P §P1 |
| S-PT-02 | Apply leave (phone-first form with balance preview) | Page | EMP own; ADM/SA on behalf (variant S-LV-02) | R1.0 | Full | F-LV-05/06/07/16/17/30/33/34, F-LV-12/13/14, F-PRT-04 | US-LEAVE-008–012, 018–021, 024, 038, 039, US-PORTAL-005 | WF-P §P2 |
| S-PT-03 | My leave applications | Page | EMP own | R1.0 | Full | F-PRT-06, F-LV-08, F-LV-10 | US-PORTAL-007, US-LEAVE-013, US-LEAVE-016 | WF-P §P3 |
| S-PT-04 | Leave application detail (own view; approver and admin modes in S-AP-02) | Page | EMP own | R1.0 | Full | F-PRT-06, F-LV-08, F-LV-10 | US-LEAVE-013, US-LEAVE-016 | WF-P §P4 |
| S-PT-05 | My balances (card per type) | Page | EMP own | R1.0 | Full | F-LV-21, F-PRT-06 | US-LEAVE-028 | WF-P §P5 |
| S-PT-06 | Balance ledger (one type) | Page | EMP own; ADM/SA all; MGR team (balances only) | R1.0 | Full | F-LV-28 | US-LEAVE-028 | WF-P §P6 |
| S-PT-07 | Leave report by individual (year, printable) | Page | EMP own; MGR team; ADM, SA | R1.0 | Usable | F-RPT-27 | US-REPORT-025 | WF-P §P7 |
| S-PT-08 | Request replacement credit | Page | EMP own; ADM batch (S-LV-07) | R1.0 | Full | F-LV-15 | US-LEAVE-022 | WF-P §P8 |
| S-PT-09 | My replacement credits (list + detail) | Page | EMP own | R1.0 | Full | F-LV-15, F-LV-20 | US-LEAVE-022, US-LEAVE-023 | WF-P §P9 |
| S-PT-10 | Leave calendar (month/week; visibility by role) | Page | EMP (peers, no type); MGR team (with type); ADM, SA all | R1.0 | Full | F-LV-23 | US-LEAVE-030 | WF-P §P10 |
| S-PT-11 | Public holidays (my state, year) | Page | EMP | R1.0 | Full | F-PRT-10 | US-PORTAL-010 | WF-P §P11 |
| S-PT-12 | My claims (list + limit utilisation) | Page | EMP own | R1.0 | Full | F-CLM-13, F-CLM-20, F-PRT-07 | US-CLAIM-016 | WF-P §P12 |
| S-PT-13 | Claim form — create / edit New (multi-line) | Page | EMP own; ADM on behalf (variant S-CL-02) | R1.0 | Full | F-CLM-04/05/06/07/08/19, F-PRT-05 | US-CLAIM-005–010, US-PORTAL-006 | WF-P §P13 |
| S-PT-14 | Claim line editor (category-driven fields, camera receipt) | Dialog | EMP own; ADM on behalf | R1.0 | Full | F-CLM-04/05/06 | US-CLAIM-005–007 | WF-P §P14 |
| S-PT-15 | Claim detail with status timeline (own view; approver/admin modes in S-AP-04) | Page | EMP own | R1.0 | Full | F-CLM-08, F-CLM-13, F-CLM-29 | US-CLAIM-011, 016, 029 | WF-P §P15 |
| S-PT-16 | My profile (tabs, inline self-update) | Page | EMP own | R1.0 | Full | F-PRT-08, F-EMP-03/06/07, F-EMP-20 | US-PORTAL-008, US-EMP-004, 006, 018 | WF-P §P16 |
| S-PT-17 | Request a change (change-request form) | Page | EMP own | R1.0 | Full | F-EMP-19 | US-EMP-017 | WF-P §P17 |
| S-PT-18 | My change requests (list + detail) | Page | EMP own | R1.0 | Full | F-EMP-19 | US-EMP-017 | WF-P §P18 |
| S-PT-19 | My documents | Page | EMP own | R1.0 | Full | F-PRT-09, F-EMP-18 | US-PORTAL-009 | WF-P §P19 |
| S-PT-20 | Download my data | Page | EMP own | R1.0 | Full | F-PRT-16 | US-PORTAL-016 | WF-P §P20 |
| S-PT-21 | My payslips | Page | EMP own | **R1.1** | Full | F-PRT-17, F-PAY-27 | US-PORTAL-018, US-PAY-027 | WF-P §P21 |
| S-PT-22 | Payslip viewer (PDF preview + download) | Page | EMP own; ADM, SA (logged) | **R1.1** | Full | F-PAY-27 | US-PAY-027 | WF-P §P22 |
| S-PT-23 | My EA forms | Page | EMP own | **R1.1** | Full | F-PAY-29, F-PRT-17 | US-PORTAL-018, US-PAY-029 | WF-P §P23 |
| S-PT-24 | My YTD statement | Page | EMP own | **R1.1** | Full | F-PAY-42 | US-PAY-042 | WF-P §P24 |
| S-PT-25 | My TP1 declarations (list + submit) | Page | EMP own (Should) | **R1.1** | Full | F-PAY-16 | US-PAY-017 | WF-P §P25 |

## 3. Approvals & team — MGR (approvals also ADM, SA) (S-AP)

| ID | Screen | Type | Roles | Rel | Mobile | Functions | Stories | WF |
|----|--------|------|-------|-----|--------|-----------|---------|----|
| S-AP-01 | Approvals inbox (tabs: Leave · Cancellations · Replacement credits · Claims · Approved claims – not disbursed) | Page | MGR team (+ delegated); ADM, SA all (not own) | R1.0 | Full | F-PRT-11, F-LV-09, F-LV-10, F-LV-15, F-CLM-09, F-CLM-25, F-CLM-30 | US-PORTAL-011, US-LEAVE-014, 015, US-CLAIM-012, 015, 028, 030 | WF-P §P26 |
| S-AP-02 | Leave decision view (approver / admin mode of a leave application: balance, overlaps, MC, trail, decide) | Page | MGR team; ADM, SA all | R1.0 | Full | F-LV-09, F-LV-10, F-LV-24, F-LV-26, F-LV-29, F-LV-13 | US-LEAVE-014, 016, 020, 031, 032, 034, 042 | WF-P §P27 |
| S-AP-03 | Replacement-credit decision view | Page | MGR team; ADM, SA | R1.0 | Full | F-LV-15 | US-LEAVE-022 | WF-P §P28 |
| S-AP-04 | Claim decision view (lines, receipt viewer, limit/duplicate flags, approve / reject / cancel) | Page | MGR team; ADM, SA all | R1.0 | Full | F-CLM-09, F-CLM-30, F-CLM-23 (ADM) | US-CLAIM-012, 028, 030, 022 | WF-P §P29 |
| S-AP-05 | Decision dialog (approve / reject / cancel, comment or reason; single and bulk with per-item result) | Dialog | MGR, ADM, SA | R1.0 | Full | F-LV-09, F-CLM-09/25/30 | US-LEAVE-015, US-CLAIM-015 | WF-P §P30 |
| S-AP-06 | My team (reportees, today/this-week status, balances) | Page | MGR team | R1.0 | Full | F-PRT-12 | US-PORTAL-012 | WF-P §P31 |
| S-AP-07 | Team member (limited profile) | Page | MGR team | R1.0 | Full | F-EMP-03 (M limited) | US-EMP-004, US-ADMIN-021 | WF-P §P32 |
| S-AP-08 | Probation recommendation | Dialog | MGR team | R1.0 | Full | F-EMP-11 | US-EMP-010 | WF-P §P33 |

**Team-scoped use of shared admin screens (MGR, scope = team, read-only except decisions):** S-LV-01 Leave applications · S-LV-03 Leave balances · S-CL-01 Claims · S-RP-07 Probation due · S-RP-10 Leave balances report · S-RP-13 Who's on leave · S-PT-07 Leave report by individual. (F-LV-22, F-RPT-05/08/11/27, F-CLM-12 — PRD §16 "R t".)

## 4. Employee records — ADM, SA (S-EM)

| ID | Screen | Type | Roles | Rel | Mobile | Functions | Stories | WF |
|----|--------|------|-------|-----|--------|-----------|---------|----|
| S-EM-01 | Employee list | Page | ADM, SA | R1.0 | Usable | F-EMP-01, F-EMP-24, F-RPT-24 | US-EMP-003, US-EMP-021 | WF-E §E1 |
| S-EM-02 | New employee (stepper incl. opening leave and invite) | Page | ADM, SA | R1.0 | Usable | F-EMP-02/04/05/06/07/09/14/16, F-LV-35 | US-EMP-001, 002, US-LEAVE-040 | WF-E §E2 |
| S-EM-03 | Employee profile (header + 15 tabs; see list below) | Page | ADM, SA all (MGR limited view = S-AP-07; EMP = S-PT-16) | R1.0 (+2 tabs R1.1) | Usable | F-EMP-03–28 | US-EMP-004–027 | WF-E §E3 |
| S-EM-04 | Edit section (per field group, inline edit mode) | Variant | ADM, SA (not own E→CR fields) | R1.0 | Usable | F-EMP-04/06/07/08/09/14/15 | US-EMP-005–008, 013, 014, 027 | WF-E §E4 |
| S-EM-05 | Add / edit job change | Dialog | ADM, SA | R1.0 | Usable | F-EMP-10 | US-EMP-009 | WF-E §E5 |
| S-EM-06 | Confirm employee / extend probation | Dialog | ADM, SA | R1.0 | Usable | F-EMP-11 | US-EMP-010 | WF-E §E6 |
| S-EM-07 | Record separation (with leaver leave position) | Page | ADM, SA | R1.0 | Usable | F-EMP-12, F-LV-27 | US-EMP-011, US-LEAVE-035 | WF-E §E7 |
| S-EM-08 | Withdraw resignation | Dialog | ADM, SA | R1.0 | Usable | F-EMP-12 | US-EMP-012 | WF-E §E8 |
| S-EM-09 | Rehire former employee | Page | ADM, SA | R1.0 | Usable | F-EMP-13 | US-EMP-026 | WF-E §E9 |
| S-EM-10 | Reveal sensitive value (reason for ADM) | Dialog | ADM, SA | R1.0 | Usable | F-EMP-20, F-ADM-10 | US-EMP-018 | WF-E §E10 |
| S-EM-11 | Upload / edit document | Dialog | ADM, SA | R1.0 | Usable | F-EMP-18 | US-EMP-016 | WF-E §E11 |
| S-EM-12 | Change requests (queue, all employees) | Page | ADM, SA | R1.0 | Usable | F-EMP-19 | US-EMP-017 | WF-E §E12 |
| S-EM-13 | Change request review (approve / reject) | Page | ADM, SA (not own) | R1.0 | Usable | F-EMP-19 | US-EMP-017, US-EMP-027 | WF-E §E13 |
| S-EM-14 | Bulk update via CSV (upload → preview → commit) | Page | ADM, SA | R1.0 | Usable | F-EMP-25 | US-EMP-022 | WF-E §E14 |
| S-EM-15 | Bulk actions on list: change manager · send invites | Dialog | ADM, SA | R1.0 | Usable | F-EMP-25, F-MIG-12 | US-EMP-022, US-MIG-011 | WF-E §E15 |
| S-EM-16 | HR note (add / edit, history) | Dialog | ADM, SA | R1.0 | Usable | F-EMP-26 | US-EMP-023 | WF-E §E16 |
| S-EM-17 | Edit bank details (proof, name-match, alerts) | Dialog | ADM, SA (not own) | R1.0 | Usable | F-EMP-16 | US-EMP-015 | WF-E §E17 |

**S-EM-03 profile tabs** (each a field-level panel in WF-E §E3): 1 Overview · 2 Personal · 3 Contact & emergency · 4 Family · 5 Employment & history · 6 Statutory & payroll · 7 Compensation (**R1.1**, = S-PY-05) · 8 Payslips (**R1.1**) · 9 Bank · 10 Leave · 11 Claims · 12 Documents · 13 Change requests · 14 Notes · 15 Activity log.

## 5. Leave administration — ADM, SA (MGR team where stated) (S-LV)

| ID | Screen | Type | Roles | Rel | Mobile | Functions | Stories | WF |
|----|--------|------|-------|-----|--------|-----------|---------|----|
| S-LV-01 | Leave applications (all; bulk approve/decline; MC filter) | Page | ADM, SA all; MGR team | R1.0 | Usable | F-LV-22, F-LV-09, F-LV-26 | US-LEAVE-029, 015, 034 | WF-L §L1 |
| S-LV-02 | Apply / withdraw / cancel on behalf (variant of S-PT-02 with employee picker + reason) | Variant | ADM, SA | R1.0 | Usable | F-LV-11 | US-LEAVE-017 | WF-L §L2 |
| S-LV-03 | Leave balances (as at; grouped by department) | Page | ADM, SA all; MGR team | R1.0 | Usable | F-LV-21 | US-LEAVE-028 | WF-L §L3 |
| S-LV-04 | Balance adjustments (list) | Page | ADM, SA | R1.0 | Usable | F-LV-18 | US-LEAVE-025, 043 | WF-L §L4 |
| S-LV-05 | Adjust balance | Dialog | ADM, SA (not own) | R1.0 | Usable | F-LV-18 | US-LEAVE-025 | WF-L §L5 |
| S-LV-06 | Entitlement overrides (list + form) | Page | ADM, SA | R1.0 | Usable | F-LV-31 | US-LEAVE-036 | WF-L §L6 |
| S-LV-07 | Replacement credits (all; batch apply) | Page | ADM, SA | R1.0 | Usable | F-LV-15 | US-LEAVE-022 | WF-L §L7 |
| S-LV-08 | Leave types (list) | Page | ADM, SA | R1.0 | Usable | F-LV-01 | US-LEAVE-001 | WF-L §L8 |
| S-LV-09 | Leave type form | Page | ADM, SA (SA for below-minimum override) | R1.0 | Usable | F-LV-01, BR-LV-02 | US-LEAVE-001, 002, 043 | WF-L §L9 |
| S-LV-10 | Entitlement bands (per type, per year) | Page | ADM, SA | R1.0 | Usable | F-LV-02 | US-LEAVE-003, 002 | WF-L §L10 |
| S-LV-11 | Leave policy settings | Page | ADM, SA | R1.0 | Usable | F-LV-03, F-LV-34, F-LV-33 | US-LEAVE-004, 038, 039 | WF-L §L11 |
| S-LV-12 | Approval workflows (list + form) | Page | ADM, SA | R1.0 | Usable | F-LV-32 | US-LEAVE-037 | WF-L §L12 |
| S-LV-13 | Year-end roll-over (preview → run → history) | Page | ADM, SA | R1.0 | Usable | F-LV-19, F-LV-04 | US-LEAVE-026, 005 | WF-L §L13 |
| S-LV-14 | Delegations & reassignment (all approvers) | Page | ADM, SA | R1.0 | Usable | F-LV-24 | US-LEAVE-031, 032 | WF-L §L14 |

## 6. Claims administration — ADM, SA (MGR team where stated) (S-CL)

| ID | Screen | Type | Roles | Rel | Mobile | Functions | Stories | WF |
|----|--------|------|-------|-----|--------|-----------|---------|----|
| S-CL-01 | Claims (header / line view toggle, KPI strip) | Page | ADM, SA all; MGR team | R1.0 | Usable | F-CLM-12, F-CLM-25, F-RPT-24 | US-CLAIM-017, 015 | WF-C §C1 |
| S-CL-02 | Submit claim on behalf (variant of S-PT-13) | Variant | ADM | R1.0 | Usable | F-CLM-18 | US-CLAIM-025 | WF-C §C2 |
| S-CL-03 | Bulk claim entry grid (Could) | Page | ADM | R1.0 | Usable | F-CLM-28 | US-CLAIM-027 | WF-C §C3 |
| S-CL-04 | Late-submission overrides | Page | ADM | R1.0 | Usable | F-CLM-21 | US-CLAIM-026 | WF-C §C4 |
| S-CL-05 | Claim categories (list) | Page | ADM, SA | R1.0 | Usable | F-CLM-01 | US-CLAIM-001, 002 | WF-C §C5 |
| S-CL-06 | Claim category form (+ limits tab) | Page | ADM, SA | R1.0 | Usable | F-CLM-01, F-CLM-02 | US-CLAIM-001, 003 | WF-C §C6 |
| S-CL-07 | Claim limits (all, list + form) | Page | ADM, SA | R1.0 | Usable | F-CLM-02 | US-CLAIM-003 | WF-C §C7 |
| S-CL-08 | Claims settings | Page | ADM, SA (SA-only: batch approval) | R1.0 | Usable | F-CLM-03 | US-CLAIM-004 | WF-C §C8 |
| S-CL-09 | Disbursement batches (list) | Page | ADM, SA | R1.0 | Usable | F-CLM-14, F-RPT-19 | US-CLAIM-019 | WF-C §C9 |
| S-CL-10 | New month-end batch (wizard: month & cut-off → claims → review) | Page | ADM | R1.0 | Usable | F-CLM-14 | US-CLAIM-019 | WF-C §C10 |
| S-CL-11 | Batch detail (claims, totals, outputs, status actions, SA approval) | Page | ADM; SA (approve if setting on) | R1.0 | Usable | F-CLM-14/15/17/27, F-CLM-26 | US-CLAIM-019, 020, 021, 024, 018 | WF-C §C11 |
| S-CL-12 | HLB claims payment list (on-screen report; .xlsx, PDF) | Page | ADM, SA | R1.0 | Usable | F-CLM-15 | US-CLAIM-020 | WF-C §C12 |
| S-CL-13 | Mark batch disbursed | Dialog | ADM | R1.0 | Usable | F-CLM-17 | US-CLAIM-021 | WF-C §C13 |
| S-CL-14 | Undo disbursement (on a claim) | Dialog | ADM, SA | R1.0 | Usable | F-CLM-23 | US-CLAIM-022 | WF-C §C14 |
| S-CL-15 | AutoCount claims postings export | Dialog | ADM | R1.0 | Usable | F-CLM-27 | US-CLAIM-024 | WF-C §C15 |
| S-CL-16 | Download attachment bundle | Dialog | ADM, SA | R1.0 | Usable | F-CLM-26 | US-CLAIM-018 | WF-C §C16 |

## 7. Organisation & settings — ADM, SA (S-OR)

| ID | Screen | Type | Roles | Rel | Mobile | Functions | Stories | WF |
|----|--------|------|-------|-----|--------|-----------|---------|----|
| S-OR-01 | Company profile (statutory numbers, HLB paying account, signatories, AutoCount GL mapping) | Page | SA edit; ADM view + non-statutory edit | R1.0 | Usable | F-ORG-01 | US-ORG-001 | WF-O §O1 |
| S-OR-02 | Departments | Page | ADM, SA | R1.0 | Usable | F-ORG-02 | US-ORG-002 | WF-O §O2 |
| S-OR-03 | Positions | Page | ADM, SA | R1.0 | Usable | F-ORG-03 | US-ORG-002 | WF-O §O3 |
| S-OR-04 | Grades | Page | ADM, SA | R1.0 | Usable | F-ORG-04 | US-ORG-002 | WF-O §O4 |
| S-OR-05 | Work locations | Page | ADM, SA | R1.0 | Usable | F-ORG-05 | US-ORG-003 | WF-O §O5 |
| S-OR-06 | Working-week patterns | Page | ADM, SA | R1.0 | Usable | F-ORG-06 | US-ORG-004 | WF-O §O6 |
| S-OR-07 | Public holidays (list + calendar; add, copy, publish) | Page | ADM, SA | R1.0 | Usable | F-ORG-07/08/09/10 | US-ORG-005–008, US-LEAVE-041 | WF-O §O7 |
| S-OR-08 | Reporting lines (tree; reassign reportees) | Page | ADM, SA | R1.0 | Usable | F-ORG-11 | US-ORG-009 | WF-O §O8 |
| S-OR-09 | Cost centres (Could) | Page | ADM, SA | R1.0 | Usable | F-ORG-13 | US-ORG-011 | WF-O §O9 |
| S-OR-10 | Employee groups (Could) | Page | ADM, SA | R1.0 | Usable | F-ORG-14 | US-ORG-011 | WF-O §O10 |
| S-OR-11 | System settings (SA-only control settings) | Page | SA edit all; ADM view + operating settings | R1.0 | Usable | F-ORG-12 | US-ORG-010 | WF-O §O11 |

## 8. Dashboards & reports — ADM, SA (MGR team where stated) (S-RP)

| ID | Screen | Type | Roles | Rel | Mobile | Functions | Stories | WF |
|----|--------|------|-------|-----|--------|-----------|---------|----|
| S-RP-01 | Admin dashboard (HR panel, claims panel; payroll panel R1.1) | Page | ADM, SA | R1.0 (+panel R1.1) | Usable | F-RPT-01, F-PAY-37 | US-REPORT-001 | WF-R §R1 |
| S-RP-02 | Reports catalogue | Page | ADM, SA; MGR (team reports only) | R1.0 | Usable | F-RPT-02–27 | US-REPORT-* | WF-R §R2 |
| S-RP-03 | Report viewer (shared template for S-RP-04…24) | Frame | as each report | R1.0 | Usable | F-RPT-24, F-RPT-25 | US-REPORT-024, US-ADMIN-024 | WF-R §R3 |
| S-RP-04 | Employee master report (column chooser) | Page | ADM, SA | R1.0 | Usable | F-RPT-02 | US-REPORT-002 | WF-R §R4 |
| S-RP-05 | Headcount | Page | ADM, SA | R1.0 | Usable | F-RPT-03 | US-REPORT-003 | WF-R §R4 |
| S-RP-06 | Joiners & leavers | Page | ADM, SA | R1.0 | Usable | F-RPT-04 | US-REPORT-004 | WF-R §R4 |
| S-RP-07 | Probation due | Page | ADM, SA; MGR team | R1.0 | Usable | F-RPT-05 | US-REPORT-005 | WF-R §R4 |
| S-RP-08 | Retirement & service milestones | Page | ADM, SA | R1.0 | Usable | F-RPT-06 | US-REPORT-006 | WF-R §R4 |
| S-RP-09 | Data completeness (payroll readiness) | Page | ADM, SA | R1.0 | Usable | F-RPT-07, F-EMP-24 | US-REPORT-007 | WF-R §R4 |
| S-RP-10 | Leave balances (as at) | Page | ADM, SA; MGR team | R1.0 | Usable | F-RPT-08 | US-REPORT-008 | WF-R §R4 |
| S-RP-11 | Leave transactions | Page | ADM, SA | R1.0 | Usable | F-RPT-09 | US-REPORT-009 | WF-R §R4 |
| S-RP-12 | Leave summary by type & department | Page | ADM, SA | R1.0 | Usable | F-RPT-10 | US-REPORT-010 | WF-R §R4 |
| S-RP-13 | Who's on leave | Page | ADM, SA; MGR team | R1.0 | Usable | F-RPT-11 | US-REPORT-011 | WF-R §R4 |
| S-RP-14 | Unpaid leave | Page | ADM, SA | R1.0 | Usable | F-RPT-12 | US-REPORT-012 | WF-R §R4 |
| S-RP-15 | Sick & hospitalisation utilisation (sensitive) | Page | ADM, SA | R1.0 | Usable | F-RPT-13 | US-REPORT-013 | WF-R §R4 |
| S-RP-16 | Replacement leave | Page | ADM, SA | R1.0 | Usable | F-RPT-14 | US-REPORT-014 | WF-R §R4 |
| S-RP-17 | Year-end carry-forward & forfeiture | Page | ADM, SA | R1.0 | Usable | F-RPT-15 | US-REPORT-015 | WF-R §R4 |
| S-RP-18 | Claims detail | Page | ADM, SA | R1.0 | Usable | F-RPT-16 | US-REPORT-016 | WF-R §R4 |
| S-RP-19 | Claims summary & limit utilisation | Page | ADM, SA | R1.0 | Usable | F-RPT-17 | US-REPORT-017 | WF-R §R4 |
| S-RP-20 | Approved-not-disbursed claims (payables) | Page | ADM, SA | R1.0 | Usable | F-RPT-18 | US-REPORT-018 | WF-R §R4 |
| S-RP-21 | Disbursement batches report | Page | ADM, SA | R1.0 | Usable | F-RPT-19 | US-REPORT-019 | WF-R §R4 |
| S-RP-22 | Claims by tax treatment | Page | ADM, SA | R1.0 | Usable | F-RPT-20 | US-REPORT-020 | WF-R §R4 |
| S-RP-23 | Monthly payroll-input pack (Kakitangan; retired at R1.1 cut-over) | Page | ADM, SA | R1.0 | Usable | F-RPT-21 | US-REPORT-021 | WF-R §R5 |
| S-RP-24 | Leave report by individual (admin/team entry to S-PT-07) | Variant | ADM, SA; MGR team | R1.0 | Usable | F-RPT-27 | US-REPORT-025 | WF-R §R4 |

## 9. Imports & migration — ADM, SA (S-IM)

| ID | Screen | Type | Roles | Rel | Mobile | Functions | Stories | WF |
|----|--------|------|-------|-----|--------|-----------|---------|----|
| S-IM-01 | Imports (templates T1–T16 + import log) | Page | ADM, SA | R1.0 (T13–T16 R1.1) | Usable | F-MIG-01, F-MIG-11 | US-MIG-001, 003 | WF-A §A1 |
| S-IM-02 | Import wizard (template → upload & mode → validation result → commit) | Page | ADM, SA | R1.0 / R1.1 | Usable | F-MIG-02–10, F-MIG-14–19 | US-MIG-002, 004–010, 013–017 | WF-A §A2 |
| S-IM-03 | Import log detail | Page | ADM, SA | R1.0 | Usable | F-MIG-11 | US-MIG-003 | WF-A §A3 |
| S-IM-04 | Migration reconciliation & sign-off | Page | ADM enter; SA sign off | R1.0 | Usable | F-MIG-13 | US-MIG-012 | WF-A §A4 |

## 10. Users, access, audit, privacy, notifications (S-AC)

| ID | Screen | Type | Roles | Rel | Mobile | Functions | Stories | WF |
|----|--------|------|-------|-----|--------|-----------|---------|----|
| S-AC-01 | Users | Page | SA all; ADM (employee users without privileged roles) | R1.0 | Usable | F-ADM-01 | US-ADMIN-001 | WF-A §A5 |
| S-AC-02 | Invite user (employee user / external administrator) | Page | SA; ADM (employee user only, no roles) | R1.0 | Usable | F-ADM-02, F-ADM-04 | US-ADMIN-002, 003 | WF-A §A6 |
| S-AC-03 | User detail (roles, status, access window, MFA, login history, actions) | Page | SA; ADM (limited) | R1.0 | Usable | F-ADM-03/04/05/07/13 | US-ADMIN-004, 005, 007, 013 | WF-A §A7 |
| S-AC-04 | Role permission reference | Page | ADM, SA | R1.0 | Usable | F-ADM-08 | US-ADMIN-008 | WF-A §A8 |
| S-AC-05 | Audit & access log | Page | SA | R1.0 | Usable | F-ADM-09/10/11, F-PAY-41 | US-ADMIN-009–011, US-PAY-041 | WF-A §A9 |
| S-AC-06 | Audit entry detail | Dialog | SA | R1.0 | Usable | F-ADM-11 | US-ADMIN-011 | WF-A §A9 |
| S-AC-07 | Access review (monthly) | Page | SA | R1.0 | Usable | F-ADM-12 | US-ADMIN-012 | WF-A §A10 |
| S-AC-08 | Company privacy notice (publish, history) | Page | ADM, SA | R1.0 | Usable | F-ADM-15 | US-ADMIN-015 | WF-A §A11 |
| S-AC-09 | Data-subject requests (list + form) | Page | SA (C R U); ADM (R) | R1.0 | Usable | F-ADM-18 | US-ADMIN-018 | WF-A §A12 |
| S-AC-10 | Breach-readiness extract & incident register | Page | SA | R1.0 | Usable | F-ADM-17 | US-ADMIN-017 | WF-A §A13 |
| S-AC-11 | Retention & anonymisation | Page | SA | R1.0 | Usable | F-ADM-16 | US-ADMIN-016 | WF-A §A14 |
| S-AC-12 | Notification log | Page | ADM, SA | R1.0 | Usable | F-NTF-07 | US-NOTIF-008 | WF-A §A15 |
| S-AC-13 | Notification templates (view; edit Could) | Page | SA | R1.0 | Usable | F-NTF-05 | US-NOTIF-010 | WF-A §A16 |

## 11. Payroll — ADM, SA (R1.1) (S-PY)

| ID | Screen | Type | Roles | Rel | Mobile | Functions | Stories | WF |
|----|--------|------|-------|-----|--------|-----------|---------|----|
| S-PY-01 | Payroll settings | Page | ADM, SA | R1.1 | Usable | F-PAY-01 | US-PAY-001 | WF-Y §Y1 |
| S-PY-02 | Pay groups | Page | ADM, SA | R1.1 | Usable | F-PAY-02 | US-PAY-002 | WF-Y §Y2 |
| S-PY-03 | Pay items (list + form) | Page | ADM, SA | R1.1 | Usable | F-PAY-03 | US-PAY-003 | WF-Y §Y3 |
| S-PY-04 | Statutory tables (versions; SA verify) | Page | ADM, SA (verify: SA ≠ maker) | R1.1 | Usable | F-PAY-05 | US-PAY-005 | WF-Y §Y4 |
| S-PY-05 | Compensation (profile tab 7 + edit dialog) | Panel | ADM, SA (not own); EMP own basic (read) | R1.1 | Usable | F-PAY-04, F-EMP-17 | US-PAY-004 | WF-Y §Y5 |
| S-PY-06 | Payroll runs (list) | Page | ADM, SA | R1.1 | Usable | F-PAY-06, F-PAY-26 | US-PAY-006, 026 | WF-Y §Y6 |
| S-PY-07 | New payroll run | Dialog | ADM, SA | R1.1 | Usable | F-PAY-06, F-PAY-26 | US-PAY-006, 026 | WF-Y §Y7 |
| S-PY-08 | Run detail (totals strip + tabs; status actions) | Page | ADM, SA (approve/return/re-open: SA) | R1.1 | Usable | F-PAY-07–24, F-PAY-11 | US-PAY-006–024 | WF-Y §Y8 |
| S-PY-09 | Employee payroll line (drill-down; final pay inputs) | Page | ADM, SA | R1.1 | Usable | F-PAY-22, F-PAY-40 | US-PAY-022, 040 | WF-Y §Y9 |
| S-PY-10 | Variable inputs (grid + .xlsx import) | Panel | ADM, SA | R1.1 | Usable | F-PAY-07, F-PAY-08, F-PAY-21 | US-PAY-007, 008, 021 | WF-Y §Y10 |
| S-PY-11 | Approve / return run | Dialog | SA (≠ preparer) | R1.1 | Usable | F-PAY-23 | US-PAY-023 | WF-Y §Y11 |
| S-PY-12 | Re-open finalised run | Dialog | SA | R1.1 | Usable | F-PAY-25 | US-PAY-025 | WF-Y §Y12 |
| S-PY-13 | Salary payment list (report, .xlsx, PDF; record payment) | Page | ADM, SA | R1.1 | Usable | F-PAY-28 | US-PAY-028 | WF-Y §Y13 |
| S-PY-14 | Payslips (per run: status, bulk zip, re-send notice) | Page | ADM, SA | R1.1 | Usable | F-PAY-27 | US-PAY-027 | WF-Y §Y14 |
| S-PY-15 | Annual returns: EA forms & Form E | Page | ADM, SA | R1.1 | Usable | F-PAY-29, F-PAY-30 | US-PAY-029, 030 | WF-Y §Y15 |
| S-PY-16 | Statutory outputs (monthly: KWSP, PERKESO, e-PCB/CP39, HRDF, Zakat, PTPTN; CP22/CP22A) | Page | ADM, SA | R1.1 | Usable | F-PAY-31–36 | US-PAY-031–036 | WF-Y §Y16 |
| S-PY-17 | Payroll reports (8 reports, viewer template S-RP-03) | Page | ADM, SA | R1.1 | Usable | F-PAY-37, F-RPT-26 | US-PAY-037 | WF-Y §Y17 |
| S-PY-18 | AutoCount payroll journal export | Dialog | ADM, SA | R1.1 | Usable | F-PAY-38 | US-PAY-038 | WF-Y §Y18 |
| S-PY-19 | TP1 / TP3 / CP38 records | Page | ADM, SA | R1.1 | Usable | F-PAY-16, F-PAY-17 | US-PAY-017, 018 | WF-Y §Y19 |
| S-PY-20 | Parallel-run reconciliation & cut-over sign-off | Page | ADM; SA sign-off | R1.1 | Usable | F-PAY-39 | US-PAY-039 | WF-Y §Y20 |

---

## 12. Counts

**Distinct screens** (pages + dialogs + panels + variants; the shell frame S-GL-05 and the
report frame S-RP-03 counted once each): **R1.0 = 140 · R1.1 = 25 · total 165.**

| Area | R1.0 | R1.1 | Total |
|------|------|------|-------|
| GL Global | 13 | — | 13 |
| PT Self-service | 20 | 5 | 25 |
| AP Approvals & team | 8 | — | 8 |
| EM Employee records | 17 | — | 17 |
| LV Leave admin | 14 | — | 14 |
| CL Claims admin | 16 | — | 16 |
| OR Organisation & settings | 11 | — | 11 |
| RP Dashboards & reports | 24 | — | 24 |
| IM Imports | 4 | — | 4 |
| AC Access, audit, privacy, notifications | 13 | — | 13 |
| PY Payroll | — | 20 | 20 |
| **Total** | **140** | **25** | **165** |

R1.1 also adds two tabs to the employee profile S-EM-03 (Compensation = S-PY-05, Payslips)
and a payroll panel to the Admin dashboard S-RP-01; these are counted inside those screens.

**Screens reachable by role** (a user holding several roles gets the union, minus
no-self-approval, FR-G-16):

| Role | R1.0 | R1.1 | How derived |
|------|------|------|-------------|
| **EMP** | 33 | 5 | GL 13 + PT 1–20; R1.1 PT 21–25 |
| **MGR** (EMP + manager screens) | 48 | 5 | EMP 33 + AP 8 + team scope of S-LV-01, S-LV-03, S-CL-01, S-RP-02, S-RP-07, S-RP-10, S-RP-13 (7) |
| **ADM** (External user holding ADM) | 111 | 19 | GL 13 + AP 1–5 + EM 17 + LV 14 + CL 16 + OR 11 + RP 24 + IM 4 + AC 7 (01–04, 08, 09 read-only, 12); R1.1 PY 18 (all except S-PY-11/12) + S-PT-22 |
| **ADM** (Interact employee holding ADM) | 131 (+3 if manager) | 24 | External ADM + PT 1–20 (+ AP 6–8 if they have reportees); R1.1 + PT 21–25 |
| **SA** | 117 (up to 140 as employee + manager) | 20 (25 as employee) | GL 13 + AP 1–5 + EM 17 + LV 14 + CL 16 + OR 11 + RP 24 + IM 4 + AC 13; PY 20 |

**Phone-first (Full mobile) screens:** 45 — S-GL 01–12, all 25 S-PT, all 8 S-AP (40 in R1.0, 5 in R1.1).

---

## 13. Coverage check against the Function Catalogue

Every **active Phase-1 function** (PRD §1, 232) maps to at least one screen above, except
functions that are system behaviour with no screen of their own, which surface as states
or messages on the screens named:

| System-only function | Where the user sees it |
|----------------------|------------------------|
| F-EMP-05 MyKad validation | S-EM-02 / S-EM-04 field validation, derived DOB/gender |
| F-LV-04 entitlement generation | S-PT-05/06 ledger "Entitlement / Accrual", S-LV-13 |
| F-LV-06 day count, F-LV-30 overlap, F-LV-12 pool, F-LV-17 back-date, F-LV-16 emergency | S-PT-02 live "Days" + preview + blocking messages; EMERGENCY chip everywhere |
| F-LV-20 expiry, F-LV-25 reminders | Ledger "Expired"; notifications N-13/15/16 |
| F-LV-29 team absence warning | S-AP-02 warning banner |
| F-ORG-08 replacement holidays | S-OR-07 rows "(replacement)", S-PT-11 |
| F-ADM-06 auto-deactivate, F-ADM-14 timeout | S-AC-03 status, S-GL-11 |
| F-ADM-09/10 audit/access logging | S-AC-05; "Viewing is logged" hints on sensitive screens |
| F-NTF-01/03/04/08 | S-GL-06/07 in-app; emails (no screen) |
| F-PAY-09/10/12–15/18–20 calculations | S-PY-08/09 result lines with source |
| F-PRT-15 PWA (Could) | No screen — install prompt handled by the browser; icon/name per UI Designer |

**Removed functions** (F-CLM-10, F-CLM-11, F-CLM-22, F-PRT-02, F-ADM-19, F-RPT-23) have no
screens. **Won't** (F-CLM-16, F-CLM-24, F-LTR-07) and **Later** (F-LTR-01–06) have no
screens.

## 14. Kakitangan parity (match or improve)

| Kakitangan screen | PRET screen | Improvement |
|-------------------|-------------|-------------|
| Users ▸ Manage Team / Terminated / Pending Activation | S-EM-01 (status + portal-account filters) | One list with saved filter state; completeness %; CSV of filtered set |
| Add Single Employee | S-EM-02 | Stepper with MyKad derivation, statutory/bank capture, opening leave, invite timing |
| Batch Add / Batch Update | S-IM-02 (T2) / S-EM-14 | Dry-run validation with downloadable error report before commit |
| Profile card + tabs | S-EM-03 | Role-filtered tabs, masking with logged reveal, change requests, field-level history |
| Leave ▸ Apply for Leave | S-PT-02 | Phone-first; balance preview always above submit; PH/non-working days marked in picker |
| Leave ▸ View Applications | S-LV-01 | Same columns + emergency/on-behalf/MC filters; bulk with per-item result |
| Leave Calendar | S-PT-10 | Role-based type visibility (Q17) |
| Replacement Credit | S-PT-08 / S-LV-07 | Shows day type (rest/off/PH) for the date worked; FIFO expiry visible |
| Leave Reports | S-RP-10…17, S-PT-07 | As-at date, grouped by department, CSV/.xlsx |
| Claims list + KPI strip | S-CL-01 | Header/line toggle, D12 statuses, batch/run column, AutoCount export |
| New claim (single line) | S-PT-13/14 | Multi-line claim, camera receipt per line, live limit check, save as New |
| Paid with Payroll / Undo payment | S-CL-09–14 | Month-end HLB batch with payment list, mark Disbursed, undo per claim (D12, D16) |
| Manage Admins for All Modules | S-AC-01–04 | Four fixed roles (D11); role reference page |
| Compensation tab (payroll) | S-EM-03 tab 6 + S-PY-05 | Statutory captured R1.0; compensation R1.1 |

---

## Open UX questions for Albert

These are placement and behaviour choices the approved spec leaves open. Each has a
**proposed default** the design already follows; nothing here adds or removes a feature.

| # | Question | Proposed default (used in the wireframes) |
|---|----------|-------------------------------------------|
| UXQ-01 | An Interact employee who holds **Admin or Super Admin** (e.g. Albert) — which home page do they land on? PRD §8.3 says Admin dashboard, but they also need their own balances. | Land on the **Admin dashboard**; a **"My home"** item at the top of the "My" nav group opens the employee home S-PT-01. |
| UXQ-02 | Should pending **change requests** appear in the Approvals inbox for Admin, alongside leave and claims? PRD §8.3 lists only leave/cancellations/credits/claims in the inbox. | No — change requests stay in **Employees ▸ Change requests** (S-EM-12) with a count badge on that nav item and a tile on the Admin dashboard. |
| UXQ-03 | **Late-submission override** (F-CLM-21): New claims are visible only to the employee (BR-CLM-27), so how does an Admin find the line to override? | Admin opens **Claims ▸ Late overrides** (S-CL-04), picks the employee, and sees only that employee's **New claims with lines past the deadline** (read-only, line date/category/amount) to tick and override with a reason. Flagged as a spec gap. |
| UXQ-04 | **Requesting cancellation** of started/past leave — must the employee give a reason? Not specified. | Reason **optional** for self-cancel of future leave; **required** (≥ 10 characters) when requesting cancellation that needs approval, so the approver can decide. |
| UXQ-05 | "**HR reassign**" (F-LV-24) has no fields in the PRD. | On a pending leave/claim/credit item, Admin action **Reassign approver**: new approver (active employee, not the applicant) + reason (mandatory); trail shows "Reassigned by …". Also bulk "reassign all pending of <approver>" on S-LV-14. |
| UXQ-06 | Claims batch when an employee's **payment method is Cheque or Cash** (I1): PRD blocks generation for incomplete bank details; EC-PAY-10 lists cheque/cash separately only for payroll. | Treat as for payroll: such employees appear in a separate **"Pay by cheque/cash"** section of the batch and are excluded from the HLB list (no block). Needs your confirmation — otherwise generation is blocked. |
| UXQ-07 | **Phone navigation**: the Interact shell is a left nav. On phones, should EMP/MGR also get a bottom tab bar? | Yes — below 600 px: left nav becomes a drawer (☰) **plus** a bottom bar **Home · Leave · Claims · Approvals (MGR only) · More**. Desktop unchanged. |
| UXQ-08 | **Partial cancellation** of an approved leave range is "Could" in PRD §6.10. | Not designed in R1.0 — the detail shows the hint "To change some days, cancel and apply again." |
| UXQ-09 | The UI reference (`reference-interact-ui.md`) still names roles "Employee / Manager / HR Admin / Finance / Super Admin" and claim chips "draft … paid". | The design uses the **D11 roles** and **D12 statuses**; the Delivery Lead should update that reference doc (outside the UX lane). |
| UXQ-10 | **Leave approval with "Admin override"** (BR-LV-62) — show it as a separate button or as a mode of Approve? | A separate secondary action **"Approve as Admin (override)"** on items still at level 1, requiring a reason; normal Approve shown only when the user is the current-level approver. |
| UXQ-11 | **Probation recommendation** (F-EMP-11): the PRD names the manager's recommendation but not its options. | Manager picks **Confirm / Extend probation (suggested months) / Do not confirm** + remarks (S-AP-08); Admin still confirms or extends. |
| UXQ-12 | **TP1 declarations** (R1.1): can the employee edit or withdraw one before Admin verifies it, and can Admin send one back? PRD lists only "verified by A". | Employee may edit/withdraw until verified; Admin can **Verify** or **Return with a remark**. |
| UXQ-13 | Department, position, grade, manager, location and working pattern are A/S-editable fields, but must keep effective-dated history (§5.5). | They change **only through "Add job change"** (S-EM-05), never by editing the field directly; other employment fields edit inline. |
| UXQ-14 | Payroll approval needs approver ≠ preparer (BR-PAY-18). With only one Super Admin (Albert), a run he prepares can't be approved. | The Admin always prepares runs; a run prepared by an SA waits for another SA. Please confirm whether a second SA will exist (links to PRD Q39). |

## Ready for GATE 2 (design)?

- [x] Every Phase-1 screen listed, by the four D11 roles, with release, mobile class, F-ids and US-ids.
- [x] Every active Phase-1 function covered by a screen or a visible system state (§13).
- [x] Kakitangan screens matched or improved (§14).
- [x] Field-level wireframes exist for every row (see `wireframes.md` index).
- [ ] Albert to confirm or change UXQ-01 – UXQ-14 (none blocks build; defaults are designed).

**Verdict:** Ready for GATE 2 review together with the Architect's `docs/architecture/` design.
