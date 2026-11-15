# PRET — Wireframes: Leave administration (Admin / Super Admin; Manager team views)

**Work item:** W1-004 · **Author:** UX Designer · **Status:** Draft for GATE 2 (Design) · **Last updated:** 15/11/2026
**Shared primitives:** [`wireframes.md`](wireframes.md) §0. **Screens:** S-LV-01 – S-LV-14. Field ids are PRD §6 (`LA` application, `LT` leave type, `EB` band, `LP` policy, `RC` replacement credit).

---

## L1 · Leave applications — S-LV-01 · `/leave/applications` (MGR: `/team/leave`) · F-LV-22, F-LV-09, F-LV-26 · US-LEAVE-029, 015, 034

As Kakitangan "View Applications", plus PRET filters.
| Element | Specification |
|---------|---------------|
| Search | Reference, employee no., employee name |
| Filters | Employee · Work location (multi) · Department (multi) · Leave date from–to · Type (multi) · Status (multi; default all except Withdrawn) · Emergency only · On behalf only · *More:* Applied from–to · Level (L1 / L2) · MC check (Not checked / Verified / Invalid / Attachment pending) · Include separated employees (default per LP14) |
| Columns | [ ] · Reference › · Employee · From · To · Days · Reason · 📎 · Type · Applied (dd/mm/yyyy HH:mm) · Status ● (+ "L1/L2") · Approver & date (current or deciding) · Flags ● (EMERGENCY, On behalf, MC pending/invalid) · 👁 |
| Bulk | `APPROVE SELECTED` / `DECLINE SELECTED` — only rows where the user is the current approver; others reported as skipped (S-AP-05) |
| Buttons | `EXPORT .CSV` · `EXPORT .XLSX` (F-RPT-25) · `APPLY ON BEHALF` (ADM, SA) · `CLEAR` · `SEARCH` |
| Scope | MGR: reportees only, read-only except decisions on items routed to them; Type column shows "Medical" for sick/maternity in calendars only — in this list the approver sees the real type |
| Row → | S-AP-02 decision view |
| Sort | Applied desc |
| Empty | "No leave applications match these filters." |

## L2 · Apply / withdraw / cancel on behalf — S-LV-02 · `/leave/apply-on-behalf` · F-LV-11 · US-LEAVE-017
Same form as S-PT-02 with, at the top: **Employee *** (picker, active + Notice Period; Separated only with "Separated — HR only" tag) and **Reason for acting on behalf *** (≥ 10 chars). Differences: back-date window not enforced (warning "Beyond the {n}-day back-date window — recorded as on behalf"); hidden types (LT31 = No) available; not available for own record. Confirmation: "Applied on behalf of INT-004. {Employee} and {manager} have been emailed." Withdraw/cancel on behalf: from S-AP-02 with Reason *. Application shows "On behalf by {name}" everywhere (FR-G-17).

## L3 · Leave balances — S-LV-03 · `/leave/balances` (MGR: `/team/balances`) · F-LV-21 · US-LEAVE-028
| Element | Specification |
|---------|---------------|
| Search | Employee no., name |
| Filters | As at date * (default today) · Department (multi) · Work location (multi) · Leave type (multi; default AL, SL, RL) · Employment status (default Active; incl. Separated per LP14) |
| Layout | Grouped by department (collapsible group header with headcount) |
| Columns | Employee › · Months of service · per selected type: Entitled · Taken · Pending · Available (1 dp) |
| Row → | S-PT-06 ledger (employee, type) |
| Buttons | `EXPORT .CSV` · `EXPORT .XLSX` · `CLEAR` · `SEARCH` |

## L4 · Balance adjustments — S-LV-04 · `/leave/adjustments` · F-LV-18 · US-LEAVE-025, 043
List: Search employee · Filters Employee, Type, Leave year, Date from–to, Reason contains · Columns Date · Employee › · Type · Year · Days (+/−) · Reason · Attachment 📎 · By · `ADJUST BALANCE` (→ S-LV-05) · `EXPORT .CSV`. Migration correction rows carry reason "Statutory correction (D13)".

## L5 · Adjust balance — S-LV-05 · dialog · F-LV-18 · US-LEAVE-025
Fields: Employee * (not self — own record excluded from picker) · Leave type * · Leave year * (current / next) · Days * (± in 0.5 steps, ≠ 0; stepper `[−] 1.5 [+]` with `(•) Add (•) Deduct`) · Reason * (≥ 10 chars, 0/500) · Attachment. Preview: "Balance before 8.5 → after 10.0". `[ADJUST BALANCE]` → ledger entry, N-10.

