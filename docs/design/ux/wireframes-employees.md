# PRET — Wireframes: Employee records (Admin / Super Admin)

**Work item:** W1-004 · **Author:** UX Designer · **Status:** Draft for GATE 2 (Design) · **Last updated:** 15/11/2026
**Shared primitives:** [`wireframes.md`](wireframes.md) §0. **Screens:** S-EM-01 – S-EM-17. **Roles:** ADM, SA (MGR limited view is S-AP-07; employee own view is S-PT-16).
Field ids `{A2}` etc. are PRD §5.3 field tables — type, length and validation rules are as specified there; this file fixes **layout, order, controls, who can edit, and actions**.

**Edit markers:** ✎ = ADM and SA edit · **S** = SA only · 🔒 = system / read-only · **R** = reveal (masked by default; reveal logged, ADM gives a reason) · **(not own)** = an Admin or SA editing their *own* record cannot change this field and is told "Use a change request for your own record" (FR-EMP-12, EC-EMP-10).

---

## E1 · Employee list — S-EM-01 · `/employees` · F-EMP-01, F-EMP-24 · US-EMP-003, 021

```
┌ Filters ───────────────────────────────────────────────────────────────────────────────┐
│ [Search no./name/email/MyKad last 4 ×] [Department ▾] [Position ▾] [Grade ▾] [Location/state ▾] │
│ [Status ▾ Active ×] [Manager ▾] [Join from 📅] [Join to 📅] [More filters ▸]            │
│        [EXPORT .CSV] [IMPORT] [ADD NEW EMPLOYEE] [(CLEAR)] [SEARCH]                      │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ [ ] Emp no.› Full name  Pref. Dept  Position Grade Manager Location(state) Join date Svc  Status  Email Mobile  Compl. 👁│
│ [ ] INT-004› Ben Lee     Ben  Dev   Sw Eng   G3    Aina    HQ (Selangor)   01/03/2023 4y8m ●Confirmed … …  92% │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ 2 selected: [CHANGE MANAGER] [SEND INVITES]                 Rows [25▾] 1–25 of 57 ‹ ›  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```
| Element | Specification (PRD §5.7) |
|---------|---------------------------|
| Search | Employee no., full name, preferred name, work email, MyKad **last 4 digits** |
| Filters | Department (multi) · Position (multi) · Grade (multi) · Work location / state (multi) · Employment status (multi; default **Active** = On Probation + Confirmed + Notice Period) · Reporting manager · Join date from–to · *More:* LWD from–to · Probation ending within (7 / 14 / 30 / 60 days) · Data completeness (Complete / Incomplete / Missing payroll fields) · Portal account (Not invited / Pending activation / Active / Disabled) |
| Columns | Employee no. › · Full name · Preferred name · Department · Position · Grade · Reporting manager · Work location (state) · Join date · Years of service · Status ● · Work email · Mobile · Completeness % (colour band; tooltip lists missing fields) · 👁 |
| Status chips | Pending Join · On Probation · Confirmed · Notice Period · Separated · Withdrawn |
| Buttons | `EXPORT .CSV` (no NRIC, bank, religion, OKU, family columns) · `IMPORT` → S-IM-01 (template T2) · `ADD NEW EMPLOYEE` → S-EM-02 · `CLEAR` · `SEARCH` |
| Bulk (rows selected) | `CHANGE MANAGER` → S-EM-15 · `SEND INVITES` → S-EM-15 (only rows with Portal account = Not invited / Pending activation) |
| Sort / paging | Employee no. asc; 25 |
| Empty | No employees at all: "No employees yet. Import from Kakitangan or add one." `[IMPORT]` `[ADD NEW EMPLOYEE]` |

---

## E2 · New employee — S-EM-02 · `/employees/new` · F-EMP-02/04/05/06/07/09/14/16, F-LV-35 · US-EMP-001, 002, US-LEAVE-040

Stepper (desktop horizontal, phone vertical). `NEXT` validates the step; `BACK` keeps data; `SAVE` only on the last step (record created atomically). Steps 4 and 5 can be skipped (fields optional in R1.0 or not applicable).

