# PRET — Business Requirements Document (BRD)

**Work item:** W1-001 · **Author:** Product / Business Analyst · **Status:** Approved at GATE 1 (Scope), 15/11/2026 — amended for D11–D16
**Last updated:** 15/11/2026 (revised same day for the payroll-in-Phase-1 scope change: D4, D5, D6, D10; and for Albert's Gate 1 decisions D11 four roles, D12 single-level claims approval and month-end disbursement, D13 statutory leave, D14 no PDPA extras, D15 bank details by Admin/SA without confirmation, D16 all payments directly through HLB)
**Builds on:** [`docs/00-README.md`](../00-README.md), [`docs/01-decisions.md`](../01-decisions.md) (D1–D16, R1–R4), [`docs/05-ai-team-operating-model.md`](../05-ai-team-operating-model.md), [`docs/design/reference-interact-ui.md`](../design/reference-interact-ui.md), [`docs/reference/kakitangan-study.md`](../reference/kakitangan-study.md)
**Companions:** [`PRD.md`](PRD.md) (Function Catalogue + field-level requirements), [`user-stories.md`](user-stories.md) (stories + acceptance criteria)

> This BRD states the business case, scope, stakeholders, constraints and success measures
> for PRET. Module mechanics, fields, rules and workflows live in the PRD. Where a
> business need implies a technical choice it is flagged **→ Architect** and not decided
> here. Company-policy answers that the BA cannot invent are **Open Questions** (§11) with a
> clearly labelled proposed default; question ids (Q1–Q46) are shared across all three
> Gate-1 documents.

---

## 1. Business context

**Interact Technology Sdn Bhd** is a Malaysian software company based in Selangor. Kakitangan shows **5 active employees**, **one work location (Selangor)**,
departments **Management / Development / Administration**, and employee numbers `INT-nnn`.
HR administration — employee records, leave, claims and payroll — runs today on
**Kakitangan.com** (D9), operated by an **outsourced admin/finance/payroll administrator**
who is not an Interact employee (D2). Approved claims are reimbursed "with payroll" in
Kakitangan. Finance transactions are recorded in **AutoCount Accounting (Cloud)** (D10);
salaries and reimbursements are paid from **Hong Leong Bank Connect First** (D6).

Albert (Co-owner, Product Owner) has decided to replace Kakitangan with
**PRET**, an **internal, single-company HRMS & Payroll system**, built on the same stack and governance as
Direct Order (D1, D7, D8), delivered in **two releases within Phase 1** (D5):

- **R1.0** — employee master, leave, claims, employee portal (plus organisation set-up, access & audit, reports, notifications, migration). Kakitangan payroll keeps running for salaries, fed monthly with HR changes and unpaid leave; approved claims are paid by the Admin at month end **directly through HLB** (D12, D16).
- **R1.1** — payroll (EPF, SOCSO incl. SKBBK, EIS, PCB/MTD, Zakat, HRDF, PTPTN; payslips; EA forms; statutory reports/files), **parallel-run 2–3 months** against Kakitangan and cut over only when every payslip, statutory amount and payment list **reconciles to the sen**. YTD opening balances are imported so cut-over can be any month.

| # | Driver | Business effect |
|---|--------|-----------------|
| BD1 | Own the system and the data | Configuration (leave types, claim categories, approval flows, pay items) under Interact's control; no per-employee subscription; no lock-in. |
| BD2 | Fit Interact's policy **and the law** | Entitlements configurable and service-banded. The Kakitangan study found **four Employment Act gaps** in the current configuration (maternity 60 vs 98 days; paternity disabled; hospitalisation disabled; annual/sick not service-banded) — PRET defaults are statutory-compliant. |
| BD3 | Mobile-first self-service | Employees apply for leave, submit claims (receipt photo in the flow) and view payslips from a phone browser. |
| BD4 | PDPA-grade control of HR and payroll data | Sensitive personal data (health, religion) and highly confidential data (MyKad, bank, salary) handled by an outsourced administrator → least privilege, masking, full access logging, access window for the external user. PDPA paperwork (processing agreement, DPO, privacy notice) stays with Interact outside the system (D14). |
| BD5 | Bring payroll in-house safely | Payroll calculated from the same master, leave and claims data; statutory tables maintained as dated configuration; parallel run to the sen before Kakitangan is switched off. |
| BD6 | Simple, controlled money movement | No bank or accounting integration: **all payments go directly through HLB** — payment lists (claims at month end in R1.0; salaries, incl. claims paid with salary, in R1.1) keyed manually into HLB Connect First (D6, D16) — and **.xlsx postings for AutoCount** (D10). Controls compensating for one Admin holding several duties: bank-change alerts, access review, SA approval of payroll runs, optional SA approval of claim disbursement batches. |

## 2. Vision

> Every Interact employee can, from their phone, see exactly how much leave they have,
> apply in under a minute, submit a claim with a photo of the receipt, and download their
> payslip — and their manager can approve from the same phone. The outsourced administrator
> runs HR, leave, claims and payroll in one place and pays approved claims at month end;
> Albert approves every payroll with one click; every sensitive access is logged; and every ringgit reconciles — to
> Kakitangan during the parallel run, to HLB on payment, and to AutoCount in the books.

## 3. Business objectives & success metrics

Targets are **proposed** (**Q35**).

| # | Objective | Success metric (proposed target) | Modules | Rel |
|---|-----------|----------------------------------|---------|-----|
| O1 | Replace Kakitangan HR, leave and claims | 100% of active employees migrated; opening leave balances reconcile to Kakitangan with **zero variance** at R1.0 cut-over; Kakitangan HR/leave/claims no longer used one month after R1.0. | M1–M3, M9 | R1.0 |
| O2 | Self-service adoption | ≥ 95% of leave applications and claims submitted by the employee in the portal within 2 months of R1.0; ≥ 50% from a phone. | M4 | R1.0 |
| O3 | Fast approvals | Median leave decision ≤ 1 working day; no item pending > 5 working days without escalation. | M2, M3, M8 | R1.0 |
| O4 | Controlled claim reimbursement | Every claim approved by the month-end cut-off is Disbursed through HLB in that month's batch (or, from R1.1, the payroll run); 100% of Disbursed claims carry a payment reference; 0 hard-limit breaches without a recorded override. | M3 | R1.0 |
| O5 | Statutory-compliant leave | 100% of statutory leave types at or above the EA minimum (no SA override without reason); the four current gaps closed at R1.0. | M2 | R1.0 |
| O6 | PDPA-grade security & auditability | 100% of sensitive views/reveals/downloads/exports logged; external-user access windows always set; monthly access review by SA. (Privacy notice, consent and processing agreement are Interact's matters outside the system — D14.) | M6 | R1.0 |
| O7 | Payroll accuracy | **2–3 consecutive parallel months with zero variance to the sen** on every employee and element (gross, each earning/deduction, EPF, SOCSO, SKBBK, EIS, PCB, zakat, net, payment list) before cut-over; after cut-over, 0 payroll corrections caused by calculation errors. | M10 | R1.1 |
| O8 | On-time statutory compliance | EPF, SOCSO/EIS, PCB (and HRDF, zakat if applicable) reports/files ready ≥ 5 days before the monthly due date (by the 15th — verify); EA forms issued by end of February (verify). | M10 | R1.1 |
| O9 | Clean accounting hand-off | AutoCount .xlsx postings for every claims batch and payroll run import without manual re-keying; journals balance. | M3, M10 | R1.0 / R1.1 |
| O10 | Low admin effort | Administrator spends ≤ 2 hours/month on leave/claim queries and ≤ 1 day/month on payroll after cut-over. | All | R1.1 |
| O11 | Retire Kakitangan | Kakitangan subscription ended within 1 month after R1.1 cut-over, with Kakitangan data that PRET does not hold (e.g. assets, training) exported first (**Q34**). | All | R1.1 |

## 4. Stakeholders & user roles

### 4.1 Stakeholders

| Stakeholder | Who | Interest / needs |
|-------------|-----|------------------|
| **Product Owner & approver** | Albert (Co-owner) | Sole gate approver; owns policy; Super Admin; approves payroll runs (and claim disbursement batches if that optional control is switched on); responsible, for Interact as employer, for PDPA matters handled outside the system (D14). |
| **Employees** | Interact's permanent employees (5 today) | Leave, claims, payslips, EA forms, own data — on a phone; confidence their data is protected. |
| **Managers / approvers** | Employees with reportees | Quick approvals (leave; single-level claim approval); who's away; delegation. |
| **Outsourced HR/finance/payroll administrator** | External service-provider staff — **not an employee** | Holds the **Admin** role (D11): operates HR, leave, claims (approval and month-end HLB payment), bank details and payroll. Least privilege, full access logging, access window with auto-expiry. |
| **Internal Admin** (optional) | An Interact employee granted Admin (e.g. Kakitangan's "Finance Manager" / "HR & Admin" users) | Admin rights + their own leave/claims as employees; never approve or edit their own items. |
| **Directors / co-founders** | Albert; co-founder(s) | Visibility of headcount, leave, claims spend, payroll cost; possible second approver (**Q39**). |
| **Regulators** | JTK, PDP Commissioner, LHDN, KWSP, PERKESO, PSMB (HRDF), state zakat bodies, PTPTN | Statutory compliance; inspections; monthly/annual submissions (R1.1). |
| **Hong Leong Bank Connect First** | Interact's business bank | Salary and claim payments keyed manually from PRET payment lists (D6). |
| **AutoCount Accounting (Cloud)** | Interact's accounting system | Receives .xlsx postings (payroll journal, claims) — no integration (D10). |
| **Kakitangan.com** (outgoing) | Incumbent SaaS | Migration source (D9); keeps running payroll until R1.1 cut-over; parallel-run comparison source. |
| **Payroll / statutory specialist** (future role, op-model §6) | Adviser | Verifies statutory tables, PCB method and file formats before R1.1 Gate 3. |

### 4.2 Application roles (decided — **D11**, Q3)

Albert's answer: "Based on roles. Super admin (every thing), manager of employees, employees, admin (finance, payroll, emp records)". Four roles; no per-module admin assignment.

| Code | Role | Holder | Scope | Notes |
|------|------|--------|-------|-------|
| SA | **Super Admin** | Albert (+ optional second director) | Everything, incl. users/roles, audit logs, statutory employer numbers | Only SA assigns roles and views audit/access logs; approves payroll runs (R1.1); ≥ 1 active SA always. |
| MGR | **Manager** | Derived from the reporting line, or an active delegate | Their reportees | Approves leave and claims of reportees; team calendar and team reports; no access to reportees' NRIC, bank, statutory, family or religion data. |
| EMP | **Employee** | Every employee user (automatic) | Own records | Never granted to an external administrator. |
| ADM | **Admin** | The outsourced administrator (External user); optionally an Interact employee | Employee records/HR, leave admin, claims/finance (approval, month-end HLB payment, AutoCount export), bank details (D15), payroll (R1.1) | No audit-log access; cannot assign roles; cannot approve a payroll run; no self-approval or editing of own sensitive fields. |

The **external administrator** is a user type with no employee record, no leave/claims/payslips; it holds ADM and has an access window with automatic expiry and enhanced access logging (no processing-agreement fields — D14).

## 5. Scope

### 5.1 Phase 1 — Release R1.0 (D4, D5)

| Module | Business capability | Priority |
|--------|---------------------|----------|
| **M1 Employee master records** | Full Malaysian profile matching or improving on Kakitangan's General / Employment / Family tabs: MyKad-validated identity, contact, emergency contacts, spouse/children with PCB categories, employment and effective-dated history, probation, separation; **Kakitangan's Compensation-tab statutory fields captured now and used by payroll in R1.1** (PCB, EPF, SOCSO/SKBBK, EIS, Zakat, HRDF, PTPTN, bank, ASNB); restricted documents; HR notes; self-update with HR approval for sensitive changes. | Must |
| **M2 Leave management** | Statutory seed leave types (D13: sick 14/18/22, hospitalisation 60-day pool, maternity 98, paternity 7; annual 12/12/16 kept); current-year corrections at migration; service bands; Kakitangan's engine options (accrual pro-rata by day, round up to ½ day, carry-forward cap 10 expiring after 3 months, replacement credit, emergency flag within 3 days, Direct Manager → Admin workflow, custom workflows); state PH calendars; half days; balance preview; cancellations; adjustments; year-end roll-over; team calendar. | Must |
| **M3 Claims management** | Interact's 20 claim categories; mileage RM/km; Medical RM 300/transaction; per-line SST, receipt/e-Invoice no. and MyInvois UUID; limits by transaction/month/year with overrides; **single-level approval** by the Manager or an Admin or a Super Admin (D12); statuses New, Submitted, Approved, Disbursed, Rejected, Withdrawn, Cancelled; copy a rejected claim; bulk approve/reject; attachment bundle; **month-end disbursement batch paid directly through HLB** (manual payment list, D16) with optional SA approval (default off); **AutoCount .xlsx** postings. | Must |
| **M4 Employee self-service portal** | Mobile-first: home dashboard, apply leave, balances, claims with camera receipts, profile & change requests, approvals inbox, notifications; payslips/EA forms added in R1.1. | Must |
| **M5 Organisation & company setup** | Company and statutory employer numbers; departments, positions, grades; work locations by state; working-week patterns; PH calendars with replacement holidays; settings. | Must |
| **M6 Users, roles, access & audit** | Employee and external users; four roles (SA, MGR, EMP, ADM — D11); MFA for privileged roles; access windows; masking; append-only audit and sensitive-access logs; optional company privacy notice page (no acknowledgement — D14); DSR log; breach-readiness; retention. | Must |
| **M7 Reports & exports** | HR, leave and claims reports; dashboards (Admin, Manager); CSV/.xlsx on every list; **monthly payroll-input pack for Kakitangan payroll** (HR changes and unpaid leave, no claims — D16; until R1.1 cut-over). | Must |
| **M8 Notifications** | Email + in-app for every workflow event; reminders; PDPA-safe content. | Must |
| **M9 Data migration** | CSV/.xlsx templates and validated imports from Kakitangan; opening leave balances; reconciliation sign-off. | Must |

### 5.2 Phase 1 — Release R1.1 (D5, D6, D10)

| Module | Business capability | Priority |
|--------|---------------------|----------|
| **M10 Payroll** | Pay groups; monthly run Draft → In Review → Pending Approval → Approved → Finalised, re-open with audit; earnings (basic, fixed/variable allowances, overtime, commission, bonus, arrears), unpaid-leave deduction from M2, approved claims from M3 paid with salary as non-taxable reimbursement (Disbursed on finalise); deductions; **EPF** (incl. extra employee/employer %), **SOCSO incl. SKBBK**, **EIS**, **PCB/MTD** (LHDN computerised method, reliefs from master data, additional remuneration, TP1/TP3, CP38), **Zakat** offset, **HRDF** levy, **PTPTN**; effective-dated statutory tables; payslips in the portal (PDF); **Borang EA**; Form E data; statutory reports/files for **KWSP, PERKESO (SOCSO + EIS), LHDN e-PCB/CP39, HRDF**; **salary payment list (report + .xlsx) for manual keying into HLB Connect First**; **AutoCount payroll journal .xlsx**; payroll reports (summary, department/cost centre, variance vs last month); YTD and compensation import from Kakitangan; parallel-run reconciliation to the sen. | Must |

### 5.3 Later candidates (not in Phase 1 unless Albert adds them — Q34)

Kakitangan features outside current scope: company assets register, training & certifications, letter templates, performance appraisal (Talenta), attendance (Hadir), Benefits/Insurance/Investment modules. Org chart is included in R1.0 as a "Could".

### 5.4 Out of scope

- **Any bank interface** — no HLB file format, no API (D6); payment lists only.
- **Any accounting integration** — AutoCount gets .xlsx exports only (D10); no QuickBooks/Bukku.
- Multi-company / multi-tenant (D1); foreign workers, expatriates, work permits, non-Malaysian statutory rules (D3).
- Non-permanent employment types (contract, part-time, intern) — reserved values only.
- Cash advances; corporate cards; panel-clinic direct billing; LHDN e-Invoice submission.
- Native iOS/Android apps (responsive web; PWA is a "Could").
- Bahasa Malaysia UI (R2). The optional company privacy notice is shown as Interact publishes it (its languages are Interact's responsibility — D14).
- PDPA paperwork as system features (D14): processing-agreement records or go-live block, DPO set-up, privacy-notice acknowledgement, consent capture.
- Kakitangan payroll handover of claims (D16) — claims are paid directly through HLB.
- SSO (later option, R3); live integration with Kakitangan (one-off imports only, R4).

## 6. Constraints

| # | Constraint | Source | Implication |
|---|-----------|--------|-------------|
| C1 | **Employment Act 1955 as amended 2022 (in force 01/01/2023)** — leave, PH, rest day, notice, overtime minimums. | D3 | Defaults ≥ statutory; Interact's more generous policy configurable per type and service band; four Kakitangan gaps corrected. Citations in PRD §4 (**verify** items for HR/legal adviser). |
| C2 | **PDPA 2010 as amended 2024** | D3, D14 | In the system: sensitive data handling; least privilege; masking; access logging; retention; DSR within 21 days; data portability readiness; breach-readiness extract. Outside the system (Interact as employer, D14): s7 notice, consent basis, processor agreement, DPO, Singapore cross-border basis (R1). |
| C3 | **EPF Act 1991, Employees' Social Security Act 1969, EIS Act 2017, Income Tax Act 1967 and MTD Rules, PSMB Act 2001, state zakat rules, PTPTN** | D3, D5 | Payroll in R1.1 from effective-dated official tables; specialist verification before R1.1 Gate 3; statutory file formats from official specs (**Q41**). |
| C4 | Malaysian law only; all employees Malaysian | D3 | MYR only; nationality fixed. |
| C5 | Fixed stack and hosting | D7, R1 | Architecture decisions belong to the Architect. |
| C6 | Interact UI pattern | UI reference | Every list: filter card, EXPORT .CSV / ADD NEW / CLEAR / SEARCH, chips, pagination. |
| C7 | dd/mm/yyyy · RM 1,234.56 · Asia/Kuala_Lumpur · English UI | CLAUDE.md, R2 | Global requirements in PRD §2. |
| C8 | No real employee data in repo/tests/docs; anonymised references only | R4, CLAUDE.md | Golden payroll test cases from anonymised Kakitangan data with Albert's approval (**Q44**). |
| C9 | **No bank interface** (manual HLB) | D6 | Payment lists must be accurate, approved and access-logged. |
| C10 | **No accounting integration** (AutoCount .xlsx) | D10 | Export layout from AutoCount's import template (**Q37**). |
| C11 | **Payroll cut-over only at zero variance to the sen** after 2–3 parallel months | D5 | Parallel mode, Kakitangan results import, reconciliation report, SA sign-off. |
| C12 | Small company, one administrator | D2, D11, D15 | Configuration over code; one Admin role; SA approval of payroll runs; optional SA approval of claim disbursement batches (default off); bank details by Admin/SA without confirmation but with change alerts to employee and SA; access review. |

## 7. Assumptions (flag if wrong)

| # | Assumption | Impact if wrong |
|---|-----------|-----------------|
| A1 | 5 employees today, one location in Selangor; design for up to 200 (**Q2**). | More states → more PH calendar admin; volume not a scope change. |
| A2 | Every user has a company email (login); employees have smartphones. | Kakitangan's "No Email" option would need an alternative identity → Architect. |
| A3 | Leave year = calendar year (as Kakitangan). | Anniversary years change entitlement/roll-over logic. |
| A4 | All employees permanent full-time. | Other types need different rules. |
| A5 | The outsourced administrator holds Admin; Albert holds Super Admin (D11). | A second Super Admin would change payroll-approval options (**Q39**). |
| A6 | Kakitangan payroll runs salaries until R1.1 cut-over, fed by PRET's monthly payroll-input pack (HR changes, unpaid leave — no claims) (D5, D16, **Q5**). | — (decided). |
| A7 | In R1.0, approved claims are paid at month end directly through HLB (D12, D16); from R1.1 they may be paid with salary in the PRET payroll run. | — (decided). |
| A8 | Compensation is captured at R1.1 migration, not in R1.0 (**Q6**). | If earlier, salary access controls are needed in R1.0. |
| A9 | Kakitangan can export employees, leave balances/history, claims and monthly payroll results (Excel/CSV) (**Q1**, **Q44**). | Manual entry; longer parallel-run set-up. |
| A10 | Official statutory specs (KWSP, PERKESO, LHDN e-PCB, Form E) and the AutoCount import template are obtainable (**Q37**, **Q41**). | Reports only until formats are known. |
| A11 | Payroll is monthly with one pay group. | Additional frequencies are out of scope. |

## 8. Dependencies & hand-offs

| # | Dependency / hand-off | Owner |
|---|-----------------------|-------|
| H1 | Append-only audit store, sensitive-field protection, private file storage, malware scanning. | → Architect / Security |
| H2 | Auth: email + password (R3), MFA for privileged roles (**Q31**), lockout, session timeout. | → Architect |
| H3 | Scheduled jobs (status changes, accruals, expiries, reminders, access expiry) in MYT, idempotent. | → Architect |
| H4 | Exact-decimal payroll engine, versioned statutory tables, deterministic recalculation. | → Architect |
| H5 | Transactional email (SPF/DKIM/DMARC). | → Architect / DevOps |
| H6 | Cross-border transfer record for Singapore hosting. | → Security / legal adviser |
| H7 | Processing agreement with the administrator; privacy notice text (optionally published in the portal) — outside the system (D14). | Albert / legal adviser |
| H8 | Kakitangan exports and anonymised payroll samples (golden tests). | Albert (**Q1**, **Q44**) |
| H9 | Official statutory file specs; AutoCount import template and GL list. | Albert / administrator (**Q37**, **Q41**) |
| H10 | Tax-adviser confirmation of claim tax treatments; payroll specialist verification of tables and PCB. | Albert (**Q24**); future payroll specialist role |

## 9. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| RK1 | Screens built thin (Direct Order Gate-3 failure). | Med | High | Field/control-level PRD; Gate-2 wireframes traced to field tables. |
| RK2 | Leave balances at R1.0 cut-over differ from Kakitangan. | Med | High | Opening-balance import as at cut-over; reconciliation sign-off. |
| RK3 | PCB/statutory calculation differences. | Med | High | Official tables as config with maker-checker; golden tests from anonymised Kakitangan data; parallel run to the sen (D5). |
| RK4 | Statutory file formats unavailable or change. | Med | Med | Reports from day one; files built to official spec; validated in parallel run. |
| RK5 | Statutory interpretation errors (EA/PDPA). | Med | High | **verify** flags; adviser review before Gate 3. |
| RK6 | Administrator misuse/over-access (one Admin role covers HR, claims, bank details and payroll — D11, D15). | Low | High | Logging of every record the external user opens; bank-change alerts to the employee and SA; access review flags "bank change + payment-list export by the same user"; SA approval of payroll runs; optional SA approval of claim batches; access-window expiry. |
| RK7 | Manual HLB keying errors. | Med | Med | Payment list totals locked to run/batch totals; payment reference recorded; reconciliation to bank; undo disbursement for bank rejections. |
| RK8 | Correcting the four leave gaps raises questions on past entitlements. | Med | Med | D13: current-year correction by adjustment at migration; earlier years — verify with legal adviser. |
| RK9 | Kakitangan needed longer than planned. | Med | Low | Parallel-run criteria explicit; any-month cut-over via YTD import. |

## 10. Glossary

| Term | Meaning |
|------|---------|
| MyKad / NRIC | Malaysian identity card; 12 digits YYMMDD-PB-###G. |
| EPF / KWSP | Employees Provident Fund. |
| SOCSO / PERKESO | Social Security Organisation; SKBBK — scheme flag as labelled in Kakitangan (to confirm, **Q40**). |
| EIS | Employment Insurance System. |
| PCB / MTD | Monthly tax deduction (LHDN); TP1 = monthly relief declaration; TP3 = previous-employment declaration; CP38 = LHDN additional-deduction order; CP39 = monthly PCB return. |
| HRDF / PSMB | Human Resources Development levy. |
| PTPTN | National higher-education loan fund (salary deduction). |
| ASNB | Amanah Saham Nasional Berhad (salary deduction to unit trust account). |
| Borang EA / Form E | Employee annual remuneration statement / employer annual return. |
| MyInvois UUID | Unique identifier of an LHDN e-Invoice. |
| R1.0 / R1.1 | Phase-1 releases: HR/leave/claims/portal; payroll (D5). |
| Parallel run | Running PRET payroll alongside Kakitangan and comparing results before cut-over. |

---

## 11. Open Questions for Albert (business-level subset)

The full list (**Q1–Q46**) with proposed defaults is in [`PRD.md` §17](PRD.md#17-open-questions-for-albert). These are the ones that change **business scope, compliance posture or go-live readiness**:

| ID | Question | Proposed default |
|----|----------|------------------|
| **Q1** | Anonymised samples of Kakitangan exports (employees, leave balances/applications, claims) and confirmation that `kakitangan-study.md` reflects the live set-up. | **Proposed default:** treat the study as current; import templates accept Kakitangan's export columns once samples arrive. |
| **Q2** | Headcount growth; any staff based outside Selangor; HRDF registration. | **Proposed default:** design for 200; one Selangor location; HRDF off unless confirmed. |
| **Q3** | Roles and holders. | **Answered — D11:** four roles — Super Admin, Manager, Employee, Admin (finance, payroll, employee records); the outsourced administrator is an External user holding Admin. |
| **Q4** *(updated — D16)* | R1.0 claims payment. | **Answered — D12 and D16:** one approval, then month-end payment by the Admin **directly through HLB**; no Kakitangan payroll handover; from R1.1 claims may be paid with salary in the PRET payroll run. |
| **Q5** *(updated — D16)* | How unpaid leave and HR changes are entered into Kakitangan payroll in R1.0. | No longer needed for claims (D16). **Proposed default:** monthly .xlsx pack for manual keying. |
| **Q7** | Fix the four EA gaps at R1.0. | **Answered — D13:** statutory entitlements (sick 14/18/22, hospitalisation 60 aggregate, maternity 98, paternity 7); annual 12/12/16 kept; current-year correction by adjustment at migration. Marriage / Study-Exam leave still open (default inactive). |
| **Q20** | Claims approval chain and segregation. | **Answered — D12:** single approval by Manager or Admin or Super Admin; optional SA batch approval (default off); bank details by Admin/SA without confirmation (D15). |
| **Q30** | PDPA extras. | **Answered — D14:** not required as system features (no DPA fields/go-live block, DPO set-up, acknowledgement or consent capture); optional privacy-notice page; hosting stays Singapore (R1). |
| **Q33** | Target dates for R1.0 go-live and the R1.1 parallel run. | **Proposed default:** R1.0 on the 1st of a month after Gate 3; R1.1 parallel run 3 months, cut-over after 2–3 zero-variance months. |
| **Q34** | Kakitangan features outside scope (assets, training, letters, appraisal, Hadir, benefits). | **Proposed default:** later candidates; export their data before Kakitangan ends. |
| **Q35** | Confirm success targets (§3). | **Proposed default:** as written. |
| **Q37** | AutoCount import templates and GL list. | **Proposed default:** claims expensed at approval to claims payable; layouts built from the template once supplied. |
| **Q41** | Official KWSP / PERKESO / LHDN e-PCB / Form E file specs and anonymised samples. | **Proposed default:** reports from day one; files built to spec and validated in the parallel run. |
| **Q44** | 2–3 months of anonymised Kakitangan payslips/payroll summaries for golden tests. | **Proposed default:** Delivery Lead anonymises with Albert's approval; raw files stay outside the repo. |

---

## 12. Ready for GATE 1? (self-check)

- [x] Business context reflects the Kakitangan study (5 employees, Selangor, outsourced administrator, claims paid with payroll, AutoCount, HLB).
- [x] Scope updated for D4/D5/D6/D10: **payroll in Phase 1 as R1.1**, manual HLB payment lists, AutoCount .xlsx; later candidates and out-of-scope explicit.
- [x] Objectives with measurable (proposed) targets per release, incl. **parallel run to the sen**.
- [x] Stakeholders and the four roles (D11) with the non-employee administrator as an External user holding Admin.
- [x] Albert's Gate 1 decisions D11–D16 folded in: roles, single-level claims approval and month-end disbursement, statutory leave, no PDPA extras, bank details without confirmation, all payments directly through HLB.
- [x] Constraints cite Malaysian law; Kakitangan compliance gaps surfaced and decided (D13); assumptions, dependencies and risks recorded; no architecture decisions taken.
- [ ] **Albert to supply Q37/Q41/Q44 inputs before R1.1 build** and confirm the remaining defaults (Q3, Q4, Q7 main part, Q20, Q30 answered). Defaults allow Gate-2 design to proceed.

**Verdict:** Ready for GATE 1 review on Albert's decisions D11–D16 and the remaining proposed defaults.
