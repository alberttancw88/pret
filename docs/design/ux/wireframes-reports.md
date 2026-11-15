# PRET — Wireframes: Admin dashboard & reports

**Work item:** W1-004 · **Author:** UX Designer · **Status:** Draft for GATE 2 (Design) · **Last updated:** 15/11/2026
**Shared primitives:** [`wireframes.md`](wireframes.md) §0. **Screens:** S-RP-01 – S-RP-24 (payroll reports are in `wireframes-payroll.md` §Y17). The manager dashboard (F-RPT-22) is the manager panel on Home (`wireframes-portal.md` §P1).

---

## R1 · Admin dashboard — S-RP-01 · `/dashboard` · F-RPT-01 · US-REPORT-001

```
┌ Dashboard                                               as at 15/11/2027 09:30 ┐
│ HR ──────────────────────────────────────────────────────────────────────────── │
│ [Active headcount 57›] [On leave today 3›] [Pending leave approvals 4›]          │
│ [Probation ending ≤30d 2›] [Missing payroll data 5›] [Change requests 1›]        │
│ [PH calendar 2028: ●Draft — publish by 31/12›]                                   │
│ Alerts: ⚠ 2 reportees without an active manager ›  ⚠ External access ends in 7 days (SA) › │
│ Claims ───────────────────────────────────────────────────────────────────────── │
│ Submitted 6 · Approved (not disbursed) 11 · Disbursed 42 · Rejected 2 · Excl. SST RM … · SST RM … · Total RM … │
│ [Awaiting approval 6 · RM 1,204.10 ›] [Approved not disbursed 11 · RM 2,140.60 ›] │
│ [Current month-end batch: PB-2027-011 ●Exported — mark disbursed ›]              │
│ Payroll (R1.1) ──────────────────────────────────────────────────────────────── │
│ [Current run PR-2028-11-01 ●In Review · 3 exceptions ›] [Statutory due 15/12 (EPF, SOCSO/EIS, PCB) ›] │
│ [Gross / net — last 6 months (bar)]                                               │
└──────────────────────────────────────────────────────────────────────────────────┘
```
| Tile | Value | Click → |
|------|-------|---------|
| Active headcount | On Probation + Confirmed + Notice Period | S-EM-01 (Active) |
| On leave today | Approved leave covering today | S-RP-13 (today) |
| Pending leave approvals | Items at the Admin level + all pending (secondary number) | S-AP-01 Leave |
| Probation ending ≤ 30 days | Count | S-RP-07 |
| Missing payroll data | Employees with missing Y / R1.1 fields | S-RP-09 |
| Change requests | Submitted CRs | S-EM-12 |
| PH calendar status | Next-year calendar Draft/Published; alert from 01/11 (N-58) | S-OR-07 |
| Alerts | Reportees without active manager (N-49) · External access expiring (SA) · Statutory table not verified (R1.1) | relevant screen |
| Claims KPI strip | Same as S-CL-01 (current month by default; period selector This month / Last month / Year) | S-CL-01 with filter |
| Awaiting approval | Submitted count + total | S-AP-01 Claims |
| Approved not disbursed | count + total | S-RP-20 |
| Current month-end batch | Latest open batch no. + status + next step | S-CL-11 |
| Payroll panel (R1.1) | Current run status + exceptions · statutory due dates (N-35) · last 6 months gross/net trend | S-PY-08 / S-PY-16 / S-PY-17 |
Loading: tiles skeleton individually; a failed tile shows "Couldn't load — [RETRY]" without blocking others.

## R2 · Reports catalogue — S-RP-02 · `/reports` · US-REPORT-*
Card grid grouped: **People** (S-RP-04 – 09) · **Leave** (S-RP-10 – 17, 24) · **Claims** (S-RP-18 – 22) · **Payroll handover** (S-RP-23, retired at R1.1 cut-over) · **Payroll** (R1.1 → S-PY-17). Each card: name · one-line description · sensitive 🔒 badge where logged. Search box filters cards by name. MGR sees only: Probation due · Leave balances · Who's on leave · Leave report by individual (team scope).

