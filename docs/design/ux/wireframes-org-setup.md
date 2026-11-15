# PRET — Wireframes: Organisation & settings (Admin / Super Admin)

**Work item:** W1-004 · **Author:** UX Designer · **Status:** Draft for GATE 2 (Design) · **Last updated:** 15/11/2026
**Shared primitives:** [`wireframes.md`](wireframes.md) §0. **Screens:** S-OR-01 – S-OR-11. Field ids are PRD §9 (`CO` company, `WL` location, `WP` pattern, `PH` holiday).
Every master list below is the canonical list pattern (search, filters, sortable columns, pagination 25, `EXPORT .CSV`, `ADD NEW …`, `CLEAR`, `SEARCH`); every form shows created/updated by/at.

---

## O1 · Company profile — S-OR-01 · `/organisation/company` · F-ORG-01 · US-ORG-001
Section cards; **S** = SA-only edit, ✎ = ADM and SA edit, 👁 = ADM view.
| Card | Fields |
|------|--------|
| Company | CO1 Legal name * **S** · CO2 SSM no. (new, 12 digits) * **S** · CO3 SSM no. (old) **S** · CO6 Logo * **S** (preview; used on login, shell, payslips, EA) |
| Addresses | CO4 Registered address * **S** · Business address * **S** (address blocks as B5–B10) |
| Contact | CO5 Phone · Email · Website ✎ |
| Statutory employer numbers | CO7 EPF employer no. **S** · CO8 SOCSO/EIS employer code **S** · CO9 LHDN E-number **S** · CO10 Company income tax no. **S** · CO11 HRDF registered / levy rate / MyCoID **S** · CO12 Zakat employer registrations (rows: zakat body, employer ref; `ADD ROW`) **S** — "(R1.1)" hint on payroll-only numbers |
| Paying bank account | CO13 Bank 🔒 Hong Leong Bank · Account no. **S** (masked ••••4321, reveal logged) · Account name **S** — "Used on HLB payment-list headers only" |
| Signatories | CO14 rows: Name · Designation · Signature image — **S** |
| AutoCount GL mapping | CO15 rows: Purpose (Claims payable · Salary payable · EPF payable · SOCSO payable · EIS payable · PCB payable · Zakat payable · PTPTN payable · HRDF payable · …) · GL account code ✎ — R1.0 needs Claims payable; R1.1 rows labelled "(payroll)" · GL account list (code · name) used to validate CC18/PI11: `IMPORT GL LIST (.xlsx)` ✎ |
ADM sees statutory and bank cards read-only with "Only a Super Admin can change this." `SAVE` per card.

## O2 · Departments — S-OR-02 · `/organisation/departments` · F-ORG-02 · US-ORG-002
List: Search code/name · Filters Active, Parent · Columns Code › · Name · Parent · Head · Active headcount · Active ● · ⋮ Edit / Deactivate. Form: Code * (unique, 10) · Name * (80) · Parent department (no cycles) · Head of department (active employee) · Cost centre (Could) · Active *. Deactivate blocked with active employees: "Move {n} employees first."

## O3 · Positions — S-OR-03 · `/organisation/positions` · F-ORG-03
List: Search code/title · Filters Department, Grade, Active · Columns Code › · Title · Default department · Default grade · Headcount · Active ●. Form: Code * · Title * (100; "Used as designation on the EA form") · Default department · Default grade · Description (1000) · Active *.

## O4 · Grades — S-OR-04 · `/organisation/grades` · F-ORG-04
List: Search · Filter Active · Columns Code › · Name · Rank · Headcount · Active ●. Form: Code * · Name * · Rank * (number, unique) · Active *. Note "Kakitangan Position Level imports here (Q25)."

## O5 · Work locations — S-OR-05 · `/organisation/locations` · F-ORG-05 · US-ORG-003
List: Search name · Filters State, Active · Columns Name › · State · Default working pattern · Active employees · Active ●. Form: WL1 Name * · WL2 Address * · WL3 State * (13 states + 3 FTs; "Determines the public-holiday calendar") · WL4 Default working-week pattern * · WL5 Active *. Changing WL3 warns "Leave of {n} employees will be recounted from {date}."

## O6 · Working-week patterns — S-OR-06 · `/organisation/working-patterns` · F-ORG-06 · US-ORG-004
List: Columns Name › · Mon … Sun (F / ½ / Off / Rest) · Hours/day · Days-per-month basis · Effective from · Used by (locations/employees) · Active ●. Form: WP1 Name * · WP2 grid Monday–Sunday, each (•) Full working day (•) Half working day (•) Off day (•) Rest day — error "At least one rest day per week is required (EA s59)" · WP3 Hours per full day * (default 8) · WP4 Working days per month basis * (Actual working days / Fixed 26 / Calendar days; "Used by payroll R1.1") · WP5 Effective from * (new version; "Future leave will be recounted; past leave is not", EC-ORG-03) · WP6 Active *. Seed "Standard Mon–Fri" (Sat Off, Sun Rest).