```
(1 Identity) — (2 Contact & emergency) — (3 Employment) — (4 Statutory & bank) — (5 Opening leave) — (6 Review & invite)
```
| Step | Fields (in order; * = mandatory per PRD Req Y/C) |
|------|-----------------------------------------------|
| 1 Identity | A4 MyKad * (on blur: format `YYMMDD-PB-###G`, derives A5 and A7, duplicate check → "MyKad already exists for INT-… [OPEN] [REHIRE THIS PERSON]" if separated) · A2 Full name * · A3 Preferred name · A5 Date of birth * (pre-filled; change → warning "DOB differs from MyKad" `[x] Confirm override`) · A7 Gender * (pre-filled, override with warning) · A8 Nationality 🔒 Malaysian · A9 Race · A10 Race (other) (if Others) · A11 Religion (sensitive) · A12 Marital status * · A13 effective date (if not Single) · A14 OKU * (default No) · A15 OKU card no. (if Yes) · A16 Photo · A17 Passport no. · A18 Passport expiry (if A17) · A19 Highest qualification |
| 2 Contact & emergency | B1 Work email * (domain check; becomes login) · B2 Personal email * · B3 Mobile * (`+60`) · B4 Work phone · B5 Address line 1 * · B6 Lines 2/3 · B7 Postcode * · B8 City * · B9 State * · B10 Country * (Malaysia) · B11 Mailing same * (default Yes) · B12 Mailing address (if No) · **Emergency contacts** (≥ 1): C1 Priority · C2 Name * · C3 Relationship * · C4 Mobile * · C5 Alternate · C6 Email · C7 Next of kin · `ADD CONTACT` (max 3) |
| 3 Employment | F1 Join date * · F2 Continuous-service date * (default F1) · F3 Employment type 🔒 Permanent – full time · F4 Probation months * (default 3) · F5 Probation end 🔒 (computed) · F10 Department * · F11 Position * (sets default department/grade if blank) · F12 Grade * · F13 Reporting manager * (unless F14) · F14 Top of organisation (**S** only) · F15 Leave approver override · F16 Claim approver override · F17 Work location * → F18 Work state 🔒 · F19 Working-week pattern * (default from location) · F20 PH calendar override · F21 Contractual notice period · F22 Cost centre (Could) · F23 Offer/contract ref · F25 Contract/LOA signed date · F28 Employee groups (Could) · Employee no. A1 🔒 "Assigned on save: INT-006" (SA may type during import only) |
| 4 Statutory & bank (optional in R1.0, required before first PRET payroll) | Card **PCB**: H1, H2, H3, H4, H5, H9, H10 · **EPF**: H13, H14, H15, H16, H17, H18 · **SOCSO/SKBBK**: H19, H20, H21 (default = MyKad), H22 (default per age), H23, H24, H25 · **EIS**: H26, H27 · **Zakat**: H28, H29, H30, H31 · **HRDF**: H32 · **PTPTN**: H33, H34 · Card **Bank**: I1 Payment method * · I2 Bank (if transfer) · I3 Account type · I4 Account no. · I5 Holder name (name-match warning) · I6 Proof (file) · I7 Effective from · I9 ASNB — defaults pre-filled per §5.3 H ("Default Yes" etc.) |
| 5 Opening leave (only if join date is before today in the current leave year — F-LV-35) | Table per active leave type with entitlement this year (computed, 🔒) · **Taken this year** (days, 0.5 steps) · **Carry-forward remaining** (AL) + CF expiry (default 31/03) · Replacement credits (date worked, days, expiry — add rows) · Paternity occurrences used (male) |
| 6 Review & invite | Read-only summary of steps 1–5 with `EDIT` links · **Portal invite** (•) Send invite now (•) Send on {join date − 3 days, editable date} (default) (•) Don't schedule — I'll invite later · Completeness preview: "Missing for payroll: EPF no., Tax no." · `[(BACK)] [CREATE EMPLOYEE]` |
Success → S-EM-03 Overview with toast "INT-006 created · status On Probation · invite scheduled 26/11/2027."

---