## R3 · Report viewer template — S-RP-03 · `/reports/{report}` · F-RPT-24, F-RPT-25
```
┌ {Report name}                                   🔒 Sensitive — access is logged   ┐
│ Filter card: report-specific filters                                               │
│ [EXPORT .CSV] [EXPORT .XLSX] [PRINT / PDF] [(CLEAR)] [SEARCH]                      │
│ Summary strip (totals) when defined                                                │
│ Table (sortable, paginated 25; grouped where stated)                               │
│ Footer: "Generated dd/mm/yyyy HH:mm by {name} · as at {date}"                      │
└───────────────────────────────────────────────────────────────────────────────────┘
```
Rules: no data until `SEARCH` for heavy reports (stated below); MGR scope forced to team (filter shows "My team" 🔒); exports contain only columns the user may view; sensitive reports (S-RP-04 with sensitive groups, S-RP-15, S-RP-23) log view and export (BR-ADM-21). Empty: "No results for these filters."

## R4 · Report specifications (each uses S-RP-03)

| ID | Report | Search | Filters | Columns | Summary / grouping | Roles |
|----|--------|--------|---------|---------|--------------------|-------|
| S-RP-04 | Employee master (F-RPT-02) | No., name | Status · Department · Location · Join date from–to · **Column chooser** (groups A–I fields the user may view; sensitive groups — MyKad, religion, OKU, family, bank, statutory — ticked separately with 🔒 "logged") · As-at date | Chosen fields (default: A1, A2, A3, F10, F11, F12, F13, F17, F1, F9, B1, B3) | — · loads on SEARCH | ADM, SA |
| S-RP-05 | Headcount (F-RPT-03) | — | As-at date * · Group by * (Department / Location / Grade / Status / Gender) · Month range (trend) | Group · Headcount · Joiners · Leavers · % of total | Total row; trend table month × group | ADM, SA |
| S-RP-06 | Joiners & leavers (F-RPT-04) | No., name | Date from–to * · Department · Separation type · (•) Joiners (•) Leavers (•) Both | Employee no. · Name · Department · Position · Join date / LWD · Separation type · Reason category · Length of service | Turnover % = leavers ÷ average headcount | ADM, SA |
| S-RP-07 | Probation due (F-RPT-05) | No., name | Ending within (7/14/30/60 days) · Overdue only · Department | Employee › · Manager · Join date · Probation end · Extended (✓, new end) · Days left (negative = overdue) · Manager recommendation | — | ADM, SA; MGR team |
| S-RP-08 | Retirement & service milestones (F-RPT-06) | No., name | Window (months) * · Milestone type (Retirement / Service band) | Employee · DOB (ADM/SA) · Age · Retirement date · Next service-band date · New AL days · New SL days | — | ADM, SA |
| S-RP-09 | Data completeness (F-RPT-07) | No., name | Department · Status · Missing category (Mandatory / Statutory / PCB inputs / Bank) | Employee › · Missing mandatory (list) · Missing R1.1 fields (EPF no., SOCSO no., tax no., bank, PCB inputs…) · Completeness % | Count complete / incomplete | ADM, SA |
| S-RP-10 | Leave balances as at (F-RPT-08) | No., name | As-at date * · Department · Location · Type (multi) · Status (incl. separated) | Grouped by department: Employee · Months of service · per type Entitled / CF / Earned / Adjusted / Taken / Pending / Expired / Available | Department subtotals | ADM, SA; MGR team |
| S-RP-11 | Leave transactions (F-RPT-09) | Ref, name | Date basis (Leave dates / Applied dates) + from–to * · Type · Status · Department · Emergency · On behalf | Reference › · Employee · Type · From · To · Days · Status · Applied · Approver(s) · Decided | Count, days total | ADM, SA |
| S-RP-12 | Leave summary (F-RPT-10) | — | Year * · Month range | Matrix Department × Type of days taken; toggle per month | Row/column totals | ADM, SA |
| S-RP-13 | Who's on leave (F-RPT-11) | Name | Date or range * (default today) · Department · Location | Employee · Department · Type (ADM/SA/MGR) · From · To · Session | Count | ADM, SA; MGR team |
| S-RP-14 | Unpaid leave (F-RPT-12) | Name | Month * · Department | Employee · Dates · Unpaid days · Reference › | Total days | ADM, SA |
| S-RP-15 | Sick & hospitalisation (F-RPT-13) 🔒 | Name | Year * · Department | Employee · SL entitled · SL taken · HL taken · Pool used / 60 · MC verified count | — | ADM, SA |
| S-RP-16 | Replacement leave (F-RPT-14) | Name, credit no. | Date range · Status · Expiring within N days | Employee · Credit no. › · Date worked · Days · Status · Used · Expiry · Expired | Totals earned / used / expired | ADM, SA |
| S-RP-17 | Year-end carry-forward & forfeiture (F-RPT-15) | Name | Year * | Employee · Closing balance · Carried · Forfeited · CF expiry · CF used · CF expired | Totals | ADM, SA |
| S-RP-18 | Claims detail (F-RPT-16) | Claim no., name | Date ranges (transaction / application / approval / disbursement) · Category · Status · Department · Batch | Line-level columns as S-CL-01 line view | Totals excl. SST / SST / total | ADM, SA |
| S-RP-19 | Claims summary & limit utilisation (F-RPT-17) | — | Date range * · Department · Category | Tab A: Category × Department × Month totals (excl. SST, SST, total) · Tab B: Employee · Category · Used · Limit · % used | Totals | ADM, SA |
| S-RP-20 | Approved-not-disbursed (F-RPT-18) | Claim no., name | As-at date * · Age over (days) | Claim › · Employee · Approved date · Approved by · Amount (RM) · Age (days) · Batch / payroll run (if included) | Count, total, ageing buckets 0–30 / 31–60 / > 60 | ADM, SA |
| S-RP-21 | Disbursement batches (F-RPT-19) | Batch no. | Date range · Month · Status | Batch › · Disbursement month · Approval cut-off · Payment date · Count · Total (RM) · Status · Payment reference · Prepared / approved by | Total paid | ADM, SA |
| S-RP-22 | Claims by tax treatment (F-RPT-20) | Name | Year * · Employee | Employee · Tax treatment · EA line · Total of Disbursed claims (RM) | Per-treatment totals | ADM, SA |
| S-RP-24 | Leave report by individual (F-RPT-27) | — | Employee * · Year * | See `wireframes-portal.md` §P7 | Printable | ADM, SA; MGR team; EMP own |

## R5 · Monthly payroll-input pack (Kakitangan) — S-RP-23 · `/reports/payroll-input` · F-RPT-21 · US-REPORT-021 · 🔒 sensitive
Filters: Payroll month * · `PREVIEW`. Tabs (one per sheet): **Joiners** (employee no. matching Kakitangan, name, join date, statutory and bank fields) · **Leavers** (LWD, final leave balance — encashable/recoverable days, notice shortfall) · **Job changes** (effective date, change type, from → to) · **Bank changes** (effective date, bank, account full — logged) · **Statutory-profile changes** · **Unpaid leave days** (employee, dates, days) · **Rest-day work paid** (BR-LV-84: employee, date, hours). Reversal lines for cancellations after a previous export (EC-LV-14) marked "Reversal". **No claims sheet** (D16) — note on screen. Buttons `EXPORT .XLSX` (all sheets) · `EXPORT .CSV` (current sheet) · "Last exported dd/mm/yyyy by {name}". After R1.1 cut-over: page shows "Retired at payroll cut-over on dd/mm/yyyy" (read-only history).

---

## Ready for GATE 2 (design)?
Dashboard tiles, report catalogue, shared viewer and every R1.0 report specified with filters, columns and roles. **Yes.**
