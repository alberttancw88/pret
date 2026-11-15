# PRET — Wireframes: Payroll (Release 1.1)

**Work item:** W1-004 · **Author:** UX Designer · **Status:** Draft for GATE 2 (Design) · **Last updated:** 15/11/2026
**Shared primitives:** [`wireframes.md`](wireframes.md) §0. **Screens:** S-PY-01 – S-PY-20. **Roles:** ADM, SA (approve / return / re-open and statutory-table verification: SA only). Employee payroll screens (payslips, EA, YTD, TP1) are in `wireframes-portal.md` §P21–P25. Field ids are PRD §14 (`PS` settings, `PI` pay item, `CP` compensation, `PR` run, `PL` payroll line).
**Payroll data is visible only to ADM, SA and the employee (own) — never to Managers (FR-PAY-11).** Parallel-mode screens and outputs carry a persistent banner/watermark **"PARALLEL – NOT FOR PAYMENT / SUBMISSION"** (PR5).

---

## Y1 · Payroll settings — S-PY-01 · `/payroll/setup/settings` · F-PAY-01 · US-PAY-001
Form cards: *Period & pay date* — PS1 Pay period 🔒 Monthly · PS2 Pay date rule * (Last working day / Fixed day N → N) · *Input cut-offs* — PS3 Leave input cut-off * (Period end / Day N) · PS4 Claims input cut-off * (At calculation / Day N) · *Rates & proration* — PS5 Proration * (Calendar days / Working days / 26-day basis) · PS6 Daily rate * (÷ 26 / ÷ working days / ÷ calendar days) · PS7 Hourly rate (formula shown, read-only) · PS8 Overtime multipliers (Normal / Rest day / PH) + eligibility (wage ≤ RM 4,000 / all) · PS9 Net pay rounding (None / RM 0.05) · *Payslip* — PS10 Show YTD · Show employer contributions · Show leave balances · Publish (On finalise / On pay date at 08:00) · PS11 Payment reference template (`SALARY <MMM yyyy>`, preview) · *Controls* — PS12 Statutory due-day reminder (day) · PS13 Variance threshold (%). "(verify)" hints next to PS5–PS8 (Q42, Q43). `SAVE`.

## Y2 · Pay groups — S-PY-02 · `/payroll/setup/pay-groups` · F-PAY-02
List: Code › · Name · Pay date rule · Members · Active ● · `ADD PAY GROUP` · `EXPORT .CSV`. Form: Code * · Name * · Pay date rule override · Active *. Members are set on each employee (F29); the form lists members read-only with a link to bulk update (S-EM-14). Seed "MONTHLY – All staff".

## Y3 · Pay items — S-PY-03 · `/payroll/setup/pay-items` · F-PAY-03 · US-PAY-003
List: Search code/name · Filters Type, Category, Recurrence, Active · Columns Code › · Name · Payslip label · Type · Category · Recurrence · PCB treatment · EPF/SOCSO/EIS/HRDF wages (4 ticks) · EA line · GL debit / credit · Active ● · `ADD PAY ITEM` · `EXPORT .CSV`. Form: PI1 Code * · PI2 Name * / Payslip label * · PI3 Type * · PI4 Category * · PI5 Recurrence * · PI6 PCB treatment * (+ annual exempt limit if "Exempt up to") · PI7 EPF wages · SOCSO wages · EIS wages · HRDF wages * (defaults per category, "(verify)" hint) · PI8 Prorate on join/leave * · PI9 In daily-rate base * · PI10 EA form line * (earnings) · PI11 AutoCount GL debit * / credit * · PI12 Show on payslip / display order * · PI13 Active * (blocked if used in an open run). System statutory items (EPF, SOCSO, SKBBK, EIS, PCB, CP38, Zakat, HRDF, PTPTN) 🔒 except labels and GL.