## E3 · Employee profile — S-EM-03 · `/employees/{employeeNo}` · F-EMP-03–28 · US-EMP-004–027

```
┌ [photo] Ben Lee (Ben) · INT-004            ●Confirmed   Completeness 92% (2 missing ›) ┐
│ Software Engineer · Development · Manager: Aina Tan · HQ – Selangor                     │
│ Joined 01/03/2023 · 4 years 8 months 14 days · Portal: ●Active                          │
│ [EDIT ▾] [ACTIONS ▾]                                                                    │
│  ACTIONS: Send / re-send invite · Confirm · Extend probation · Record separation ·       │
│           Withdraw resignation · Rehire · Apply leave on behalf · Submit claim on behalf · │
│           Adjust leave balance · Add HR note                                            │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ Overview | Personal | Contact & emergency | Family | Employment & history | Statutory & payroll | │
│ Compensation* | Payslips* | Bank | Leave | Claims | Documents | Change requests | Notes | Activity log │
└─────────────────────────────────────────────────────────────────────────────────────────┘
* R1.1
```
Actions appear only when valid for the status (e.g. `Confirm` only On Probation; `Withdraw resignation` only Notice Period before LWD; `Rehire` only Separated). On an Admin's own record: Bank/Family/Statutory/Personal CR fields locked, `Adjust leave balance` hidden (FR-G-16).

Every tab: section cards, each with `EDIT` (→ S-EM-04 edit mode for that card); record footer created/updated by/at.