## O7 · Public holidays — S-OR-07 · `/organisation/holidays` · F-ORG-07–10 · US-ORG-005–008, US-LEAVE-041
```
┌ Public holidays  Year [2028 ▾]  ●Draft  (2027 ●Published)                         ┐
│ Checks: Selangor ✓ 5 compulsory · 14 paid   WP Kuala Lumpur ⚠ missing FT Day       │
│ Filters [Search name] [State ▾] [Type ▾] [Observed ▾]     View (•)List ( )Calendar │
│ [EXPORT .CSV] [IMPORT] [COPY TO NEXT YEAR] [ADD NEW HOLIDAY] [PUBLISH YEAR] [(CLEAR)] [SEARCH] │
│ Date›       Day  Name                   Type        States     Compulsory  Observed Half ⋮ │
│ 01/01/2028  Sat  New Year's Day         National    Selangor,… —           ✓        —      │
│ 03/01/2028  Mon  New Year's Day (replacement) Replacement (auto) Selangor —   ✓     —      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
| Element | Specification |
|---------|---------------|
| Filters | Year * · State (multi) · Type (National gazetted / State gazetted / Replacement (auto) / Company holiday / Special declared) · Observed (Yes/No) · search name |
| Columns | Date › · Day · Name · Type · States · EA compulsory · Observed · Half day · ⋮ Edit / Delete (Draft) / Deactivate (Published) |
| Compliance check card | Per state with active employees: compulsory holidays present (5) — block publish if missing (BR-ORG-20); total paid holidays ≥ 11 — warning |
| Add / edit form | PH1 Year (from selector) · PH2 Date * · PH3 Name * · PH4 Type * · PH5 Applicable states * (multi or "All states") · PH6 EA compulsory holiday · PH7 Observed by Interact * (default Yes) · PH8 Half day · PH10 Remarks. Replacement rows are system-generated (PH9 source shown, 🔒) |
| `COPY TO NEXT YEAR` | Copies fixed-date holidays as Draft into year+1; list of variable-date holidays to enter from the gazette (BR-ORG-24) |
| `PUBLISH YEAR` | Runs checks; confirm "Publish 2028? Leave counting will use it and employees will see it." |
| Change after publish | Adding/editing/removing a holiday on a published year: "{n} approved/pending applications on this date will be recounted and employees notified" `[CONFIRM]` (BR-ORG-23, EC-LV-02) |
| `IMPORT` | → S-IM-02 template T10 |
| Calendar view | Month grid per selected state, holidays as labelled dots; click → edit |

## O8 · Reporting lines — S-OR-08 · `/organisation/reporting-lines` · F-ORG-11 · US-ORG-009
Left: tree (Top of organisation → reportees), search, expand/collapse. Right: selected manager card — Name · Position · Reportees (direct n · indirect m) · Delegation (if any) · `REASSIGN REPORTEES`. Alert list "Reportees without an active manager" (N-49) with `ASSIGN`. Reassign dialog: Reportees * (multi, default all direct) · New manager * (loop check) · Effective date * · Remarks → creates job-history rows "Manager change" (re-routes pending approvals, BR-LV-61). `EXPORT .CSV` (Employee · Manager · Since).

## O9 · Cost centres — S-OR-09 · `/organisation/cost-centres` · F-ORG-13 (Could)
List: Search · Filter Active · Columns Code › · Name · AutoCount project/department code · Active ●. Form: Code * · Name * · AutoCount code · Active *.

## O10 · Employee groups — S-OR-10 · `/organisation/groups` · F-ORG-14 (Could)
List: Search · Filter Active · Columns Name › · Description · Members (count) · Used by (limits / overrides) · Active ●. Form: Name * · Description · Members (multi employee picker with chips; `ADD BY FILTER` department/location) · Active *.

## O11 · System settings — S-OR-11 · `/settings` · F-ORG-12 · US-ORG-010
Left section menu; each section a form card with `SAVE`. **S** = SA-only (ADM sees read-only with 🔒 "Super Admin setting").
| Section | Settings (PRD §9.5) |
|---------|---------------------|
| Employee numbers | Prefix (`INT-`) **S** · Padding (3) **S** · Next number **S** |
| Probation & notice | Default probation months (3) **S** · Max total probation (12) **S** · Default notice periods by service (4 / 6 / 8 weeks) **S** · Invite timing for new hires (join date − 3 days) **S** |
| Sign-in & security | Allowed login email domains (chips; interact.com.my) **S** · Session idle timeout (30 min; 15 min ADM/SA) **S** · Lockout (5 attempts / 30 min) **S** · MFA required for privileged roles (Yes) **S** |
| Approvals | Reminder after / escalate after (2 / 5 working days) **S** · Cancellation approval at level 1 only (setting from §6.10) **S** |
| Leave | Link → S-LV-11 (ADM, SA edit) |
| Claims | Link → S-CL-08 (ADM, SA edit; SA batch approval **S**) |
| Payroll (R1.1) | Link → S-PY-01 (ADM, SA edit) |
| Rehire | Keep same employee no. on rehire (default Yes) **S** |
| Retention | Retention periods per data class (§10.6 defaults; 7 years etc.) **S** |
| Notifications | Reply-to HR mailbox **S** · Staff directory: show birthdays (Could, default off) **S** |
Every change audited (Config change); confirmation toast names the setting changed.

---

## Ready for GATE 2 (design)?
Organisation masters, holiday calendars (with EA compliance checks) and settings specified at field level with SA-only controls marked. **Yes.**