## Y4 · Statutory tables — S-PY-04 · `/payroll/setup/statutory-tables` · F-PAY-05 · US-PAY-005
List: Table (EPF contribution / SOCSO / SKBBK / EIS / PCB-MTD / HRDF / Zakat bodies / Minimum wage) · Version › · Effective from · Source document · Entered by · Verified by · Status ● (Draft / Verified / Superseded) · `NEW VERSION` · `EXPORT .CSV`. Banner: "PCB table for 2029 not verified — January payroll will be blocked" (EC-PAY-08).
Version detail: header (Effective from * · Source: title *, issuer *, date *, URL/reference *) · rows grid per table type (e.g. EPF: Category · Wage from · Wage to · Employee (RM) · Employer (RM) + rule for wages above last band; PCB: year, spec version, schedule rows, relief values, rebates, rounding) · `IMPORT ROWS (.xlsx)` · `SAVE DRAFT`. **Verify** (SA, ≠ entered by): checklist "[x] I compared these rows with the source document" · `VERIFY TABLE` → Verified; previous version → Superseded. Maker sees "Waiting for a Super Admin to verify."

## Y5 · Compensation — S-PY-05 · profile tab 7 on S-EM-03 · F-PAY-04, F-EMP-17 · US-PAY-004
Current card: CP1 Basic salary (monthly, RM — hidden until `Show`, logged for non-owner) · CP2 Effective date · CP3 Reason. History table: Effective date · Basic (RM) · Change (RM / %) · Reason · Remarks · Entered by/at. Recurring items table (CP5): Pay item · Amount (RM) · Start month · End month · Remarks · ⋮ Edit / End. Buttons `ADD SALARY CHANGE` · `ADD RECURRING ITEM` (not on own record; SA's own compensation edited by ADM → flag "Will appear on the access review" — Q39, EC-PAY-12).
Salary change dialog: CP1 New basic * (warning below minimum wage) · CP2 Effective date * (back-dated → "Arrears of RM x for n months will be added to the next run", EC-PAY-02) · CP3 Reason * · CP4 Remarks (* if Correction) · `SAVE`.
Recurring item dialog: Pay item * (Recurring items) · Amount * · Start month * · End month · Remarks.

## Y6 · Payroll runs — S-PY-06 · `/payroll/runs` · F-PAY-06/26 · US-PAY-006, 026
List: Search run no. · Filters Year, Status (Draft / In Review / Pending Approval / Approved / Finalised / Cancelled), Type (Regular / Off-cycle / Correction), Mode (Parallel / Live) · Columns Run no. › · Period · Pay group · Type · Mode ● · Employees · Gross (RM) · Net (RM) · Status ● · Pay date · Approved by · Version · `NEW RUN` · `EXPORT .CSV`. Default sort Period desc.

## Y7 · New payroll run — S-PY-07 · dialog · F-PAY-06/26
PR2 Period (month) * · PR3 Pay group * · PR4 Run type * (Regular / Off-cycle — bonus or additional remuneration / Correction) · PR5 Mode * (Parallel until cut-over sign-off — Live disabled with tooltip "Available after cut-over sign-off on S-PY-20") · PR6 Pay date * (default from PS2). Checks: one Regular run per period × pay group; statutory tables verified for the period (warning now, blocking at calculation). `CREATE RUN` → S-PY-08 Draft with employee snapshot (BR-PAY-02).

## Y8 · Run detail — S-PY-08 · `/payroll/runs/{no}` · F-PAY-07–25 · US-PAY-006–026

```
┌ PR-2028-11-01 · Nov 2028 · MONTHLY – All staff · Regular · ●Live      ●In Review  v1 ┐
│ Employees 57 · Gross RM … · Employee statutory RM … · Other ded. RM … · Net RM …        │
│ Employer EPF RM … · SOCSO RM … · EIS RM … · HRDF RM … · Employer cost RM … · Claims reimbursed RM … │
│ Exceptions: ✕ 2 blocking · ⚠ 5 warnings                                                  │
│ [CALCULATE] [SUBMIT FOR APPROVAL] [⋮ Cancel run]                                         │
├ Employees | Inputs | Leave & claims pulled | Exceptions | Variance vs last month | Outputs | History ┤
```
Totals strip = PR8; exceptions count = PR9; preparer/approver/finaliser = PR11.
| Tab | Content |
|-----|---------|
| Employees | List: Search name/no. · Filters Department, Exceptions only, Joiners/leavers, Pay method · Columns Employee › (→ S-PY-09) · Department · Basic · Gross · EPF ee · SOCSO ee · EIS ee · PCB · Zakat · Other ded. · Net · Exceptions (✕/⚠ count) · Payslip status · `EXPORT .CSV` |
| Inputs | S-PY-10 variable inputs grid |
| Leave & claims pulled | *Unpaid leave:* Employee · Dates · Days · Daily rate · Deduction · Reference › (incl. adjustment lines from finalised periods, BR-PAY-04) · *Claims:* Claim no. › · Employee · Approved on · Amount · Treatment (Reimbursement / Taxable allowance) — claims show this run no. while Approved (BR-PAY-05); claims in an open disbursement batch are excluded with a note |
| Exceptions | Grouped Blocking / Warnings: Employee › · Exception (e.g. "Missing EPF no.", "Net pay below zero", "Variance 18% vs last month", "First payroll — TP3 not recorded") · Action link (→ profile tab / S-PY-19 / S-PY-09) · Warning comment (required at approval if open, BR-PAY-18) |
| Variance vs last month | Employee · Element · Last month · This month · Difference (RM, %) — highlighted over PS13; filter element, over threshold only |
| Outputs | After approval: Salary payment list (S-PY-13). After finalise: Payslips (S-PY-14) · Statutory outputs for the month (S-PY-16) · AutoCount journal (S-PY-18) · Payroll reports (S-PY-17) — each with version, generated at, status (Current / Superseded), download (logged) |
| History | Audit of every input, calculation, submit, approve/return, finalise, re-open with by/at/reason (F-PAY-41) |
Actions by status (role):
| Status | Actions |
|--------|---------|
| Draft | `CALCULATE` (ADM, SA) · edit inputs · `CANCEL RUN` (reason) |
| In Review | `CALCULATE` (recalculate) · `SUBMIT FOR APPROVAL` (disabled while blocking exceptions exist: "Resolve 2 blocking exceptions") · edit inputs (returns to Draft on change) |
| Pending Approval | SA (≠ preparer): `APPROVE` / `RETURN` (S-PY-11) · ADM: view only |
| Approved | `FINALISE` (ADM, SA; confirm "Lock results, update YTD, publish payslips {on pay date 08:00}, generate statutory outputs, set n claims Disbursed?") · SA `RETURN` before finalise |
| Finalised | SA `RE-OPEN` (S-PY-12) · downloads |
| Parallel mode | `FINALISE` labelled `CLOSE PARALLEL RUN` — no publishing, no claim status change, separate parallel YTD (BR-PAY-19); link to S-PY-20 |

## Y9 · Employee payroll line — S-PY-09 · `/payroll/runs/{no}/employees/{employeeNo}` · F-PAY-22, F-PAY-40 · US-PAY-022, 040
Header: Employee · Department · Cost centre · Position · Pay group (PL1 snapshot) · prev/next employee arrows. Cards: *Days* PL2 (days in period · paid · unpaid · prorate factor) · *Earnings* PL3 (Item · Qty/hours · Rate · Amount · Source chip: Compensation / Variable input / Leave / Claims / Final pay / System · PCB treatment) · *Deductions* PL4 (Item · Amount · Source) · *Statutory* PL5–PL9 (EPF wages / ee / er incl. extra % · SOCSO wages / ee / er · SKBBK · EIS wages / ee / er · PCB normal · PCB additional · CP38 · Zakat · PCB payable after zakat · HRDF levy · PTPTN) with ⓘ "How calculated" (table version, band, inputs) · *Totals* PL10 (Gross · Total deductions · **Net** · Employer cost) · *YTD after this run* PL11 · *Exceptions* PL12.
**Final pay card** (leaver with LWD in the period, F-PAY-40): Leave position from F-LV-27 (encashable / recoverable days × daily rate) · Notice shortfall days (G6) with choice * (•) Deduct pay in lieu (•) Waive (reason *) · Last-month proration (shown) · `APPLY TO RUN`. Net < 0 → blocking, waiver option with reason (EC-PAY-09). Payslip preview `VIEW PAYSLIP (DRAFT)`.

## Y10 · Variable inputs — S-PY-10 · Inputs tab of S-PY-08 · F-PAY-07/08/21 · US-PAY-007, 008, 021
Grid (editable while Draft/In Review): Employee * · Pay item code * (one-off items) · Qty / hours · Rate · Amount (RM) (computed for overtime: hours × multiplier × hourly rate, or fixed) · Remarks · Source (Manual / Import IM-… / Replacement-credit pay BR-LV-84) · ⋮ delete. `ADD ROW` · `IMPORT .XLSX` (template: employee no., pay item code, qty/hours, rate, amount, remarks — validate → error table → commit) · `DOWNLOAD TEMPLATE` · `EXPORT .CSV`. Filters employee, pay item. Any change after calculation shows "Recalculate to apply changes" and returns the run to Draft.

## Y11 · Approve / return run — S-PY-11 · dialog · F-PAY-23 · US-PAY-023 · SA
Shows: totals PR8 · variance summary vs last month · open warnings (each needs acknowledgement) · preparer. Fields: Comment (* if open warnings or Return) · `[(RETURN TO DRAFT)] [APPROVE RUN]`. Preparer = me → "You prepared this run — another Super Admin must approve" (BR-PAY-18; Q39 when only one SA exists — see UXQ-14). Approve → salary payment list generated (N-31 to ADM).

## Y12 · Re-open finalised run — S-PY-12 · dialog · F-PAY-25 · US-PAY-025 · SA
Reason * (≥ 10 chars). Warning list of outputs already used: "Salary payment list downloaded 30/11/2028 (keyed at HLB?)", "e-PCB file generated", "KWSP file generated" — "These will be marked Superseded; correct or resubmit them manually." · claims in the run: "n claims stay Disbursed while they remain in the run (EC-CLM-12)". `RE-OPEN RUN` → Draft, version +1, N-33.

## Y13 · Salary payment list — S-PY-13 · `/payroll/runs/{no}/payment-list` · F-PAY-28 · US-PAY-028
Header: Company · Paying account "Hong Leong Bank ••••4321" · Run no. · Pay date · Count · Total net (RM) · Prepared by / Approved by · Version. Columns: No. · Employee no. · Beneficiary name · Bank · Bank code/BIC · Account no. (full, logged) · Amount (net pay, incl. claims reimbursed) · Payment reference (PS11) · Description · Beneficiary email · Status (Pending / Paid / Failed). Totals row = run net total (✓ check). Separate section **"Pay by cheque/cash"** (EC-PAY-10). Buttons `DOWNLOAD .XLSX` · `DOWNLOAD PDF` · `PRINT` · `RECORD PAYMENT` → dialog: Payment date * · HLB reference * · per-employee failures (select employees · reason) → failed lines listed for re-payment. Parallel mode: watermark, download allowed for comparison only.

## Y14 · Payslips — S-PY-14 · `/payroll/payslips` · F-PAY-27 · US-PAY-027
Filters: Run * · Department · Payslip status (Not generated / Generated / Published / Viewed / Revised) · search employee. Columns: Employee › · Month · Net (RM) · Status ● · Published at · Viewed at · `VIEW` (S-PT-22, logged) · `DOWNLOAD`. Buttons `DOWNLOAD ALL (.zip)` (logged) · `RE-SEND NOTICE` (selected; N-32 without amounts) · `EXPORT .CSV`. Publication time shown ("Publishes 30/11/2028 08:00").

## Y15 · Annual returns: EA forms & Form E — S-PY-15 · `/payroll/annual` · F-PAY-29/30 · US-PAY-029, 030
Year of assessment * selector. *EA forms* tab: list Employee › (incl. separated in the year) · Status ● (Draft / Final / Issued / Re-issued) · Generated at · Issued at · `VIEW` · `DOWNLOAD`; buttons `GENERATE DRAFTS` · `MARK FINAL` (selected) · `ISSUE TO EMPLOYEES` (N-34; portal S-PT-23) · `RE-ISSUE` (correction, reason) · `DOWNLOAD ALL (.zip)` · `EXPORT .CSV`. Validation: missing tax no./claims treatment → listed. *Form E (C.P.8D)* tab: summary (employees paid, remuneration, PCB totals) · `GENERATE .XLSX` (format per Q41) · versions list. Reminders: "EA forms due to employees by end of February; Form E by 31 March (verify)".

## Y16 · Statutory outputs — S-PY-16 · `/payroll/statutory` · F-PAY-31–36 · US-PAY-031–036
Month * selector (finalised Live runs only; Parallel watermarked). One row per output: Output · Status (Not generated / Generated / Superseded) · Generated at · Due date (PS12) · `VIEW REPORT` · `DOWNLOAD FILE` · `DOWNLOAD .XLSX`:
| Output | Report columns (on-screen) | File |
|--------|---------------------------|------|
| KWSP contribution (F-PAY-31) | EPF no. · MyKad (masked on screen) · Name · Wages · Employee share · Employer share · totals | Upload file per KWSP spec (Q41) |
| PERKESO SOCSO + EIS (+ SKBBK) (F-PAY-32) | Employer code · MyKad · Name · Wages · SOCSO ee/er · EIS ee/er · Join/leave dates | ASSIST upload file (Q41) |
| LHDN e-PCB / CP39 (F-PAY-33) | Tax no. · MyKad · Name · PCB · CP38 | e-PCB file (Q41) |
| HRDF levy (F-PAY-34) | Employee · HRDF wages · Levy | .xlsx |
| Zakat (F-PAY-35) | Per zakat body: Employee · MyKad · Account no. · Amount | .xlsx per body |
| PTPTN (F-PAY-35) | Employee · MyKad · Amount | .xlsx |
| CP22 / CP22A data (F-PAY-36) | New employees / leavers particulars | .xlsx |
All downloads access-logged. Banner N-35 when due within 3 days.

## Y17 · Payroll reports — S-PY-17 · `/payroll/reports` · F-PAY-37, F-RPT-26 · US-PAY-037
Catalogue cards → report viewer template (S-RP-03), each with `EXPORT .CSV` / `.XLSX`:
| Report | Filters | Columns |
|--------|---------|---------|
| Payroll register | Run · Department | Employee × every element (earnings, deductions, statutory ee/er, net) |
| Summary by department | Run or month range | Department · Headcount · Gross · Statutory ee · Net · Employer cost |
| Summary by cost centre | Run or month range | Cost centre · same totals |
| Variance vs last month | Run · Threshold | Employee · Element · Last · This · Diff (RM, %) |
| Employer cost | Month range · Department | Employee · Gross · EPF er · SOCSO er · EIS er · HRDF · Total cost |
| YTD by employee | Year · Department | Employee · YTD gross · normal / additional remuneration · EPF · SOCSO · EIS · PCB · CP38 · Zakat |
| Statutory summary | Month | EPF · SOCSO · EIS · PCB · CP38 · Zakat · HRDF · PTPTN totals (ee / er) |
| Joiners/leavers in payroll | Month | Employee · Join/LWD · Prorate factor · Final pay items |
| Payslip publication / view status | Run | Employee · Published at · Viewed at · Revised |

## Y18 · AutoCount payroll journal — S-PY-18 · dialog · F-PAY-38 · US-PAY-038
Run * (finalised) · preview totals: Σ debit · Σ credit (must match — blocking "Journal does not balance by RM x") · missing GL mappings listed (→ S-PY-03 / S-OR-01). Columns: Date · Document no. (run no.) · GL account · Description · Debit · Credit · Department / cost centre (layout per Q37). `EXPORT .XLSX` (logged).

## Y19 · TP1 / TP3 / CP38 — S-PY-19 · `/payroll/declarations` · F-PAY-16/17 · US-PAY-017, 018
Tabs **TP1** · **TP3** · **CP38**, each a list with `ADD` and `EXPORT .CSV`.
| Tab | List columns | Form fields |
|-----|-------------|-------------|
| TP1 | Employee › · Year · Month · Relief/rebate type · Amount · Submitted by (E/A) · Status (Submitted / Verified) · Verified by | Employee * · Year * · Month * · Relief/rebate type * · Amount * · Supporting document · `VERIFY` (ADM) |
| TP3 | Employee › · Previous employer · Period · Total remuneration · EPF · PCB · Zakat | Employee * · Previous employer name * & tax no. · Period from–to * · Total remuneration * · EPF * · PCB * · Zakat · Other per LHDN TP3 |
| CP38 | Employee › · LHDN reference · Amount / month · Start month · End month · Status (Active / Ended) | Employee * · LHDN reference * · Amount per month * · Start month * · End month * · Letter (file) * |
Warning list: "Joined mid-year without TP3: …" (first-run warning).

## Y20 · Parallel-run reconciliation & cut-over — S-PY-20 · `/payroll/parallel` · F-PAY-39, F-MIG-18 · US-PAY-039, US-MIG-016
```
┌ Parallel run   Month [Nov 2028 ▾]   PRET run PR-2028-11-01 (Parallel) · Kakitangan import IM-2028-014 ┐
│ Status: ✕ 1 variance · Months matched in a row: 1 of 2 (target 3)                                     │
│ Filters [Employee ▾] [Element ▾] [Variances only ☑]                         [EXPORT .CSV] [.XLSX]    │
│ Employee  Element   Kakitangan (RM)  PRET (RM)  Difference  Status     Explanation *        Resolved by │
│ Ben Lee   PCB       412.35           412.36     0.01        ✕Variance  [ rounding of …   ]  [RESOLVE]   │
│ Totals per element …                                                                                  │
│ Payment list: Kakitangan RM … · PRET RM … · ✓                                                          │
│ Statutory listings: EPF ✓ · SOCSO ✓ · EIS ✓ · PCB ✕                                                     │
├ Cut-over ────────────────────────────────────────────────────────────────────────────────────────────┤
│ Zero-variance months: Sep ✓ · Oct ✓ · Nov ✕                                                            │
│ [SIGN OFF CUT-OVER] (SA; enabled after ≥ 2 consecutive zero-variance months) — Remarks [         ]      │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
Rows: one per employee per element (each earning, deduction, EPF ee/er, SOCSO ee/er, SKBBK, EIS ee/er, PCB, CP38, zakat, HRDF, PTPTN, gross, net) and per payment-list line. Explanation mandatory for every variance; `RESOLVE` records by/at; a month counts as matched only with RM 0.00 difference on every row (EC-PAY-11). Sign-off (name, dd/mm/yyyy HH:mm, remarks) unlocks Live mode in S-PY-07 and retires S-RP-23.

---

## Open UX questions touching this file
**UXQ-14**: PRD BR-PAY-18 requires approver ≠ preparer. If Albert is the only Super Admin and also prepares a run (e.g. while the Admin is away), the run cannot be approved. Default: the Admin prepares; if an SA prepared it, approval waits for another SA — please confirm whether a second SA will exist (relates to Q39).

## Ready for GATE 2 (design)?
Every R1.1 payroll screen specified at field level, with SA-only controls, parallel-run watermarking and the cut-over sign-off. **Yes.**