| # | Tab | Cards and fields (PRD id · edit marker) |
|---|-----|------------------------------------------|
| 1 | **Overview** | Header facts above + cards: *Key dates* (F1, F5/F6, F8, G5 if set, F26 retirement) · *Completeness* (list of missing Y and R1.1 fields, each a link to its tab — F-EMP-24) · *Upcoming* (scheduled job changes, probation end, passport/document expiry) · *Leave snapshot* (Available per type) · *Open items* (pending leave, claims, CRs) |
| 2 | **Personal** | A1 🔒 (**S** edit, logged) · A2 ✎ (not own) · A3 ✎ · A4 **R** ✎ (not own) · A5 ✎ (override warning) · A6 🔒 · A7 ✎ · A8 🔒 · A9 ✎ · A10 ✎ · A11 ✎ sensitive (not own) · A12 ✎ + A13 (not own) · A14 ✎ sensitive (not own) · A15 ✎ · A16 ✎ · A17 ✎ · A18 ✎ · A19 ✎ |
| 3 | **Contact & emergency** | B1 ✎ (login identity — change warns "This changes the user's sign-in email") · B2 ✎ · B3 ✎ · B4 ✎ · B5–B10 ✎ · B11 ✎ · B12 ✎ · Emergency contacts table C1–C7 ✎ (`ADD CONTACT`, reorder priority, delete ≥ 1 remains) |
| 4 | **Family** | Spouses table: D1 · D2 **R** · D3 · D4 · D5 · D6 · D7 · D8 · D9 — `ADD SPOUSE` (max 4 Current) ✎ (not own) · Children table: E1 · E2 **R** · E3 · Age (derived) · E4 · E5 · E6 · E7 · E8 · E9 — `ADD CHILD` ✎ (not own) · Derived card 🔒: E10, E11, E12 (4 counts; ✎ only when per-child detail unavailable — migration), E13 · Flags: "Spouse details required" (BR-EMP-16), "Child turns 18 on dd/mm/yyyy — review PCB category" (BR-EMP-17) |
| 5 | **Employment & history** | *Current employment* card: F1–F29 per PRD (F5, F9, F18, F24, F26, F27 🔒; F14 **S**; F29 R1.1) ✎ — department/position/grade/manager/location/pattern changes made **only through `ADD JOB CHANGE`** (S-EM-05) so history is kept; direct edit limited to non-effective-dated fields (F2, F4, F15, F16, F20–F23, F25, F28) · *Probation* card: F4, F5, F6, F7, F8 · latest manager recommendation (from S-AP-08) · `CONFIRM` / `EXTEND PROBATION` · *Job history* list: Effective date · Change type · Department · Position · Grade · Manager · Location · Remarks · Entered by · ●Scheduled (future) · row ⋮ Edit (future: any field; past: "Data correction" only) · Delete (future only, reason) · `ADD JOB CHANGE` · `EXPORT .CSV` · *Separation* card (if recorded): G1–G9 + `EDIT` · `WITHDRAW RESIGNATION` · *Prior employment* table L2 ✎ |
| 6 | **Statutory & payroll** | Sub-cards PCB (H1–H5, H9, H10, H11 🔒, H6–H8 shown as links to source fields) · EPF (H13–H18) · SOCSO & SKBBK (H19–H25) · EIS (H26, H27) · Zakat (H28–H31; warning if A11 ≠ Islam) · HRDF (H32) · PTPTN (H33, H34) — all ✎ (not own); R1.1-required fields marked "Needed for payroll" when blank |
| 7 | **Compensation** (R1.1) | See `wireframes-payroll.md` §Y5 (S-PY-05) |
| 8 | **Payslips** (R1.1) | List: Month › · Run no. · Pay date · Gross · Net · Status (Published / Viewed / Revised) · `DOWNLOAD` (logged) · `RE-SEND NOTICE` · filters year · `EXPORT .CSV` |
| 9 | **Bank** | I1 · I2 · I3 · I4 **R** · I5 · I6 proof (view, logged) · I7 · I8 🔒 Verified by/at · I9 **R** · `EDIT BANK DETAILS` → S-EM-17 (not own) · *Bank history* list (effective from · bank · account ••••1234 · changed by · at · source: direct / CR-…) |
| 10 | **Leave** | Balances (same cards as S-PT-05 for this employee, year selector) · Applications list (as S-PT-03 columns + Decided by) · Replacement credits · Overrides for this employee · buttons `APPLY ON BEHALF` (S-LV-02) · `ADJUST BALANCE` (S-LV-05, not own) · `ADD OVERRIDE` (S-LV-06) · `VIEW LEDGER` (S-PT-06) · `YEARLY REPORT` (S-PT-07) · Leaver card (if separated): leave position at LWD — encashable / recoverable days (F-LV-27) |
| 11 | **Claims** | List: Claim no. › · Title · Total · Status · Submitted · Approved by · Batch/run · Disbursed on · `SUBMIT ON BEHALF` (S-CL-02) · utilisation panel |
| 12 | **Documents** | List: Title › · Category · Document date · Expiry · Visible to employee (✓/—) · Uploaded by/at · ⋮ Download (logged) · Edit metadata · Change visibility · Deactivate · filters Category, Visible, Active · `UPLOAD DOCUMENT` (S-EM-11) · `EXPORT .CSV` (list only). HR-only categories (MyKad copy, Medical report, Disciplinary letter) show 🔒 "Always HR-only" |
| 13 | **Change requests** | This employee's CRs: CR no. › · Category · Submitted · Effective · Status · Decided by/at → S-EM-13 |
| 14 | **Notes** | Note list (L1): Date · Note (first 200 chars, expand) · By · Edited (history ›) · `ADD NOTE` (S-EM-16). Banner "HR-only — never shown to the employee or manager." |
| 15 | **Activity log** | Timeline (F-EMP-28): dd/mm/yyyy HH:mm · Event (Created, Invited, Job change, Leave approved LV-…, Claim disbursed CL-…, CR approved, Bank changed, Separation recorded…) · By · link. Toggle **Field changes** (F-EMP-21): Field · Before · After (masked) · Changed by · At · Source. Filters: event type, date range. `EXPORT .CSV` (**S** only) |

---

## E4 · Edit section (inline edit mode) — S-EM-04
`EDIT` on a card turns its fields into inputs (same order) with `[(CANCEL)] [SAVE]` at the card foot; other cards stay read-only. Effective-dated fields (A12 marital status) ask for their effective date. Fields locked for the user show 🔒 with the reason tooltip. Save writes audit before/after (FR-G-09).