## L6 · Entitlement overrides — S-LV-06 · `/leave/overrides` · F-LV-31 · US-LEAVE-036
List: Filters Employee, Type, Year · Columns Employee › · Type · Year · Days (override) · Band value it replaces · Reason · Entered by/at · ⋮ Edit / Remove · `ADD OVERRIDE` · `EXPORT .CSV`. Form: Employee * · Leave type * (banded types) · Year * · Days per year * (Decimal 1 dp; below statutory minimum → BR-LV-02 block, SA override with reason) · Reason * · `SAVE OVERRIDE` (recomputes entitlement; shows before/after).

## L7 · Replacement credits — S-LV-07 · `/leave/credits` · F-LV-15 · US-LEAVE-022
List: Search credit no., employee · Filters Status, Date worked from–to, Department, Expiring within N days · Columns Credit no. › · Employee · Date worked · Day type · Duration · Days · Status ● · Expiry · Used · Remaining · Compensate by pay (✓) · Decided by/at · `BATCH APPLY` · `EXPORT .CSV`. **Batch apply** form: Employees * (multi-picker) · Date worked * (system shows day type per employee's calendar; rows where it is a working day are flagged and excluded) · Duration * · Reason * · `CREATE {n} REQUESTS` (each routed per the Replacement Leave workflow).

## L8 · Leave types — S-LV-08 · `/leave/setup/types` · F-LV-01 · US-LEAVE-001
List: Search code/name · Filters Category, Active · Columns Code › · Name · Category · Paid · Count basis · Entitlement summary ("12 / 12 / 16 by service", "98 consecutive", "Earned credits", "Cap 12/yr") · Workflow · Visible to employees · Active ● · `ADD NEW LEAVE TYPE` · `EXPORT .CSV`. Row ⋮ Edit / Deactivate (blocked for the statutory five while anyone is eligible — BR-LV-01).

## L9 · Leave type form — S-LV-09 · `/leave/setup/types/{code}` · F-LV-01, BR-LV-02 · US-LEAVE-001, 002
Section cards:
| Card | Fields |
|------|--------|
| Identity | LT1 Code * · LT2 Name * · LT3 Statutory category * (🔒 once used) · LT4 Description / policy text · LT34 Display order · Active |
| Pay & counting | LT5 Paid * · LT33 Payroll treatment * · LT6 Count basis * · LT14 Half-day allowed * |
| Entitlement | LT7 Entitlement method * → if Annual banded: LT8 Accrual override · LT9 Pro-rate joiners/leavers · link `EDIT ENTITLEMENT BANDS` (S-LV-10) · if Fixed per occurrence: LT23 Days per occurrence * · LT22 Max occurrences (+ per year / per employment) · if No entitlement: annual cap (LT21/LT22) · LT24 Deduct from type · LT25 Aggregate pool type + pool cap |
| Eligibility | LT10 Gender * · LT11 Marital status * · LT12 Minimum service (months) * · LT13 Available during probation * · LT31 Visible to employees * |
| Application rules | LT15 Reason required * · LT16 Attachment rule * → LT17 threshold (if "more than N days") · LT18 Allow attachment after submit (hours) · LT19 Minimum notice (days) + Warn/Block · LT20 Back-date allowed (working days) * · LT21 Max days per application |
| Balance | LT26 Carry-forward allowed * · LT27 Cap / expiry override · LT28 Allow negative + max negative days * |
| Approval & cancel | LT29 Approval workflow * · LT30 Employee can self-cancel approved future leave * |
| Calendar | LT32 Colour * (fixed accessible palette swatches) |
Save: if any value is below the Employment Act minimum for a statutory category → blocking dialog "Below Employment Act minimum (s60E/s60F/s37/s60FA)". ADM: `[BACK]` only. SA: Override reason * → `SAVE WITH OVERRIDE` (logged).

## L10 · Entitlement bands — S-LV-10 · `/leave/setup/bands?type=AL` · F-LV-02 · US-LEAVE-003
Header: Leave type ▾ (banded types) · Effective leave year ▾ (versions; `NEW VERSION FOR {year}` copies current). Table (editable rows): EB3 Service from (years, ≥) · EB4 Service to (<; blank = no upper) · EB5 Days per year · Statutory minimum (🔒 reference column, e.g. 8 / 12 / 16) · EB6 Grade override (blank = all grades) · ⋮ delete row. `ADD BAND` · `ADD GRADE ROW`. Validation: contiguous from 0, no gap/overlap ("Bands must run from 0 years with no gaps"); below-minimum → BR-LV-02 dialog. `SAVE BANDS` → "Entitlements for {n} employees will be recomputed" confirm.

## L11 · Leave policy settings — S-LV-11 · `/leave/setup/policy` · F-LV-03, F-LV-33, F-LV-34 · US-LEAVE-004, 038, 039
Form cards with current values and the "Kakitangan setting" note where the default mirrors it:
| Card | Settings (PRD §6.6) |
|------|---------------------|
| Leave year & entitlement | LP1 Leave year start 🔒 01/01 (calendar year only) · LP2 Entitlement method (3 options) · LP3 Pro-rata basis (By day / By completed month) · LP4 Rounding (4 options) · LP5 Employment-Act floor for joiners/leavers |
| Carry-forward | LP6 Cap (days) · LP7 Expiry (months after year end) → shows "Expires 31/03" |
| Next year | LP8 Allow applying against next year's balance + from date (dd/mm) |
| Application form | LP9 Form message (0/500, preview) · LP10 Emergency threshold (days) · LP11 Emergency applies to types (multi) |
| Visibility & notices | LP12 Team calendar visibility (3 options) · LP13 Notify employee & manager when an admin withdraws/cancels · LP14 Include separated employees in leave reports |
| Reminders | LP15 Reminder after / escalate after (working days) |
| Replacement leave | LP16 Credit validity (days) · LP17 Carry forward at year end · LP18 Replacement holiday for PH on off day |
`SAVE POLICY` → "Changes apply to new calculations; existing approved leave is not recounted unless stated." LP2–LP5 changes ask "Recompute entitlements now?" `[LATER] [RECOMPUTE]`.

## L12 · Approval workflows — S-LV-12 · `/leave/setup/workflows` · F-LV-32 · US-LEAVE-037
List: Columns Name › · Levels (e.g. "Direct manager → Any Admin") · Used by types (count/names) · Active ● · `ADD WORKFLOW` · `EXPORT .CSV`. Form: Name * · Levels (1–3): per level Approver source * (Direct manager / Leave approver override (F15) / Manager's manager / Specific employee → picker / Any Admin / Super Admin) · `ADD LEVEL` / remove · Skip level if approver = applicant * (default Yes) · Auto-merge consecutive identical approvers * (default Yes) · Active *. Preview: "Example: Ben (reports to Aina) → L1 Aina → L2 any Admin." Seeded: "Direct Manager → Admin" (default), "Direct Manager only". Cannot deactivate while assigned to an active type.

## L13 · Year-end roll-over — S-LV-13 · `/leave/year-end` · F-LV-19, F-LV-04 · US-LEAVE-026, 005
```
┌ Year-end roll-over: 2027 → 2028        Window 01/12/2027 – 31/01/2028 ┐
│ Step 1 [PREVIEW]   Step 2 Review   Step 3 [RUN ROLL-OVER]              │
├ Preview (as at 31/12/2027) ───────────────────────────────────────────┤
│ Filters [Department ▾] [Only forfeiting ☐] [Search employee]          │
│ Employee  Type  Closing bal.  Carry-forward  Forfeited  CF expiry  New-year entitlement │
│ Ben Lee   AL    13.5          10.0           3.5        31/03/2028  12.0 │
│ Totals …                                                  [EXPORT .CSV] │
└────────────────────────────────────────────────────────────────────────┘
```
Checks before run: next-year PH calendar published (else blocking "Publish the 2028 holiday calendar first"); pending applications in 2027 count shown ("3 pending — they stay pending", BR-LV-72). Run confirm: "Carry forward {n} days, forfeit {m} days for {k} employees and generate 2028 entitlements?" `[RUN ROLL-OVER]`. Re-run shows "Already run on dd/mm/yyyy by {name} — running again changes nothing" (idempotent). History table: Year · Run at · By · Employees · Carried · Forfeited · `REPORT` (→ S-RP-17). Also `REGENERATE ENTITLEMENTS` (F-LV-04 manual re-run) with year selector.

## L14 · Delegations & reassignment — S-LV-14 · `/leave/delegations` · F-LV-24 · US-LEAVE-031, 032
List: Filters Approver, Delegate, Active on date, Scope · Columns Approver › · Delegate · From · To · Scope (Leave / Claims / Both) · Set by (self / Admin) · Status (Scheduled / Active / Ended) · ⋮ Edit / End now · `ADD DELEGATION` (on behalf of an approver — same fields as S-GL-08 plus Approver *) · `EXPORT .CSV`.
**Reassign pending items** card (UXQ-05): From approver * · To approver * (active employee or ADM; not the applicant of any item — those are listed and skipped) · Item types (Leave / Cancellations / Credits / Claims) · Reason * · preview count · `REASSIGN {n} ITEMS`. Panel "Approvers on leave today without a delegate" (auto re-route per BR-LV-61, informational).

---

## Open UX questions touching this file
UXQ-05 (reassign approver), UXQ-10 (Admin override button). Full list in `screen-inventory.md`.

## Ready for GATE 2 (design)?
All leave-admin screens specified at field level including statutory-floor handling and year-end. **Yes.**