## E5 · Add / edit job change — S-EM-05 · dialog · F-EMP-10 · US-EMP-009
Fields: JH1 Effective date * (≥ join date; future allowed → "Scheduled") · JH2 Change type * (New hire / Confirmation / Promotion / Transfer / Re-designation / Grade change / Manager change / Working-pattern change / Separation / Rehire / Data correction) · JH3 Department * · JH4 Position * · JH5 Grade * · JH6 Reporting manager * (loop check EC-EMP-03) · JH7 Work location * · JH8 Working-week pattern * · JH9 Employment type 🔒 — all pre-filled from the row in force on JH1; changed fields highlighted · JH10 Remarks (required for Data correction) + optional document link. Impact panel: "Pending approvals of this employee will re-route to {new manager}" · "PH calendar changes to WP Kuala Lumpur from 01/03/2028" · "Leave entitlements will be recomputed". `[(CANCEL)] [SAVE JOB CHANGE]`.

## E6 · Confirm / extend probation — S-EM-06 · dialog · F-EMP-11 · US-EMP-010
*Confirm:* F8 Confirmation date * (≥ join date; default probation end + 1) · Remarks · manager recommendation shown read-only · `CONFIRM EMPLOYEE` → status Confirmed, job-history row, N-47.
*Extend:* current end (🔒) · F6 New probation end * (> current; total ≤ 12 months — shows total) · F7 Reason * · `EXTEND PROBATION`.

## E7 · Record separation — S-EM-07 · `/employees/{no}/separation` · F-EMP-12, F-LV-27 · US-EMP-011, US-LEAVE-035
Left: form; right: live impact panel.
| Field | Control / rule |
|-------|----------------|
| G1 Notice date * | Date |
| G2 Separation type * | Select (8 values) — Termination during maternity period → warning (BR-LV-43, s41A) |
| G3 Reason * | Select category + text (required if Other) — HR-only |
| G4 Notice period required 🔒 | "6 weeks (EA s12, 3 years' service)" or contractual F21 |
| G5 Last working day * | Date ≥ G1; default = expected LWD; shows "Expected LWD 12/05/2027" |
| G6 Notice handling * | Served / Waived by company / Bought out by employee / Short-served; shortfall days 🔒 |
| G7 Portal access end * | Default = G5; max G5 + 30 days |
| G8 Eligible for rehire | Checkbox |
| G9 Exit remarks | Text 1000 |
Impact panel (read-only): Status after save ("Notice Period until 12/05/2027" / "Separated now" if LWD < today) · **Leave position at LWD** per type: entitlement recomputed to LWD · taken · balance → "Encashable 3.5 days" / "Recoverable 1.0 day" · Approved leave after LWD: list with "will be flagged for cancellation" · Pending approvals where this person is approver: count "will re-route" · Reportees: count "N reportees will need a new manager" (link S-OR-08) · Open claims (Approved not disbursed remain payable).
`[(CANCEL)] [RECORD SEPARATION]` → N-48. Editing later: same screen with `SAVE CHANGES`.

## E8 · Withdraw resignation — S-EM-08 · dialog · US-EMP-012
"Withdraw the separation of INT-004? Status returns to {Confirmed}. The separation details move to history." Remarks * · `WITHDRAW RESIGNATION`. Only before LWD.

## E9 · Rehire — S-EM-09 · `/employees/{no}/rehire` · F-EMP-13 (Could) · US-EMP-026
Step 1: confirm person — identity from the separated record shown read-only ("Same person" confirmation, BR-EMP-05). Step 2: Employee no. (•) Keep INT-004 (default setting) (•) New number · Continuous-service date * (•) New join date (•) Original join date (•) Other date. Step 3: Employment fields as S-EM-02 step 3 (new join date *). Step 4: review & invite. Prior history kept (read-only in Job history).

## E10 · Reveal sensitive value — S-EM-10 · dialog · F-EMP-20 · US-EMP-018
ADM: "Reveal MyKad for INT-004? This is logged." Reason * (select: Statutory submission / Payroll / Bank verification / Employee request / Other + text) · `REVEAL`. Value shown for this view only, re-masked on leave/refresh. SA: confirmation without reason (still logged). Owner (S-PT-16): `Show` without dialog (logged).

## E11 · Upload / edit document — S-EM-11 · dialog · F-EMP-18 · US-EMP-016
K1 Category * · K2 Title * · K3 File * (≤ 10 MB; PDF, JPG, PNG, HEIC, DOCX) · K4 Document date · Expiry date (≥ document date) · K5 Visible to employee (default by category; forced off 🔒 for MyKad copy, Medical report, Disciplinary letter) · K6 Remarks · `UPLOAD`. Edit: same fields except file (replace file = new document version, old kept).

## E12 · Change requests queue — S-EM-12 · `/employees/change-requests` · F-EMP-19 · US-EMP-017
List: Search CR no., employee · Filters Status (default Submitted), Category (multi), Submitted from–to, Employee · Columns CR no. › · Employee · Category · Submitted at · Effective date · Status ● · Attachments (count) · ⋮ View / Approve / Reject · `EXPORT .CSV`. Own CRs (an Admin's own) shown read-only "Your request".

## E13 · Change request review — S-EM-13 · `/employees/change-requests/{no}` · US-EMP-017, 027
Header: CR no. · Employee › · Category · Submitted at · Status. Body: changes table Field · Current value · Requested value (masked; `REVEAL` logged) · validation result per row (re-validated) · CR4 effective date · CR5 documents (viewer, logged) · CR6 remarks. Bank category: name-match warning; shared-account warning (EC-EMP-12). Decision: CR8 Remarks (required to reject) · `[(REJECT)] [APPROVE]` → changes apply on effective date; bank → N-41 (employee work + personal email, SA). Requester = me → actions hidden "You can't decide your own request."

## E14 · Bulk update via CSV — S-EM-14 · `/employees/bulk-update` · F-EMP-25 · US-EMP-022
Step 1: `DOWNLOAD TEMPLATE` (employee no. + chosen columns) · Fields to update * (multi: Reporting manager, Department, Position, Grade, Work location, Working pattern, Employee groups) · Effective date * (creates job-history rows) · Upload file *. Step 2 Preview: rows · valid · errors · warnings; table Row · Employee no. · Field · Current · New · Result (✓ / ✕ message); `DOWNLOAD ERROR REPORT`. Step 3: `COMMIT {n} CHANGES` (only when 0 errors) → summary.

## E15 · Bulk actions — S-EM-15 · dialogs · US-EMP-022, US-MIG-011
*Change manager:* {n} employees listed · New reporting manager * · Effective date * · Remarks · loop check per row · `APPLY`. *Send invites:* {n} eligible (others listed as skipped with reason: already active / no work email / separated) · (•) Send now (•) Schedule on dd/mm/yyyy · `SEND INVITES` → N-50.

## E16 · HR note — S-EM-16 · dialog · F-EMP-26 · US-EMP-023
L1 Note date * (default today) · Note text * (0/2000) · `SAVE NOTE`. Edit keeps history (Edited ›: version list with by/at).

## E17 · Edit bank details — S-EM-17 · dialog · F-EMP-16 · US-EMP-015
Current (masked) shown above. Fields: I1 Payment method * · I2 Bank * · I3 Account type * · I4 Account no. * (digits, 6–20) · I5 Account holder * (warning if ≠ full name: "Holder name differs from the employee's name — joint or third-party accounts are discouraged" `[x] Continue anyway`) · I6 Proof * (file) · I7 Effective from * (default today) · I9 ASNB. Notice: "Saving notifies the employee (work and personal email) and the Super Admin." No confirmation step (D15). `SAVE BANK DETAILS`. Not available on own record. If an open disbursement batch / payroll payment list includes this employee: warning "PB-2027-011 outputs will be marked out of date" (EC-CLM-10).

---

## Open UX questions touching this file
UXQ-02 (CRs in Approvals inbox). **UXQ-13**: direct edits to department / position / grade / manager / location / pattern on the Employment card are routed through `ADD JOB CHANGE` to keep effective-dated history — please confirm (PRD lists them as A/S-editable fields; history requires effective dating).

## Ready for GATE 2 (design)?
All employee-record screens and every profile tab specified at field level with edit rights per role. **Yes.**
