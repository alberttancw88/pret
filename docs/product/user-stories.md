# PRET — User Stories & Acceptance Criteria (Phase 1: R1.0 + R1.1)

**Work item:** W1-002 · **Author:** Product / Business Analyst · **Status:** Approved at GATE 1 (Scope), 15/11/2026 — amended for D11–D16
**Last updated:** 15/11/2026 — amended the same day for Albert's Gate 1 decisions D11 (four roles), D12 (single-level claims approval, month-end disbursement), D13 (statutory leave), D14 (no PDPA extras), D15 (Admin/SA maintain bank details, no confirmation) and D16 (all payments directly through HLB)
**Builds on:** [`BRD.md`](BRD.md), [`PRD.md`](PRD.md) (Function Catalogue §1, field tables, rules), [`docs/01-decisions.md`](../01-decisions.md) (D1–D16), [`docs/reference/kakitangan-study.md`](../reference/kakitangan-study.md)

> Stories are grouped by epic (one per module). Each has a **stable id**, the role, the
> capability and the value, a **MoSCoW** priority, its **release** (R1.0 = HR, leave,
> claims, portal; R1.1 = payroll — D5), a **trace** to the PRD function id(s), and
> **Given/When/Then** acceptance criteria that QA verifies. Where a criterion depends on
> an Open Question, the proposed default is used and the question id is noted
> (e.g. *(Q10)*). Synthetic examples only — no real employee data.

**Roles (D11):** Employee (EMP) · Manager (MGR — derived from the reporting line; scope = reportees) · Admin (ADM — one role covering employee records/HR, leave admin, claims/finance and payroll; the outsourced administrator is an External user holding ADM) · Super Admin (SA — everything). The former HR Admin, Finance and Payroll Admin roles are merged into Admin. In acceptance criteria "Admin" means a user holding ADM.
**Priority key:** Must / Should / Could / Won't (within Phase 1). **Release key:** R1.0 / R1.1. A story marked **Removed (D1x)** keeps its id but is out of scope.

## Epic index

| Epic | Module | Stories | Release |
|------|--------|---------|---------|
| [US-EMP](#epic-m1--employee-master-records-us-emp) | M1 Employee master records | 27 | R1.0 |
| [US-LEAVE](#epic-m2--leave-management-us-leave) | M2 Leave management | 43 (1 added) | R1.0 |
| [US-CLAIM](#epic-m3--claims-management-us-claim) | M3 Claims management | 27 (3 removed, 2 added) | R1.0 |
| [US-PORTAL](#epic-m4--employee-self-service-portal-us-portal) | M4 Employee portal | 17 (1 removed) | R1.0 (+1 R1.1) |
| [US-ORG](#epic-m5--organisation--company-setup-us-org) | M5 Organisation & company setup | 11 | R1.0 |
| [US-ADMIN](#epic-m6--users-roles-access--audit-us-admin) | M6 Users, roles, access & audit (incl. cross-cutting) | 23 (1 removed) | R1.0 |
| [US-REPORT](#epic-m7--reports--exports-us-report) | M7 Reports & exports | 24 (1 removed) | R1.0 |
| [US-NOTIF](#epic-m8--notifications-us-notif) | M8 Notifications | 10 | R1.0 |
| [US-MIG](#epic-m9--data-migration-us-mig) | M9 Data migration | 17 | R1.0 (+4 R1.1) |
| [US-PAY](#epic-m10--payroll-us-pay) | M10 Payroll | 43 | R1.1 |

---

## Epic M1 — Employee master records (US-EMP)

### US-EMP-001 — Create an employee record · Must · R1.0 · F-EMP-02
**As** an Admin, **I want** to create a new employee with all mandatory identity, contact and employment fields, **so that** the person exists in PRET before their first day.
- **Given** HR enters all mandatory fields (PRD §5.3 A, B, C, F) with valid values, **when** they save, **then** the record is created, an employee no. `INT-nnn` continuing the sequence is assigned *(Q32)*, and status is Pending Join if the join date is in the future, otherwise On Probation (or Confirmed if probation = 0).
- **Given** any mandatory field is empty or invalid, **when** HR saves, **then** saving is blocked, each error is shown next to its field and entered data is kept.
- **Given** "Invite to portal now" is unticked, **when** the record is saved, **then** an invite is scheduled for join date − 3 days and is visible on the record.

### US-EMP-002 — Validate MyKad and derive DOB and gender · Must · R1.0 · F-EMP-05
**As** an Admin, **I want** the MyKad number validated and DOB/gender derived from it, **so that** identity data is consistent and typing errors are caught.
- **Given** HR enters `900101145678`, **when** the field loses focus, **then** it displays as `900101-14-5678`, DOB pre-fills 01/01/1990 and gender pre-fills Female (last digit even).
- **Given** a MyKad whose first six digits are not a valid date (e.g. `991332…`), **when** HR saves, **then** saving is blocked with "Invalid MyKad date".
- **Given** a MyKad that already exists on another employee record, **when** HR saves, **then** saving is blocked with the existing employee no.; if that employee is Separated the option "Rehire this person" is offered.
- **Given** HR overrides the derived DOB, **when** they confirm the warning, **then** the override is saved and logged in the audit trail.

### US-EMP-003 — Search, filter and export the employee list · Must · R1.0 · F-EMP-01
**As** an Admin, **I want** a searchable, filterable employee list with CSV export, **so that** I can find and report on employees quickly.
- **Given** the employee list, **when** it opens, **then** it shows the PRD §5.7 columns, active statuses only by default, 25 rows per page and "1–25 of N".
- **Given** keyword "INT-004" or part of a name, **when** HR clicks SEARCH, **then** only matching employees are shown; CLEAR resets all filters.
- **Given** filters department = Development and status = Confirmed, **when** HR clicks EXPORT .CSV, **then** the file contains all matching rows across all pages with the same columns and no NRIC, bank, religion, OKU or family columns.
- **Given** a Manager or Employee requests the employee list URL, **when** the request is made, **then** access is denied server-side and logged (only Admin and Super Admin hold F-EMP-01).

### US-EMP-004 — View the employee profile according to role · Must · R1.0 · F-EMP-03
**As** any authorised user, **I want** to see the employee profile tabs and fields my role allows, **so that** I can do my job without seeing more personal data than necessary.
- **Given** an Employee opens their own profile, **when** it loads, **then** they see the tabs and fields marked E in PRD §5.4 and no HR notes, audit history or employer-only flags.
- **Given** a Manager opens a direct reportee's profile, **when** it loads, **then** only name, gender, contact phone, emergency contacts and the limited employment fields are visible — no MyKad, bank, family, statutory, religion or documents.
- **Given** a Manager attempts to open a non-reportee's profile by URL, **when** the request is made, **then** "Not found or no access" is shown and the attempt is logged.

### US-EMP-005 — Maintain personal and identity details · Must · R1.0 · F-EMP-04
**As** an Admin, **I want** to maintain legal name, race, religion, marital status, OKU status, passport and qualification, **so that** records stay accurate for HR and payroll.
- **Given** HR changes marital status to Married, **when** they save, **then** an effective date is required and a completeness flag "Spouse details required" appears until a spouse row exists.
- **Given** race = Others, **when** HR saves without "Race (other)", **then** saving is blocked.
- **Given** HR edits religion or OKU status, **when** saved, **then** the change is audited and these fields remain visible only to the employee, Admin and Super Admin.

### US-EMP-006 — Employee self-updates contact and emergency details · Must · R1.0 · F-EMP-06, F-EMP-07
**As** an Employee, **I want** to update my phone, personal email, addresses and emergency contacts myself, **so that** HR always has current contact details.
- **Given** an Employee edits their mobile number to a valid Malaysian mobile, **when** they save, **then** the change applies immediately and HR receives an in-app notice (N-40).
- **Given** the Employee deletes their only emergency contact, **when** they save, **then** saving is blocked: "At least one emergency contact is required".
- **Given** a postcode of 4 digits, **when** they save, **then** saving is blocked with "Postcode must be 5 digits".

### US-EMP-007 — Record spouse and children for PCB · Must · R1.0 · F-EMP-08
**As** an Admin, **I want** to record spouses (up to 4) and children with their PCB categories, **so that** payroll can apply the correct reliefs.
- **Given** a Married employee, **when** HR adds a spouse with MyKad, working status and disabled flag, **then** the PCB category (derived) updates accordingly.
- **Given** a child aged 17, **when** HR selects PCB category "18+ in diploma+", **then** saving is blocked as inconsistent with age.
- **Given** children are recorded, **when** the record is viewed, **then** the four Kakitangan counts (children < 18, tertiary > 18, disabled < 18, disabled tertiary) are derived and displayed.

### US-EMP-008 — Maintain employment details with reporting-line checks · Must · R1.0 · F-EMP-09
**As** an Admin, **I want** to set department, position, grade, manager, location and working pattern, **so that** approvals, PH calendars and entitlements are correct.
- **Given** HR selects as manager an employee who reports (directly or indirectly) to this employee, **when** they save, **then** saving is blocked: "Reporting line would create a loop".
- **Given** HR changes the work location to one in WP Kuala Lumpur, **when** the change takes effect, **then** the employee's work state and PH calendar change from that date.
- **Given** no reporting manager and "Top of organisation" not ticked, **when** HR saves, **then** saving is blocked.

### US-EMP-009 — Record effective-dated job changes · Must · R1.0 · F-EMP-10
**As** an Admin, **I want** to record promotions, transfers and manager changes with an effective date (including future dates), **so that** history is kept and changes apply automatically.
- **Given** a promotion effective 01/03/2027 entered on 15/02/2027, **when** 01/03/2027 00:00 MYT arrives, **then** the new position and grade become current and the row loses its "Scheduled" chip.
- **Given** a manager change takes effect, **when** the employee has pending leave or claims at the "Direct manager" level, **then** those items re-route to the new manager and the trail records the re-routing.
- **Given** HR edits a past job-history row, **when** they save, **then** change type "Data correction" and remarks are mandatory and the edit is audited.

### US-EMP-010 — Track probation and confirm · Must · R1.0 · F-EMP-11
**As** an Admin, **I want** probation end dates tracked with reminders and a confirm/extend action, **so that** confirmations are not missed.
- **Given** join date 01/12/2026 and 3 months' probation, **when** the record is saved, **then** probation end shows 28/02/2027.
- **Given** probation ends in 14 days, **when** the daily job runs, **then** the manager and HR receive N-44.
- **Given** HR extends probation, **when** they save without a reason, **then** saving is blocked; with a reason, the new end date applies and total probation may not exceed 12 months.
- **Given** HR confirms the employee, **when** saved, **then** status becomes Confirmed, a "Confirmation" job-history row is added and the employee is notified (N-47).

### US-EMP-011 — Record a separation · Must · R1.0 · F-EMP-12
**As** an Admin, **I want** to record resignation, termination, retirement or other separation with notice and last working day, **so that** access, leave and final pay are handled correctly.
- **Given** an employee with 3 years' service resigns on 01/04/2027 and no contractual notice is recorded, **when** HR opens the separation form, **then** the required notice defaults to 6 weeks (EA s12) and expected LWD to 12/05/2027.
- **Given** HR saves a separation with LWD in the future, **when** saved, **then** status becomes Notice Period; the day after LWD it becomes Separated automatically.
- **Given** the LWD is set, **when** saved, **then** the leaver leave position (encashable/recoverable days) is computed and shown, and approved leave after LWD is flagged for cancellation.

### US-EMP-012 — Withdraw a resignation · Should · R1.0 · F-EMP-12
**As** an Admin, **I want** to reverse a resignation before the last working day, **so that** an employee who stays keeps their record intact.
- **Given** an employee in Notice Period, **when** HR selects "Resignation withdrawn" before LWD, **then** status reverts to On Probation or Confirmed as before and the separation data moves to history.
- **Given** the LWD has passed, **when** HR tries to withdraw, **then** the action is unavailable.

### US-EMP-013 — Maintain the statutory and payroll-deduction profile · Must · R1.0 · F-EMP-14
**As** an Admin, **I want** to capture every Kakitangan Compensation-tab statutory field (PCB, EPF, SOCSO/SKBBK, EIS, Zakat, HRDF, PTPTN), **so that** payroll in R1.1 has complete data.
- **Given** a new employee, **when** created, **then** defaults apply: Pay tax = Yes, Pay EPF = Yes, Pay SOCSO = Yes, SOCSO no. = MyKad, EPF rate = Statutory, Pay zakat = No.
- **Given** "Pay zakat via payroll" = Yes, **when** HR saves without amount or account no., **then** saving is blocked; if religion ≠ Islam a warning is shown.
- **Given** PTPTN monthly deduction > 0, **when** HR saves without start/end dates, **then** saving is blocked.
- **Given** EPF no. is blank, **when** the record is saved, **then** it saves (R1.0) but the completeness indicator lists "EPF no." as required for payroll.

### US-EMP-014 — Derive PCB relief inputs · Must · R1.0 · F-EMP-15
**As** an Admin, **I want** PCB category and relief inputs derived from marital, spouse, OKU and children data, **so that** PCB is computed from one source of truth.
- **Given** a married employee whose only current spouse is "Not working", **when** the profile is viewed, **then** the derived PCB category shows "Married, spouse not working".
- **Given** a spouse is set to Former, **when** the profile is viewed, **then** that spouse no longer counts for PCB.

### US-EMP-015 — Maintain bank details with fraud alerts · Must · R1.0 · F-EMP-16, FR-EMP-11
**As** an Admin, **I want** bank and ASNB details maintained with proof and alerts, **so that** payments go to the right account and unauthorised changes are noticed.
- **Given** an Admin or Super Admin changes an employee's bank account, **when** saved, **then** a proof document is required, the change takes effect immediately with **no confirmation step** (D15), the before/after values are written to the audit trail (masked), the employee is emailed at both work and personal email, and the Super Admin is notified (N-41).
- **Given** the account holder name differs from the employee's full name, **when** the Admin saves, **then** a warning is shown and acknowledgement is required.
- **Given** an Admin views the bank tab, **when** it loads, **then** the account no. is masked `••••••1234` and revealing it requires a reason and is logged.
- **Given** an Admin who is also an employee opens their own bank tab, **when** they try to edit, **then** the fields are locked and only "Request change" is available (approved by another Admin or SA).

### US-EMP-016 — Store employee documents with restricted access · Must · R1.0 · F-EMP-18
**As** an Admin, **I want** to upload categorised documents with controlled visibility, **so that** contracts and certificates are kept securely.
- **Given** HR uploads a "MyKad copy", **when** saving, **then** "Visible to employee" is forced off and cannot be enabled.
- **Given** an offer letter marked visible, **when** the employee opens My Documents, **then** they can view and download it; other HR-only documents are not listed.
- **Given** any document is downloaded by someone other than the employee, **when** it downloads, **then** an access-log entry is written.
- **Given** a 12 MB file or an .exe, **when** HR uploads it, **then** it is rejected with the allowed types and size.

### US-EMP-017 — Request and approve sensitive changes · Must · R1.0 · F-EMP-19
**As** an Employee, **I want** to request changes to my legal name, family, bank or statutory numbers, **so that** HR can verify and apply them.
- **Given** an Employee submits a bank change with proof, **when** submitted, **then** a CR `CR-yyyy-nnnnn` is created with status Submitted and HR is notified (N-43).
- **Given** a bank CR without proof, **when** the employee submits, **then** submission is blocked.
- **Given** HR approves the CR, **when** approved, **then** the new values apply on the effective date and the employee is notified (N-42); on reject, a reason is mandatory.
- **Given** an open bank CR exists, **when** the employee starts another bank CR, **then** it is blocked.

### US-EMP-018 — Mask and reveal sensitive identifiers · Must · R1.0 · F-EMP-20
**As** a Super Admin, **I want** MyKad and bank account numbers masked by default with logged reveal, **so that** casual exposure is prevented and access is accountable.
- **Given** an Admin views a profile, **when** it loads, **then** MyKad shows `******-**-5678` with a "Reveal" control.
- **Given** HR clicks Reveal, **when** prompted, **then** a reason is required and the reveal is logged with user, time and field.
- **Given** an employee views their own MyKad, **when** it loads, **then** it is shown in full without a log entry.

### US-EMP-019 — See record change history and activity log · Must · R1.0 · F-EMP-21, F-EMP-28
**As** an Admin, **I want** a timeline and field-level history for each employee, **so that** I can see who changed what and when.
- **Given** a field was changed, **when** HR opens Activity log, **then** the entry shows date-time, user, field, before and after (sensitive values masked).
- **Given** an Employee opens their own profile, **when** they look for Activity log, **then** it is not available.

### US-EMP-020 — Look up colleagues in the staff directory · Should · R1.0 · F-EMP-23
**As** an Employee, **I want** a staff directory, **so that** I can contact colleagues.
- **Given** the directory, **when** it opens, **then** it lists active employees with name, preferred name, photo, position, department, location, work email and work phone only.
- **Given** an employee is Separated, **when** the directory loads, **then** they are not listed.

### US-EMP-021 — See data completeness per employee · Should · R1.0 · F-EMP-24
**As** an Admin, **I want** a completeness indicator, **so that** I can fix gaps before payroll goes live.
- **Given** an employee missing tax no. and bank account, **when** HR opens the overview, **then** completeness shows below 100% and lists both missing fields with links.

### US-EMP-022 — Bulk update employees by CSV · Should · R1.0 · F-EMP-25
**As** an Admin, **I want** to bulk update selected fields by CSV, **so that** reorganisations are quick.
- **Given** a CSV changing the manager of 3 employees, **when** HR runs validation, **then** a preview lists each change (before → after) and any errors; committing applies all or none.

### US-EMP-023 — Keep private HR notes · Should · R1.0 · F-EMP-26
**As** an Admin, **I want** dated private notes on an employee, **so that** context is kept.
- **Given** HR adds a note, **when** the employee or manager opens the profile, **then** the note is not visible to them.

### US-EMP-024 — Record prior employment · Could · R1.0 · F-EMP-27
**As** an Admin, **I want** to record past jobs before joining, **so that** career history is complete.
- **Given** a prior job with "to" date after the join date, **when** saved, **then** saving is blocked.

### US-EMP-025 — View the org chart · Could · R1.0 · F-EMP-22
**As** an Employee, **I want** to see the reporting structure, **so that** I understand who is who.
- **Given** the org chart, **when** it opens, **then** it shows names, positions and reporting lines only, for active employees.

### US-EMP-026 — Rehire a former employee · Could · R1.0 · F-EMP-13
**As** an Admin, **I want** to rehire a separated person, **so that** identity data is reused and history kept.
- **Given** a Separated employee, **when** HR chooses Rehire with a new join date, **then** a new employment starts with prior history retained and HR chooses the continuous-service date.

### US-EMP-027 — Admin cannot edit their own sensitive fields · Must · R1.0 · FR-EMP-12, FR-G-16
**As** a Super Admin, **I want** an internal Admin's own sensitive changes approved by someone else, **so that** nobody self-approves changes to their own bank or family data.
- **Given** an Admin who is also an employee opens their own bank tab, **when** they try to edit, **then** the fields are locked and only "Request change" is available.
- **Given** that Admin submits a CR, **when** it appears in the CR queue, **then** they cannot approve it; another Admin or SA must.

---
## Epic M2 — Leave management (US-LEAVE)

### US-LEAVE-001 — Configure leave types · Must · R1.0 · F-LV-01
**As** an Admin, **I want** to configure leave types with all PRD §6.3 options, **so that** Interact's policy is represented without code changes.
- **Given** HR creates a type with code, name, category, paid flag, count basis, entitlement method, eligibility, half-day, attachment, back-date, caps, workflow and colour, **when** they save, **then** the type appears in the apply form for eligible employees only.
- **Given** a duplicate code, **when** HR saves, **then** saving is blocked.
- **Given** a statutory category type (Annual, Sick, Hospitalisation, Maternity, Paternity), **when** HR tries to deactivate it while employees are eligible, **then** the action is blocked.

### US-LEAVE-002 — Warn when below the Employment Act minimum · Must · R1.0 · BR-LV-02, §4.1
**As** a Super Admin, **I want** HR prevented from saving statutory entitlements below the EA minimum, **so that** Interact does not repeat the current Kakitangan gaps.
- **Given** HR sets Maternity to 60 days, **when** they save, **then** a blocking warning cites the 98-day minimum (s37); only an SA can override with a reason, which is logged.
- **Given** HR sets the ≥ 5-year Sick band to 14 days, **when** they save, **then** the same blocking warning cites 22 days (s60F).

### US-LEAVE-003 — Define service-band entitlements · Must · R1.0 · F-LV-02
**As** an Admin, **I want** entitlements by years-of-service band, **so that** entitlement grows with service as the law requires.
- **Given** Annual bands 0–2 = 12, 2–5 = 12, ≥ 5 = 16 *(D13)*, **when** the Admin saves, **then** bands must be contiguous from 0 with no gaps or overlaps.
- **Given** a grade-specific row exists, **when** entitlement is generated for an employee in that grade, **then** the grade row is used instead of the general row.

### US-LEAVE-004 — Configure the leave policy · Must · R1.0 · F-LV-03
**As** an Admin, **I want** to choose accrual method, pro-rata basis, rounding, carry-forward cap/expiry and emergency threshold, **so that** the engine matches Interact's Kakitangan options.
- **Given** the seeded policy, **when** HR opens settings, **then** defaults are: accrual pro-rata, by day, round up to nearest half day, EA floor on, carry-forward cap 10, expiry 3 months, emergency threshold 3 days *(Q8, Q9, Q13)*.
- **Given** HR changes the rounding rule, **when** saved, **then** entitlements are recomputed for the current year and the change is audited.

### US-LEAVE-005 — Generate entitlements and accrue · Must · R1.0 · F-LV-04
**As** an Employee, **I want** my entitlement and earned-to-date balance calculated automatically, **so that** I always see the right figure.
- **Given** a full-year employee with 12 days AL and accrual pro-rata by day, **when** they apply on 01/07/2027 for leave ending 02/07/2027, **then** earned-to-date = 12 × 183/365 = 6.02 → rounded up to 6.5 days.
- **Given** the employee's join date is corrected, **when** saved, **then** entitlements are recomputed and the ledger shows the recalculation.

### US-LEAVE-006 — Pro-rate joiners and leavers with rounding · Must · R1.0 · F-LV-04, BR-LV-13
**As** an Admin, **I want** joiners' and leavers' entitlements pro-rated with the configured rounding and EA floor, **so that** part-year staff get the correct days.
- **Given** an employee joining 10/03/2027 with 12 days AL and pro-rata by day, **when** entitlement is generated, **then** it equals 12 × 297/365 = 9.76 → 10.0 days (round up to ½).
- **Given** the EA floor is on, **when** a pro-rated result would be below the EA rule computed by completed months, **then** the higher value is used.
- **Given** Sick leave (LT9 = No), **when** the employee joins mid-year, **then** the full band days are granted.

### US-LEAVE-007 — Handle a mid-year service-band change · Must · R1.0 · BR-LV-11
**As** an Employee, **I want** my entitlement to rise from my service anniversary, **so that** I receive what I am due.
- **Given** an employee reaches 5 years on 01/07/2027 with AL 12 → 16, **when** the year's entitlement is computed by day, **then** it is 12 × 181/365 + 16 × 184/365 = 14.02 → 14.5 days (round up to ½).

### US-LEAVE-008 — Apply for leave (full or half day) · Must · R1.0 · F-LV-05
**As** an Employee, **I want** to apply for leave for one or more days or a half day, **so that** I can take time off properly.
- **Given** the apply form, **when** the Employee opens the leave-type list, **then** each eligible type shows "x.x days available".
- **Given** a single-day AM application, **when** submitted, **then** days = 0.5 and status = Pending (level 1 of 2).
- **Given** a multi-day application, **when** the Employee chooses the start session, **then** only Full or PM is allowed for the first day and Full or AM for the last day.
- **Given** the type requires a reason, **when** the reason is empty, **then** submission is blocked.

### US-LEAVE-009 — Count working days by pattern and state holidays · Must · R1.0 · F-LV-06
**As** an Employee, **I want** rest days, off days and my state's public holidays excluded, **so that** only real working days are deducted.
- **Given** a Selangor employee on Mon–Fri applies Thu 30/08/2029–Mon 03/09/2029 with 31/08 National Day, **when** days are computed, **then** days = 2 (Thu, Mon).
- **Given** a holiday observed only in Selangor, **when** a WP KL employee applies for that date, **then** it counts as 1 day for them.
- **Given** a range with only weekend days, **when** submitted, **then** it is blocked: "No working days in the selected dates".

### US-LEAVE-010 — Preview the balance before submitting · Must · R1.0 · F-LV-07
**As** an Employee, **I want** to see days requested and the balance after approval before I submit, **so that** I don't over-apply.
- **Given** available 8.0 and pending 1.0, **when** the Employee selects 2 days, **then** the preview shows Available now 8.0 · This application 2.0 · Pending 1.0 · Available after 5.0.

### US-LEAVE-011 — Validate overlap, eligibility and balance · Must · R1.0 · F-LV-30, BR-LV-50–58
**As** the system, **I want** to validate each application server-side, **so that** invalid leave cannot be submitted.
- **Given** an approved full day on 05/05/2027, **when** the Employee applies again for 05/05/2027, **then** submission is blocked; an AM application on a day with an existing PM half is allowed.
- **Given** a male employee, **when** they open the type list, **then** Maternity is not offered.
- **Given** available-to-apply is 1.5 days and negative balance is not allowed, **when** the Employee applies for 2 days, **then** submission is blocked.
- **Given** a date after the employee's LWD, **when** they apply, **then** submission is blocked.

### US-LEAVE-012 — Split applications that cross the leave year · Must · R1.0 · BR-LV-25
**As** an Employee, **I want** a 30/12–02/01 application handled automatically, **so that** each year's balance is used correctly.
- **Given** an application 30/12/2027–03/01/2028, **when** submitted, **then** two linked applications `…-1` and `…-2` are created, each validated against its own year, and approved or rejected together.

### US-LEAVE-013 — Withdraw a pending application · Must · R1.0 · F-LV-08
**As** an Employee, **I want** to withdraw an application not yet decided, **so that** I can change my plans.
- **Given** a Pending application, **when** the Employee withdraws it, **then** status = Withdrawn, pending days are released and the approver gets an in-app notice (N-04).

### US-LEAVE-014 — Approve leave through Direct Manager → Admin · Must · R1.0 · F-LV-09
**As** a Manager and an Admin, **I want** each application to pass my level, **so that** leave is approved as in Kakitangan today *(Q10)*.
- **Given** a submitted application, **when** the direct manager approves, **then** status shows Pending L2 and any Admin (other than the applicant) receives N-01.
- **Given** an Admin approves at level 2, **when** saved, **then** status = Approved, days move to Taken and the employee receives N-02.
- **Given** any level rejects without a comment, **when** they confirm, **then** rejection is blocked; with a comment, status = Rejected and N-03 is sent.
- **Given** the applicant is an Admin, **when** level 2 is reached, **then** they cannot approve their own application; another Admin or SA must.

### US-LEAVE-015 — Bulk approve or decline · Must · R1.0 · F-LV-09, BR-LV-64
**As** an approver, **I want** to approve or decline several applications at once, **so that** I can clear my queue quickly.
- **Given** 3 selected applications where I am the current approver, **when** I click APPROVE SELECTED with one comment, **then** each moves to its next level or Approved, and a per-item result is shown.
- **Given** a selection includes an item not at my level, **when** I bulk approve, **then** that item is skipped and reported.

### US-LEAVE-016 — Cancel approved leave · Must · R1.0 · F-LV-10
**As** an Employee, **I want** to cancel approved leave, **so that** my balance is restored if plans change.
- **Given** approved leave starting in the future and self-cancel allowed, **when** the Employee cancels, **then** status = Cancelled, days are restored, and approver(s) and HR are notified (N-06).
- **Given** approved leave that has started or passed, **when** the Employee requests cancellation, **then** status = Cancellation Pending and the approver receives N-05; on approval it becomes Cancelled and days are restored; on rejection it returns to Approved (N-07).

### US-LEAVE-017 — Apply, withdraw or cancel on behalf · Should · R1.0 · F-LV-11
**As** an Admin, **I want** to act on behalf of an employee, **so that** leave is recorded when they cannot do it themselves.
- **Given** HR applies sick leave for a hospitalised employee, **when** saved, **then** a reason is mandatory, the application shows "On behalf by <HR name>" and the employee and manager are emailed (N-08/N-09).
- **Given** HR applies on behalf beyond the back-date window, **when** saved, **then** it is allowed with the reason recorded.

### US-LEAVE-018 — Enforce the 60-day sick + hospitalisation pool · Must · R1.0 · F-LV-12
**As** the system, **I want** hospitalisation capped at 60 days in aggregate with sick leave, **so that** the EA rule is applied.
- **Given** an employee (≥ 5 years) has taken 22 days SL, **when** they apply for 40 days HL, **then** submission is blocked showing HL available = 38.
- **Given** SL is exhausted, **when** the employee applies for more SL without hospitalisation, **then** submission is blocked suggesting Annual or Unpaid leave.

### US-LEAVE-019 — Require MC and limit back-dating for sick leave · Must · R1.0 · F-LV-17, BR-LV-35
**As** an Admin, **I want** sick leave to carry an MC and be submitted within the window, **so that** the 48-hour rule and policy are respected *(Q13)*.
- **Given** a sick leave application without an attachment, **when** submitted, **then** it is blocked: "Medical certificate required".
- **Given** sick leave ended 4 working days ago, **when** the employee submits it, **then** it is blocked with "Contact HR"; HR can enter it on behalf.
- **Given** sick leave ended 2 working days ago, **when** submitted with MC, **then** it is accepted and flagged EMERGENCY.

### US-LEAVE-020 — Apply for maternity leave · Must · R1.0 · F-LV-13
**As** a female Employee, **I want** to apply for 98 consecutive days of maternity leave, **so that** I receive my statutory entitlement.
- **Given** a female employee chooses Maternity and a start date, **when** the form computes, **then** the end date is start + 97 days and is read-only, and expected confinement date and attachment are mandatory.
- **Given** the application is submitted, **when** HR views it, **then** a maternity-allowance eligibility indicator is shown (HR only).

### US-LEAVE-021 — Apply for paternity leave · Must · R1.0 · F-LV-14
**As** a married male Employee with ≥ 12 months' service, **I want** 7 consecutive days of paternity leave, **so that** I can support my family.
- **Given** a married male with 14 months' service, **when** he applies, **then** Paternity is offered and end date = start + 6 days.
- **Given** a married male with 10 months' service, **when** he opens the type list, **then** Paternity is not offered (minimum service 12 months).
- **Given** 5 paternity occurrences already used (including migrated history), **when** he applies, **then** submission is blocked.
- **Given** submission less than 30 days before expected confinement, **when** submitted, **then** a warning is shown but submission is allowed.

### US-LEAVE-022 — Request replacement leave credit · Must · R1.0 · F-LV-15
**As** an Employee, **I want** to request credit for working on a rest day, off day or public holiday, **so that** I can take the time back later.
- **Given** the Employee worked a full day on Sunday 07/03/2027, **when** they submit a credit request, **then** the system shows "Rest day", credit = 1.0, and the approver receives N-11.
- **Given** a date that is a normal working day, **when** submitted, **then** it is blocked.
- **Given** the credit is approved, **when** the Employee views balances, **then** Replacement Leave shows +1.0 with expiry 05/06/2027 (90 days) *(Q16)*.
- **Given** HR uses batch apply for 3 employees, **when** saved, **then** 3 credit requests are created.

### US-LEAVE-023 — Expire replacement credits first-in-first-out · Must · R1.0 · F-LV-15, F-LV-20
**As** the system, **I want** replacement credits consumed and expired by earliest expiry, **so that** balances are fair and predictable.
- **Given** two credits expiring 01/05 and 01/06, **when** 1 day of replacement leave is taken, **then** the 01/05 credit is consumed.
- **Given** a credit reaches its expiry unused, **when** the nightly job runs, **then** the ledger shows "Expired −1.0"; 30 days earlier the employee received N-13.

### US-LEAVE-024 — Flag emergency leave · Must · R1.0 · F-LV-16
**As** a Manager, **I want** last-minute or back-dated leave flagged, **so that** I notice it immediately.
- **Given** annual leave submitted 2 days before its start date, **when** submitted, **then** it carries the EMERGENCY chip and the approver email subject starts with `[EMERGENCY]`.
- **Given** annual leave submitted 10 days ahead, **when** submitted, **then** it is not flagged.

### US-LEAVE-025 — Adjust a balance manually · Must · R1.0 · F-LV-18
**As** an Admin, **I want** to add or deduct days with a mandatory reason, **so that** corrections are controlled and auditable.
- **Given** HR enters +1.5 days AL with reason "Correction per policy", **when** saved, **then** the ledger shows the adjustment with HR's name and the employee receives N-10.
- **Given** a reason shorter than 10 characters or days = 0, **when** saved, **then** saving is blocked.
- **Given** an Admin selects their own record, **when** they try to adjust, **then** the action is blocked.

### US-LEAVE-026 — Run year-end roll-over · Must · R1.0 · F-LV-19
**As** an Admin, **I want** to preview and run year-end roll-over, **so that** carry-forward and forfeiture are processed correctly.
- **Given** an employee closes 2027 with 13.5 days AL and cap 10, **when** HR previews, **then** carried = 10.0, forfeited = 3.5, CF expiry 31/03/2028.
- **Given** HR runs roll-over twice, **when** the second run completes, **then** no balances change (idempotent).
- **Given** the run completes, **when** HR checks notifications, **then** N-18 links to the year-end report.

### US-LEAVE-027 — Expire unused carry-forward · Must · R1.0 · F-LV-20
**As** the system, **I want** carry-forward used first and expired at its expiry date, **so that** the cap/expiry policy applies.
- **Given** 10 days CF expiring 31/03/2028 and 3 days of AL taken in Feb 2028, **when** 01/04/2028 arrives, **then** 7 days CF expire and the new-year entitlement is untouched.

### US-LEAVE-028 — See my balances and ledger · Must · R1.0 · F-LV-21, F-LV-28
**As** an Employee, **I want** each balance broken down with a transaction ledger, **so that** I understand how it was calculated.
- **Given** My balances, **when** opened, **then** each visible type shows Available and the components Entitled, Carried forward, Earned, Adjustments, Taken, Pending, Expired (and Earned to date under accrual).
- **Given** I tap a type, **when** the ledger opens, **then** every transaction is listed with date, days (+/−), reference and running balance.

### US-LEAVE-029 — Manage all leave applications · Must · R1.0 · F-LV-22
**As** an Admin, **I want** a list of all applications with Kakitangan's columns and filters, **so that** I can manage leave company-wide.
- **Given** the list, **when** it opens, **then** it shows Employee, From, To, Days, Reason, Attachment, Type, Applied, Status, Approver and date, with filters for name, location, department, date range, type, status, emergency and on-behalf.
- **Given** a Manager opens the list, **when** it loads, **then** only their reportees' applications are shown.

### US-LEAVE-030 — View the team leave calendar · Must · R1.0 · F-LV-23
**As** an Employee or Manager, **I want** a month calendar of leave and holidays, **so that** I can plan around colleagues.
- **Given** an Employee opens the calendar, **when** it loads, **then** colleagues' approved leave shows as "On leave" without type, and PHs for the selected location are shown *(Q17)*.
- **Given** a Manager opens it, **when** it loads, **then** reportees' approved and pending leave show with type colours (sick/maternity as "Medical").

### US-LEAVE-031 — Delegate approvals · Must · R1.0 · F-LV-24
**As** a Manager, **I want** to nominate a delegate for a date range, **so that** approvals continue while I am away.
- **Given** a delegate set for 01/06–10/06 (scope Both), **when** a reportee submits leave on 03/06, **then** the delegate receives N-01 and can approve; the original manager can also act.
- **Given** the delegate is the applicant, **when** the item routes, **then** it skips to the next level.

### US-LEAVE-032 — Re-route when the approver is away or changes · Must · R1.0 · BR-LV-61
**As** the system, **I want** pending items re-routed when an approver is on leave without a delegate or leaves the company, **so that** nothing gets stuck.
- **Given** the manager is on approved leave with no delegate, **when** a reportee submits, **then** the item routes to the manager's manager (or HR if none) and the trail shows "Re-routed: approver on leave".
- **Given** a manager is separated with pending items, **when** their status becomes Separated, **then** items re-route and HR receives N-49 for reportees without a manager.

### US-LEAVE-033 — Remind and escalate · Should · R1.0 · F-LV-25
**As** an Admin, **I want** reminders and escalation for stale approvals, **so that** employees get timely answers.
- **Given** an item pending 2 working days, **when** the daily job runs, **then** the approver receives a digest email (N-15).
- **Given** an item pending 5 working days, **when** the job runs, **then** the approver's manager and HR receive N-16; nothing is auto-approved.

### US-LEAVE-034 — Verify medical certificates · Should · R1.0 · F-LV-26
**As** an Admin, **I want** to mark MCs verified or invalid, **so that** sick leave is supported by valid documents.
- **Given** HR marks an MC Invalid, **when** saved, **then** the employee receives N-14 asking to resubmit or convert the leave.

### US-LEAVE-035 — Compute the leaver's final leave position · Must · R1.0 · F-LV-27
**As** an Admin, **I want** the leaver's balance recalculated to the last working day, **so that** final pay is correct.
- **Given** a leaver with LWD 30/06/2027, 12 days AL, 8 days taken, **when** the separation is saved, **then** entitlement recalculates to 6.0 and the final position shows −2.0 days (recoverable), also in the payroll-input pack.

### US-LEAVE-036 — Override one employee's entitlement · Should · R1.0 · F-LV-31
**As** an Admin, **I want** a per-employee entitlement override with reason, **so that** contractual terms are honoured.
- **Given** HR sets AL 2027 = 18 for one employee with a reason, **when** saved, **then** that employee's entitlement is 18 regardless of band, and the override is audited.

### US-LEAVE-037 — Define custom approval workflows · Should · R1.0 · F-LV-32
**As** an Admin, **I want** to define workflows of up to 3 levels and assign them per type, **so that** special types follow special routes.
- **Given** a workflow "Direct manager → Super Admin" assigned to Unpaid Leave, **when** an employee applies for unpaid leave, **then** level 2 routes to the SA.

### US-LEAVE-038 — Apply against next year's balance · Could · R1.0 · F-LV-33
**As** an Employee, **I want** to book January leave in December, **so that** I can plan holidays early.
- **Given** the setting allows next-year applications from 01/11, **when** I apply on 15/11/2027 for 05/01/2028, **then** it is validated against the projected 2028 entitlement.

### US-LEAVE-039 — Show a message on the apply form · Could · R1.0 · F-LV-34
**As** an Admin, **I want** a custom message on the apply form, **so that** employees see policy reminders.
- **Given** a message is saved, **when** an employee opens the apply form, **then** the message is shown at the top.

### US-LEAVE-040 — Enter opening balances for a mid-year employee · Should · R1.0 · F-LV-35
**As** an Admin, **I want** to enter leave already taken and carry-forward when adding an employee mid-year, **so that** their balance is right from day one.
- **Given** HR enters AL taken 4.0 and CF remaining 2.0 on creation, **when** saved, **then** the ledger shows "Opening balance" entries and Available reflects them.

### US-LEAVE-041 — Recount leave when holidays change · Must · R1.0 · BR-LV-27
**As** an Employee, **I want** my leave recounted if a holiday is declared on my leave day, **so that** I don't lose a day.
- **Given** approved AL on 12/05/2027 and HR adds a special declared holiday on that date, **when** saved, **then** the application recounts to 0 days for that date, 1 day is restored, and the employee receives N-06.

### US-LEAVE-042 — Warn about team absence · Could · R1.0 · F-LV-29
**As** a Manager, **I want** a warning when too many team members are off at once, **so that** coverage is maintained.
- **Given** threshold 2 and two reportees already on leave on a date, **when** I open a third application for that date, **then** a warning is shown on the approval screen.

### US-LEAVE-043 — Seed statutory entitlements and correct current-year balances · Must · R1.0 · F-LV-01, F-LV-02, F-LV-18, F-MIG-06 (D13)
**As** a Super Admin, **I want** PRET to start with leave entitlements corrected to the Employment Act and existing employees' current-year balances corrected at migration, **so that** Interact closes the four Kakitangan gaps from go-live *(D13)*.
- **Given** a new installation, **when** an Admin opens leave types, **then** Sick Leave has bands 14 / 18 / 22 days (< 2, 2–< 5, ≥ 5 years' service), Hospitalisation Leave is active with a 60-day pool shared with Sick Leave, Maternity Leave is 98 consecutive days, Paternity Leave is active with 7 consecutive days (married male, ≥ 12 months' service, max 5 occurrences), and Annual Leave has bands 12 / 12 / 16.
- **Given** the Annual Leave < 2 years band, **when** viewed, **then** it shows 12 days (above the statutory 8 — Interact's current term kept) and no below-minimum warning.
- **Given** a migrated employee with 3 years' service whose Kakitangan sick entitlement for the current year was 14, **when** the opening balances are imported, **then** an adjustment of +4.0 days Sick Leave is recorded in the ledger with reason "Statutory correction (D13)" and the employee receives N-10.
- **Given** Marriage Leave and Study/Exam Leave, **when** the installation is seeded, **then** both exist but are inactive *(Q7 sub-question)*.

---

## Epic M3 — Claims management (US-CLAIM)

Claims follow Albert's flow (**D12**): employee submits → **one approval** by the claimant's Manager **or** any Admin **or** any Super Admin → **at month end the Admin pays** the employee — **directly through HLB** (**D16**). Statuses: **New, Submitted, Approved, Disbursed, Rejected, Withdrawn, Cancelled**.

### US-CLAIM-001 — Configure claim categories · Must · R1.0 · F-CLM-01
**As** an Admin, **I want** to configure categories with receipt, e-Invoice, SST, mileage, eligibility, tax treatment and GL account, **so that** claims follow policy.
- **Given** an Admin creates a category with all mandatory fields, **when** saved, **then** it is selectable on new claim lines for eligible employees.
- **Given** mileage-based = Yes without a rate, **when** saved, **then** saving is blocked.
- **Given** no AutoCount GL account, **when** saved, **then** saving is blocked.

### US-CLAIM-002 — Seed Interact's 20 categories · Must · R1.0 · FR-CLM-01
**As** an Admin, **I want** the 20 Kakitangan categories pre-loaded, **so that** employees see familiar categories at go-live.
- **Given** a new installation, **when** an Admin opens categories, **then** the 20 categories in PRD §7.5 exist with Medical Claim – Direct Staff limited to RM 300.00 per transaction and Employee Transport / Employee Travel mileage-based *(Q19)*.

### US-CLAIM-003 — Set limits with overrides · Must · R1.0 · F-CLM-02
**As** an Admin, **I want** per-transaction, monthly and yearly limits with overrides by grade, department, group or employee, **so that** spending follows policy.
- **Given** a category limit RM 300 per transaction and an employee-specific limit RM 500, **when** that employee submits RM 450, **then** it is within limit; another employee's RM 450 is blocked.
- **Given** a monthly limit lower than the per-transaction limit, **when** the Admin saves, **then** saving is blocked.
- **Given** limit usage, **when** it is computed, **then** only Submitted, Approved and Disbursed claims count; New, Rejected, Withdrawn and Cancelled claims do not.

### US-CLAIM-004 — Configure claim settings · Must · R1.0 · F-CLM-03
**As** a Super Admin, **I want** deadline, limit-refresh, month-end cut-off and batch-approval settings, **so that** claims are controlled.
- **Given** defaults, **when** settings open, **then** deadline = 60 days, limit-refresh day = 31, month-end disbursement cut-off = last day of the month, SA approval of disbursement batches = **Off** *(D12, Q21)*.
- **Given** an Admin opens claim settings, **when** viewed, **then** they can change the deadline and cut-off but the "SA approval of disbursement batches" setting is editable by SA only.

### US-CLAIM-005 — Create a multi-line claim (status New) · Must · R1.0 · F-CLM-04
**As** an Employee, **I want** one claim with several expense lines saved before I submit it, **so that** I can collect receipts over a trip or month.
- **Given** a new claim with title and two lines, **when** the Employee clicks SAVE, **then** claim `CL-yyyy-nnnnn` is created with status **New** and the running total shown; it is visible only to the Employee.
- **Given** a line, **when** filled, **then** it captures category, transaction date, amount incl. SST, SST amount, receipt/e-Invoice no., MyInvois UUID, notes and attachments as configured.
- **Given** SST greater than the amount, **when** saved, **then** the line shows an error.
- **Given** a New claim, **when** the Employee edits a line or clicks DELETE and confirms, **then** the change is saved, or the claim is deleted and no longer listed.
- **Given** a claim in any status other than New, **when** the Employee opens it, **then** edit and delete are unavailable.

### US-CLAIM-006 — Claim mileage · Must · R1.0 · F-CLM-05
**As** an Employee, **I want** mileage computed from distance, **so that** I don't calculate it myself.
- **Given** Employee Transport at RM 0.60/km and 42.5 km, **when** the line is entered, **then** amount = RM 25.50 (read-only) and From, To and Purpose are mandatory.
- **Given** the rate changes after submission, **when** the claim is viewed, **then** the original rate is kept.

### US-CLAIM-007 — Attach receipts from the phone camera · Must · R1.0 · F-CLM-06
**As** an Employee, **I want** to photograph a receipt directly into the claim line, **so that** submission is quick.
- **Given** a phone browser, **when** the Employee taps "Add receipt", **then** the camera or gallery can be used and the image appears as a thumbnail.
- **Given** the category requires a receipt and none is attached, **when** submitted, **then** submission is blocked on that line.

### US-CLAIM-008 — Submit with limit and deadline validation · Must · R1.0 · F-CLM-07, F-CLM-08
**As** the system, **I want** every line validated at submission, **so that** only compliant claims proceed.
- **Given** a Medical line of RM 350, **when** submitted, **then** it is blocked: "Exceeds RM 300.00 per transaction".
- **Given** a line dated 75 days ago, **when** submitted, **then** it is blocked: "Older than 60 days — Admin override required".
- **Given** a Warn-type limit is exceeded, **when** submitted, **then** the Employee acknowledges the warning and the approver sees "Over limit by RM x".
- **Given** a valid New claim, **when** submitted, **then** status = **Submitted**, the claimant's Manager (and delegate) receives N-20 by email, and all Admins see it in-app and in their approvals queue.

### US-CLAIM-009 — Block a reused MyInvois UUID · Must · R1.0 · BR-CLM-16
**As** an Admin, **I want** an e-Invoice UUID claimable only once, **so that** the same invoice is not reimbursed twice.
- **Given** UUID X on an approved claim, **when** any employee submits a line with UUID X, **then** submission is blocked naming the existing claim.

### US-CLAIM-010 — Warn about possible duplicate receipts · Should · R1.0 · F-CLM-19
**As** an Admin, **I want** possible duplicates flagged, **so that** I can check them.
- **Given** a line with the same receipt no. and amount as an earlier non-rejected claim, **when** submitted, **then** the claim carries a "Possible duplicate" flag visible to approvers.

### US-CLAIM-011 — Withdraw a submitted claim · Must · R1.0 · F-CLM-08
**As** an Employee, **I want** to withdraw a claim before it is approved, **so that** I can correct it.
- **Given** a Submitted claim, **when** the Employee withdraws, **then** status = **Withdrawn**, it leaves every approvals queue and it no longer counts toward limits.
- **Given** an Approved claim, **when** the Employee looks for Withdraw, **then** it is unavailable.

### US-CLAIM-012 — Approve or reject a claim (single level) · Must · R1.0 · F-CLM-09
**As** the claimant's Manager, an Admin or a Super Admin, **I want** to review a Submitted claim's lines and receipts and approve or reject it once, **so that** only genuine business expenses are paid *(D12)*.
- **Given** a Submitted claim of a reportee, **when** the Manager approves, **then** status = **Approved**, tax treatment and GL account are snapshotted, the approver is recorded, and the employee receives N-22 — no further approval level follows.
- **Given** a Submitted claim, **when** any Admin or any Super Admin approves it instead of the Manager, **then** the result is the same (one approval is enough).
- **Given** the Manager and an Admin open the same Submitted claim and the Admin approves first, **when** the Manager then clicks Approve or Reject, **then** nothing changes and "Already decided by <Admin> at <dd/mm/yyyy HH:mm>" is shown.
- **Given** an approver rejects without a reason, **when** they confirm, **then** the action is blocked; with a reason, status = **Rejected** and the employee receives N-23 with the reason.
- **Given** the approver tries to edit an amount or return the claim for amendment, **when** viewing, **then** amounts are read-only and no "Return" action exists.
- **Given** a Manager who is not the claimant's manager (and not a delegate), **when** they request the claim, **then** access is denied.

### US-CLAIM-013 — ~~Finance verifies~~ · Removed (D12) · F-CLM-10
Removed: there is no second (Finance) approval level; one approval by Manager, Admin or Super Admin is final (US-CLAIM-012).

### US-CLAIM-014 — ~~Amend and resubmit a returned claim~~ · Removed (D12) · F-CLM-11
Removed: there is no "Returned" status; a rejected claim is copied into a new claim (US-CLAIM-029).

### US-CLAIM-015 — Bulk approve or reject claims · Should · R1.0 · F-CLM-25
**As** a Manager or Admin, **I want** to decide several Submitted claims at once, **so that** month-end is faster.
- **Given** 4 selected Submitted claims I may decide, **when** I click APPROVE SELECTED, **then** all 4 become Approved and a result summary is shown.
- **Given** the selection includes my own claim or a claim already decided by someone else, **when** I bulk approve, **then** that claim is skipped and reported.

### US-CLAIM-016 — See my claims and limit utilisation · Must · R1.0 · F-CLM-13, F-CLM-20, F-PRT-07
**As** an Employee, **I want** my claims list and how much of each limit I have used, **so that** I know where I stand.
- **Given** My claims, **when** it opens, **then** it shows Claim no., Title, Lines, Total, Status (New / Submitted / Approved / Disbursed / Rejected / Withdrawn / Cancelled), Submitted, Disbursed on and Payment reference with filters and CSV export.
- **Given** a claim's detail, **when** opened, **then** a status timeline shows who approved, rejected or cancelled it (with reason) and the batch no. and payment reference once Disbursed.
- **Given** Medical has RM 300 per transaction and I claimed RM 120 this month, **when** I view utilisation, **then** used vs limit is shown for the month and year.

### US-CLAIM-017 — Manage all claims with a KPI strip · Must · R1.0 · F-CLM-12
**As** an Admin, **I want** all claims in a line-level or header view with Kakitangan's columns, KPIs and filters, **so that** I can manage and report claims.
- **Given** the claims list, **when** filters are applied, **then** the KPI strip shows Submitted, Approved (not disbursed), Disbursed, Rejected, Total excl. SST, Total SST and Total for the filtered set.
- **Given** line view, **when** it loads, **then** columns include Employee, Date of transaction, Date of application, Category, More info, Amount, SST, Attachments, Receipt/e-Invoice no., UUID, Date of approval/rejection, Approved/rejected by, Status, Batch/payroll run, Disbursed on.
- **Given** a Manager opens the list, **when** it loads, **then** only their reportees' claims are shown.

### US-CLAIM-018 — Download an attachment bundle · Should · R1.0 · F-CLM-26
**As** an Admin, **I want** all receipts for a filter or batch in one zip, **so that** I can file them or give them to auditors.
- **Given** a batch of 6 claims with 10 receipts, **when** the Admin clicks DOWNLOAD ATTACHMENTS, **then** a zip with 10 files named `<claim no.>-<line>-<n>.<ext>` downloads and the download is logged.

### US-CLAIM-019 — Create the month-end disbursement batch · Must · R1.0 · F-CLM-14
**As** an Admin, **I want** to gather the month's Approved claims into one disbursement batch, **so that** I pay employees at month end as Albert decided *(D12, D16)*.
- **Given** Approved claims with approval dates 03/11/2027–30/11/2027 and one approved on 01/12/2027, **when** the Admin creates the November batch with the default cut-off 30/11/2027, **then** all claims approved on or before 30/11/2027 that are not in another open batch are pre-selected and the 01/12/2027 claim is not.
- **Given** the batch, **when** created, **then** it has a single route — HLB Connect First manual transfer — and no option to pay through Kakitangan payroll.
- **Given** the Admin deselects one claim, **when** the batch is saved, **then** that claim stays Approved and is proposed for the next batch.
- **Given** a claim already in an open batch, **when** the Admin creates another batch, **then** it is not selectable.
- **Given** the SA-approval setting is Off (default), **when** the Admin generates outputs, **then** no SA approval is needed; **given** it is On, **when** the Admin submits the batch, **then** status = Pending approval, the SA receives N-26, and an SA who prepared the batch cannot approve it.

### US-CLAIM-020 — Produce the claims payment list for HLB · Must · R1.0 · F-CLM-15
**As** an Admin, **I want** a payment list (report + .xlsx + PDF) to key into HLB Connect First, **so that** reimbursements are paid directly through HLB without a bank interface (D6, D16).
- **Given** a batch, **when** the Admin generates the payment list, **then** it shows the header (company, paying account masked, batch no., month, planned date, count, total, prepared by/at, approved by/at if applicable) and per employee: employee no., beneficiary name, bank, bank code, account no., amount (sum of their claims), reference `CLAIM <batch no.>`, description, email, claim nos., with a totals row equal to the batch total.
- **Given** an employee in the batch has incomplete bank details, **when** the Admin generates the list, **then** generation is blocked listing that employee.
- **Given** the list is downloaded, **when** it downloads, **then** an access-log entry is written.

### US-CLAIM-021 — Mark the batch Disbursed · Must · R1.0 · F-CLM-17
**As** an Admin, **I want** to record the payment date and HLB reference, **so that** claims show as Disbursed and employees are informed.
- **Given** an exported batch, **when** the Admin enters payment date and HLB reference and confirms, **then** batch status = Disbursed, every claim in it = **Disbursed**, and each employee receives N-25 with amount, date and reference.
- **Given** the batch outputs are marked out of date (e.g. a claim was cancelled after export), **when** the Admin tries to mark it Disbursed, **then** the action is blocked until outputs are regenerated.

### US-CLAIM-022 — Undo a disbursement · Should · R1.0 · F-CLM-23
**As** an Admin, **I want** to reverse a disbursement that failed at the bank, **so that** the claim can be paid again.
- **Given** a Disbursed claim, **when** the Admin undoes the disbursement with a reason, **then** the claim returns to Approved, the employee and Admins receive N-28, and the claim is proposed for the next batch.
- **Given** no reason is entered, **when** confirmed, **then** the action is blocked.

### US-CLAIM-023 — ~~Hand over approved claims to Kakitangan payroll~~ · Removed (D16) · F-CLM-22
Removed: all claim reimbursements are paid directly through HLB (US-CLAIM-019–021); there is no Kakitangan payroll handover. From R1.1 claims can be paid with salary in the PRET payroll run (US-PAY-011).

### US-CLAIM-024 — Export claims postings for AutoCount · Must · R1.0 · F-CLM-27
**As** an Admin, **I want** an .xlsx of claims postings in AutoCount's import layout, **so that** claims are recorded in AutoCount without re-keying (D10).
- **Given** a date range or batch, **when** the Admin clicks AUTOCOUNT EXPORT, **then** one row per line is produced with document date, claim no., employee, GL account, description, amount excl. SST, SST, amount incl. SST, department/cost centre, credit account and batch no., in the template column order *(Q37)*.
- **Given** a category without a GL account, **when** export runs, **then** export is blocked listing the category.

### US-CLAIM-025 — Submit a claim on behalf · Should · R1.0 · F-CLM-18
**As** an Admin, **I want** to submit a claim for an employee, **so that** claims are recorded when the employee cannot.
- **Given** an Admin submits on behalf, **when** saved, **then** the claim shows "On behalf by …" and goes to Submitted for the normal single approval — but not by the Admin who entered it.

### US-CLAIM-026 — Override the submission deadline · Should · R1.0 · F-CLM-21
**As** an Admin, **I want** to allow a late line with a reason, **so that** genuine exceptions can be paid.
- **Given** a line older than 60 days, **when** the Admin applies an override with reason, **then** the employee can submit and the claim carries the "Late (override)" flag.

### US-CLAIM-027 — Enter claims in bulk · Could · R1.0 · F-CLM-28
**As** an Admin, **I want** a grid to enter many claims for many employees, **so that** paper claims can be captured quickly.
- **Given** a grid with 5 rows for 3 employees, **when** submitted, **then** 3 claims are created on behalf, each validated as normal.

### US-CLAIM-028 — Nobody approves their own claim · Must · R1.0 · BR-CLM-20, FR-G-16
**As** a Super Admin, **I want** no one to approve, reject or cancel their own claim in any role, **so that** controls hold in a small team.
- **Given** a Manager submits their own claim, **when** it is Submitted, **then** it is actionable by their own manager, any Admin or any SA — and not by the claimant.
- **Given** an Admin submits their own claim, **when** it is Submitted, **then** another Admin, their manager (if any) or an SA can decide it; the claimant's own queue shows it as read-only.
- **Given** the Super Admin (top of organisation) submits a claim, **when** it is Submitted, **then** any Admin (or another SA) can decide it *(Q11)*.

### US-CLAIM-029 — Copy a rejected claim into a new claim · Must · R1.0 · F-CLM-29
**As** an Employee, **I want** to copy a rejected claim, fix it and submit it again, **so that** I don't retype everything *(D12 — no "Returned" status)*.
- **Given** a Rejected claim, **when** the Employee clicks COPY TO NEW CLAIM, **then** a new claim with status New is created with the same title, lines and attachments, shows "Copied from CL-…", and the rejected claim stays Rejected and unchanged.
- **Given** the copied claim has a line older than the submission deadline, **when** submitted, **then** that line is blocked unless an Admin has applied a late override.
- **Given** a claim in any status other than Rejected, **when** the Employee looks for COPY TO NEW CLAIM, **then** it is not offered.

### US-CLAIM-030 — Cancel an approved claim before disbursement · Must · R1.0 · F-CLM-30
**As** the claimant's Manager, an Admin or a Super Admin, **I want** to cancel an Approved claim that should not be paid, **so that** it is excluded from the month-end payment *(D12)*.
- **Given** an Approved claim not yet Disbursed, **when** the Manager cancels it with a reason, **then** status = **Cancelled**, it no longer counts toward limits, and the employee receives N-59 with the reason.
- **Given** no reason is entered, **when** the cancel is confirmed, **then** it is blocked.
- **Given** the claim is in an exported disbursement batch, **when** it is cancelled, **then** it is removed from the batch and the batch outputs are marked out of date.
- **Given** a Disbursed claim, or the user's own claim, **when** they look for CANCEL, **then** it is not available.

---
## Epic M4 — Employee self-service portal (US-PORTAL)

### US-PORTAL-001 — Sign in · Must · R1.0 · F-PRT-01
**As** any user, **I want** to sign in with email and password on the Interact-branded login page, **so that** I reach my portal securely.
- **Given** valid credentials of an active user, **when** they sign in, **then** they land on the home page for their role.
- **Given** a wrong password, **when** submitted, **then** a generic error is shown; after 5 failures the account is locked for 30 minutes (N-52).
- **Given** a privileged user (Admin or Super Admin) with MFA required, **when** they sign in, **then** a second factor is requested before access *(Q31)*.

### US-PORTAL-002 — Reset a forgotten password · Must · R1.0 · F-PRT-01
**As** a user, **I want** to reset my password by email, **so that** I regain access without HR.
- **Given** a registered email, **when** a reset is requested, **then** a reset link is emailed; the response is identical for unknown emails.
- **Given** an expired or used link, **when** opened, **then** "Link invalid or expired" is shown with a way to request a new one.

### US-PORTAL-003 — ~~Acknowledge the privacy notice~~ · Removed (D14) · F-PRT-02
Removed: no privacy-notice acknowledgement or first-login consent workflow. Viewing the optional company privacy notice is covered by US-ADMIN-015.

### US-PORTAL-004 — See my home dashboard · Must · R1.0 · F-PRT-03
**As** an Employee, **I want** a home page with my balances, pending items, upcoming leave, holidays and quick actions, **so that** I see what matters at a glance.
- **Given** an Employee signs in on a phone, **when** home loads, **then** it shows balance tiles, quick actions (Apply leave, New claim, Request replacement credit), pending items, next 3 approved leave, next 3 PHs for my state and recent claims within 3 s on 4G.
- **Given** the user is also a Manager, **when** home loads, **then** a manager panel shows pending approvals count and team on leave today.

### US-PORTAL-005 — Apply for leave on a phone · Must · R1.0 · F-PRT-04
**As** an Employee, **I want** a phone-friendly leave flow, **so that** I can apply in under a minute.
- **Given** a 360 px screen, **when** the Employee applies, **then** the date picker marks PHs and non-working days, the balance preview stays visible above the submit button, and no horizontal scrolling occurs.
- **Given** an MC is needed, **when** the Employee taps attach, **then** the camera can be used.

### US-PORTAL-006 — Submit a claim on a phone · Must · R1.0 · F-PRT-05
**As** an Employee, **I want** a phone-friendly claim flow with camera receipts, **so that** I can claim on the spot.
- **Given** a phone, **when** the Employee adds lines with photos and saves a draft at any step, **then** nothing entered is lost and the claim can be completed later.
- **Given** the network drops on submit, **when** the Employee retries, **then** exactly one claim is submitted.

### US-PORTAL-007 — View my leave applications · Must · R1.0 · F-PRT-06
**As** an Employee, **I want** my applications list and details with the available actions, **so that** I can track and manage them.
- **Given** My leave, **when** opened, **then** each row shows reference, type, dates, days, status chip, emergency flag and decision; Withdraw/Cancel/Request cancellation appear only where allowed by status.

### US-PORTAL-008 — Manage my profile · Must · R1.0 · F-PRT-08
**As** an Employee, **I want** to view my record, edit allowed fields and request other changes, **so that** my data stays accurate.
- **Given** My profile, **when** opened, **then** self-update fields are editable inline and other sensitive fields show "Request change".
- **Given** I view my bank tab, **when** it loads, **then** my account is masked with a "Show" control.

### US-PORTAL-009 — View my documents · Should · R1.0 · F-PRT-09
**As** an Employee, **I want** to view documents HR shares with me, **so that** I can access my contract and letters.
- **Given** HR marked my contract visible, **when** I open My documents, **then** I can view and download it; HR-only documents are not listed.

### US-PORTAL-010 — See my public-holiday calendar · Must · R1.0 · F-PRT-10
**As** an Employee, **I want** the holidays for my state and year, **so that** I can plan leave.
- **Given** a Selangor employee, **when** they open Public holidays, **then** published Selangor holidays and replacement holidays for the year are listed with date, day and name.

### US-PORTAL-011 — Approve from a phone · Must · R1.0 · F-PRT-11
**As** a Manager, **I want** an approvals inbox on my phone, **so that** I can decide quickly wherever I am.
- **Given** pending items, **when** the Manager opens Approvals, **then** counts are shown per type (Leave, Cancellations, Replacement credits, Claims) and each item opens with key details, balance (leave) or receipts (claims).
- **Given** an item, **when** the Manager taps Approve or Reject (with comment), **then** the decision is saved and the next step notified.

### US-PORTAL-012 — See my team · Must · R1.0 · F-PRT-12
**As** a Manager, **I want** my team list with who is on leave and their balances, **so that** I can plan work.
- **Given** My team, **when** opened, **then** it lists direct and indirect reportees with today/this-week leave status and current balances per type.

### US-PORTAL-013 — Use the notification centre · Must · R1.0 · F-PRT-13
**As** a user, **I want** a bell with unread count and a list of notifications, **so that** I don't miss anything.
- **Given** 3 unread notifications, **when** any page loads, **then** the bell shows 3; tapping a notification opens the related item and marks it read; "Mark all read" clears the count.

### US-PORTAL-014 — Manage account settings and delegation · Must · R1.0 · F-PRT-14
**As** a user, **I want** to change my password and, as a manager, set a delegate, **so that** my account and approvals are under control.
- **Given** the current password is entered correctly, **when** a new compliant password is saved, **then** old credentials stop working.
- **Given** a Manager sets a delegate with from/to dates and scope, **when** saved, **then** the delegate receives N-17.

### US-PORTAL-015 — Navigate by role · Must · R1.0 · F-PRT-18
**As** a user, **I want** the left navigation to show only what my roles allow, **so that** the portal stays simple — with access enforced on the server too.
- **Given** an external administrator holding Admin, **when** they sign in, **then** no "My" items appear and Employees, Leave admin, Claims admin, Payroll, Reports and Imports are shown.
- **Given** an Employee types an admin URL, **when** the request is made, **then** access is denied server-side and logged.

### US-PORTAL-016 — Download my data · Should · R1.0 · F-PRT-16
**As** an Employee, **I want** to download my personal data, **so that** I can exercise my PDPA access/portability rights.
- **Given** an Employee requests "Download my data", **when** generated, **then** a file of their profile, family, leave and claims (and payslips from R1.1) is available in-app only and the request is logged.

### US-PORTAL-017 — Install the portal on the home screen · Could · R1.0 · F-PRT-15
**As** an Employee, **I want** to add PRET to my phone's home screen, **so that** it opens like an app.
- **Given** a supported phone browser, **when** the Employee chooses "Add to home screen", **then** an PRET icon launches the portal full-screen.

### US-PORTAL-018 — View payslips, EA forms and YTD · Must · R1.1 · F-PRT-17
**As** an Employee, **I want** my payslips, EA forms and YTD figures in the portal, **so that** I no longer need Kakitangan.
- **Given** a finalised Live run whose publish time has passed, **when** I open My payslips, **then** the month, pay date and a hidden-until-tapped net pay are listed with a PDF download.
- **Given** a Parallel-mode run, **when** I open My payslips, **then** it is not listed.
- **Given** my EA form for 2028 is issued, **when** I open EA forms, **then** I can download it; I cannot open any other employee's payslip or EA form.

---

## Epic M5 — Organisation & company setup (US-ORG)

### US-ORG-001 — Maintain the company profile and statutory employer numbers · Must · R1.0 · F-ORG-01
**As** a Super Admin, **I want** company details, statutory employer numbers, paying HLB account, signatories and AutoCount GL mapping maintained, **so that** outputs carry correct company data.
- **Given** the company profile, **when** an Admin opens it, **then** statutory employer numbers and the paying account are read-only for them; only SA can edit.
- **Given** SA saves the paying account, **when** viewed elsewhere, **then** it is masked except the last 4 digits.

### US-ORG-002 — Maintain departments, positions and grades · Must · R1.0 · F-ORG-02–04
**As** an Admin, **I want** to maintain departments, positions and grades, **so that** employees are organised correctly.
- **Given** seed data, **when** HR opens departments, **then** Management, Development and Administration exist.
- **Given** a department with active employees, **when** HR deactivates it, **then** the action is blocked.
- **Given** a department parent that would create a cycle, **when** saved, **then** saving is blocked.

### US-ORG-003 — Maintain work locations by state · Must · R1.0 · F-ORG-05
**As** an Admin, **I want** work locations with their state, **so that** each employee gets the right holiday calendar.
- **Given** location "HQ – Selangor" with state Selangor, **when** an employee is assigned to it, **then** their PH calendar is Selangor.

### US-ORG-004 — Define working-week patterns · Must · R1.0 · F-ORG-06
**As** an Admin, **I want** working-week patterns with full/half working days, off days and rest days, **so that** leave counting matches actual work days.
- **Given** a pattern with no Rest day, **when** saved, **then** saving is blocked (EA s59).
- **Given** the seed "Standard Mon–Fri", **when** viewed, **then** Mon–Fri = Full working day, Saturday = Off day, Sunday = Rest day *(Q14)*.

### US-ORG-005 — Maintain and publish public-holiday calendars · Must · R1.0 · F-ORG-07
**As** an Admin, **I want** to maintain holidays by year and state and publish the year, **so that** leave counting uses verified holidays.
- **Given** a draft 2028 Selangor calendar missing Malaysia Day, **when** HR publishes, **then** publishing is blocked (compulsory holiday missing).
- **Given** fewer than 11 observed paid holidays, **when** HR publishes, **then** a warning requires acknowledgement.
- **Given** an unpublished calendar, **when** employees view holidays, **then** it is not shown and next-year leave for that year is blocked.

### US-ORG-006 — Generate replacement holidays · Must · R1.0 · F-ORG-08
**As** the system, **I want** replacement holidays created when a holiday falls on a rest day, **so that** employees get their substitute day.
- **Given** an observed holiday on a Sunday (rest day), **when** the calendar is saved, **then** a replacement holiday is created on the next working day that is not a holiday, labelled "(replacement)".
- **Given** a holiday on Saturday (off day) and the off-day replacement setting = No, **when** saved, **then** no replacement is created.

### US-ORG-007 — Add special and company holidays · Must · R1.0 · F-ORG-09
**As** an Admin, **I want** to add special declared or company holidays at short notice, **so that** the calendar stays correct.
- **Given** HR adds a special declared holiday 2 days ahead, **when** saved, **then** affected leave is recounted and affected employees notified.

### US-ORG-008 — Copy the calendar to next year · Should · R1.0 · F-ORG-10
**As** an Admin, **I want** fixed-date holidays copied to next year as a draft, **so that** set-up is faster.
- **Given** 2027 is published, **when** HR copies to 2028, **then** fixed-date holidays are created as Draft and variable-date holidays are listed as "to enter from gazette".

### US-ORG-009 — Reassign reporting lines · Must · R1.0 · F-ORG-11
**As** an Admin, **I want** to reassign all reportees of a manager at once, **so that** changes are quick when a manager leaves.
- **Given** a manager with 3 reportees, **when** HR reassigns them to another manager with an effective date, **then** job-history rows are created and pending approvals re-route.

### US-ORG-010 — Maintain system settings · Must · R1.0 · F-ORG-12
**As** a Super Admin, **I want** to maintain employee-number format, defaults, timeouts, lockout, MFA policy and retention, **so that** the system behaves per policy.
- **Given** SA changes the idle timeout, **when** saved, **then** new sessions use it and the change is audited.
- **Given** an Admin opens system settings, **when** viewed, **then** they are read-only for them.

### US-ORG-011 — Maintain cost centres and employee groups · Could · R1.0 · F-ORG-13, F-ORG-14
**As** an Admin, **I want** cost centres and groups, **so that** exports and limit overrides can use them.
- **Given** a cost centre with an AutoCount code, **when** claims or payroll are exported, **then** the code appears in the department/cost-centre column.

---

## Epic M6 — Users, roles, access & audit (US-ADMIN)

### US-ADMIN-001 — List users · Must · R1.0 · F-ADM-01
**As** a Super Admin, **I want** a list of all users with type, roles, status and last login, **so that** I can manage access.
- **Given** the user list, **when** filtered by user type = External, **then** only external administrators are shown with their service provider and access start/end dates.
- **Given** an Admin opens the list, **when** it loads, **then** only employee users without privileged roles are shown.

### US-ADMIN-002 — Invite an employee user · Must · R1.0 · F-ADM-02
**As** an Admin, **I want** to invite an employee to the portal, **so that** they can self-serve.
- **Given** an employee record with a work email, **when** HR clicks Invite, **then** the user is created as Invited, linked to the employee, granted EMP, and receives N-50; the link expires after 72 h.

### US-ADMIN-003 — Create an external administrator account · Must · R1.0 · F-ADM-04
**As** a Super Admin, **I want** an external (non-employee) administrator account holding Admin with an access window, **so that** the outsourced administrator works under ordinary security controls.
- **Given** SA creates an External user, **when** service provider or access end date is missing, **then** saving is blocked; no data-processing-agreement fields are asked for and nothing blocks go-live on them *(D14)*.
- **Given** an External user, **when** roles are assigned, **then** only Admin is available (not EMP, MGR or SA) and the user cannot be chosen as a manager or delegate.
- **Given** the access end date is reached, **when** the nightly job runs, **then** status = Expired; SA was warned 30 and 7 days before (N-54).

### US-ADMIN-004 — Assign roles · Must · R1.0 · F-ADM-03
**As** a Super Admin, **I want** to grant Admin or Super Admin to a user, **so that** each person gets the access their role needs *(D11)*.
- **Given** the role picker, **when** SA assigns roles, **then** only Admin and Super Admin are offered; Employee is automatic for employee users and Manager is derived from the reporting line.
- **Given** SA assigns Admin, **when** saved, **then** the user and SA receive N-53 and the change is audited.
- **Given** SA tries to remove the last active Super Admin role, **when** saved, **then** it is blocked.
- **Given** a user tries to change their own roles, **when** saving, **then** it is blocked.

### US-ADMIN-005 — Disable, re-enable, unlock and reset users · Must · R1.0 · F-ADM-05
**As** a Super Admin, **I want** to disable, re-enable, unlock and force password reset, **so that** I can respond to access issues.
- **Given** an active user is disabled, **when** saved, **then** their sessions end within 5 minutes and sign-in is refused.
- **Given** a locked user, **when** SA unlocks, **then** they can sign in immediately.

### US-ADMIN-006 — Disable leavers automatically · Must · R1.0 · F-ADM-06
**As** a Super Admin, **I want** leavers' access to end automatically, **so that** ex-employees cannot access HR data.
- **Given** an employee with portal access end date 30/06/2027, **when** 23:59 on 30/06/2027 passes, **then** the user is Disabled.

### US-ADMIN-007 — Require MFA for privileged roles · Should · R1.0 · F-ADM-07
**As** a Super Admin, **I want** MFA mandatory for Admin and Super Admin, **so that** stolen passwords alone cannot expose HR data *(Q31)*.
- **Given** a user is granted a privileged role, **when** they next sign in, **then** they must enrol an authenticator before continuing.

### US-ADMIN-008 — View the role permission reference · Must · R1.0 · F-ADM-08
**As** a Super Admin, **I want** a read-only view of what each role can do, **so that** I can review access.
- **Given** SA opens Roles, **when** loaded, **then** the PRD §16 matrix is displayed.

### US-ADMIN-009 — Record a data-change audit trail · Must · R1.0 · F-ADM-09
**As** a Super Admin, **I want** every create, update and status change recorded with before/after values, **so that** changes are accountable.
- **Given** any field change on any record, **when** saved, **then** an audit entry with time, actor, roles, entity, field before/after and reason (if any) is written.
- **Given** any user (including SA), **when** they look for a way to edit or delete audit entries, **then** none exists.

### US-ADMIN-010 — Log sensitive-data access · Must · R1.0 · F-ADM-10
**As** a Super Admin, **I want** every view, reveal, download and export of sensitive data logged, **so that** I can show PDPA accountability.
- **Given** an Admin opens a sick-leave MC, **when** it displays, **then** an access-log entry with data category Health is written.
- **Given** an External user opens any employee record, **when** it loads, **then** an access-log entry is written even if no sensitive field is shown.

### US-ADMIN-011 — Search the audit and access log · Must · R1.0 · F-ADM-11
**As** a Super Admin, **I want** to filter and export the logs, **so that** I can investigate and review.
- **Given** filters date range, actor and data category, **when** SA searches, **then** matching entries are listed and EXPORT .CSV is itself logged.
- **Given** an Admin, **when** they try to open the log, **then** access is denied.

### US-ADMIN-012 — Review access monthly · Should · R1.0 · F-ADM-12
**As** a Super Admin, **I want** a monthly access review report, **so that** I can confirm who has access and what external users did.
- **Given** the report for a month, **when** generated, **then** it lists users, roles, status, last login and, for External users, counts of records viewed, sensitive accesses and exports, plus flags such as "bank change and payment list export by the same user within 7 days".

### US-ADMIN-013 — Lock accounts and keep login history · Must · R1.0 · F-ADM-13
**As** a Super Admin, **I want** lockout after repeated failures and a login history, **so that** brute-force attempts are stopped and visible.
- **Given** 5 failed attempts, **when** the 6th is tried, **then** the account is locked for 30 minutes and the user and SA receive N-52.

### US-ADMIN-014 — Time out idle sessions · Must · R1.0 · F-ADM-14
**As** a Super Admin, **I want** idle sessions ended, **so that** unattended screens don't expose data.
- **Given** an Admin idle for 15 minutes, **when** they act, **then** they must sign in again; unsaved form data warning is shown before timeout.

### US-ADMIN-015 — Publish an optional company privacy notice · Should · R1.0 · F-ADM-15
**As** an Admin, **I want** to publish Interact's privacy notice (text and/or PDF) in the portal, **so that** employees can read it at any time — the PDPA s7 notice obligation itself rests with Interact outside the system *(D14)*.
- **Given** an Admin enters a title, effective date and body text or a PDF, **when** they publish, **then** every user sees "Privacy notice" in the portal menu and can open it; users receive in-app N-55 (no email, no acknowledgement).
- **Given** a notice is already published, **when** a new one is published, **then** the previous one is kept as view-only history.
- **Given** a user has never opened the notice, **when** they sign in, **then** nothing blocks or redirects them; no acknowledgement is recorded or reported.

### US-ADMIN-016 — Anonymise data past retention · Should · R1.0 · F-ADM-16
**As** a Super Admin, **I want** separated employees past retention listed for approved anonymisation, **so that** data is not kept longer than necessary *(Q29)*.
- **Given** an employee separated more than 7 years ago, **when** SA opens "Due for anonymisation", **then** they are listed; on SA approval identity, contact, family, bank, statutory numbers, documents and attachments are removed while aggregate figures remain.

### US-ADMIN-017 — Prepare for breach notification · Should · R1.0 · F-ADM-17
**As** a Super Admin, **I want** to extract affected employees and data categories for a window or user and log incidents, **so that** I can notify the Commissioner within the deadline.
- **Given** a suspected compromise of user X between two dates, **when** SA runs the extract, **then** affected employees, categories and records accessed/exported are listed and exportable.
- **Given** an incident is logged, **when** saved, **then** detected time, categories, affected count and notification timestamps are recorded.

### US-ADMIN-018 — Log data-subject requests · Should · R1.0 · F-ADM-18
**As** a Super Admin, **I want** access/correction/portability requests logged with a 21-day due date, **so that** responses are on time.
- **Given** a request received 01/03/2027, **when** logged, **then** due date = 22/03/2027 and N-57 fires on 17/03/2027 if still open.

### US-ADMIN-019 — ~~Record consent for sensitive data~~ · Removed (D14) · F-ADM-19
Removed: no first-login consent capture; the lawful basis for health and religion data is Interact's matter as employer.

### US-ADMIN-020 — Employees never see other employees' data · Must · R1.0 · FR-G-02
**As** an Employee, **I want** assurance that colleagues cannot see my record, leave, claims or payslips, **so that** my privacy is protected.
- **Given** Employee A, **when** they request Employee B's profile, leave, claim, document or payslip by any URL or API, **then** access is denied and logged.
- **Given** Employee A views the team calendar, **when** it loads, **then** B's leave type is not shown.

### US-ADMIN-021 — Managers see only their reportees · Must · R1.0 · FR-G-02
**As** an Employee, **I want** only my own managers to see my leave and claims, **so that** access follows the reporting line.
- **Given** Manager M with reportees R1 and R2, **when** M opens team lists, reports or approvals, **then** only R1 and R2 (and their reportees) appear.
- **Given** M opens R1's profile, **when** it loads, **then** MyKad, bank, statutory, family, religion and documents are not shown.

### US-ADMIN-022 — No one approves their own items · Must · R1.0 · FR-G-16
**As** a Super Admin, **I want** self-approval prevented everywhere, **so that** controls hold in any role combination.
- **Given** any user holding any role, **when** they try to approve, reject, cancel, disburse or adjust their own leave, claim, change request, balance, bank details or payroll run, **then** the action is unavailable and the item routes to another approver.

### US-ADMIN-023 — Dates, money and time display consistently · Must · R1.0 · FR-G-03, FR-G-04
**As** a user, **I want** dates as dd/mm/yyyy, money as RM 1,234.56 and times in Malaysia time, **so that** everything is unambiguous.
- **Given** any screen, export or PDF, **when** a date, amount or time is shown, **then** it uses dd/mm/yyyy, RM with 2 decimals and thousands separators, and Asia/Kuala_Lumpur time.

### US-ADMIN-024 — Every list has the standard controls · Must · R1.0 · FR-G-06, F-RPT-24
**As** a user, **I want** search, filters, sorting, pagination and CSV export on every list, **so that** every screen works the same way.
- **Given** any list in the system, **when** it loads, **then** it has keyword search, its specified filters, CLEAR, SEARCH, sortable columns, 10/25/50/100 rows per page and EXPORT .CSV of the filtered set with only columns the user may view.

---

## Epic M7 — Reports & exports (US-REPORT)

### US-REPORT-001 — HR dashboard · Must · R1.0 · F-RPT-01
**As** an Admin, **I want** a dashboard of headcount, who's on leave, pending approvals, probation due, data gaps and PH calendar status, **so that** I know what needs attention.
- **Given** the Admin dashboard, **when** it loads, **then** each KPI card shows its figure and links to the filtered list behind it.
- **Given** the claims panel, **when** it loads, **then** it shows the claims KPI strip, claims awaiting approval, Approved-not-disbursed count and total, and the current month-end batch status (absorbing the former Finance dashboard, D11).

### US-REPORT-002 — Employee master report with column chooser · Must · R1.0 · F-RPT-02
**As** an Admin, **I want** to choose columns from any field I may view, **so that** I can produce ad-hoc employee listings.
- **Given** HR adds MyKad and bank columns, **when** the report runs or exports, **then** an access-log entry is written with the columns included.

### US-REPORT-003 — Headcount report · Must · R1.0 · F-RPT-03
**As** a Super Admin, **I want** headcount as at a date grouped by department, location, grade, status or gender with a monthly trend, **so that** I see how the company is changing.
- **Given** as-at 31/12/2027 grouped by department, **when** run, **then** headcount per department equals the number of employees active on that date.

### US-REPORT-004 — Joiners and leavers · Must · R1.0 · F-RPT-04
**As** an Admin, **I want** joiners and leavers for a period with turnover, **so that** I can report movements.
- **Given** a date range, **when** run, **then** joiners and leavers are listed with separation type and reason category and turnover % is shown.

### US-REPORT-005 — Probation due · Must · R1.0 · F-RPT-05
**As** an Admin or Manager, **I want** probation ending soon or overdue, **so that** confirmations happen on time.
- **Given** window 30 days, **when** run by a Manager, **then** only their reportees are listed.

### US-REPORT-006 — Retirement and service milestones · Should · R1.0 · F-RPT-06
**As** an Admin, **I want** employees approaching 60 and upcoming 2-/5-year service bands, **so that** I can plan.
- **Given** window 6 months, **when** run, **then** each listed employee shows retirement date or next band date and the new AL/SL days.

### US-REPORT-007 — Payroll-readiness completeness · Must · R1.0 · F-RPT-07
**As** an Admin, **I want** a list of missing statutory, PCB and bank fields per employee, **so that** data is complete before R1.1.
- **Given** an employee missing tax no., **when** run, **then** they are listed with "Income tax no." under missing R1.1 fields and their completeness %.

### US-REPORT-008 — Leave balances as at a date · Must · R1.0 · F-RPT-08
**As** an Admin, **I want** balances by department as at any date, **so that** I can answer balance questions and reconcile.
- **Given** as-at 31/03/2027, **when** run, **then** figures equal each employee's ledger totals up to that date, grouped by department with months of service.

### US-REPORT-009 — Leave transactions · Must · R1.0 · F-RPT-09
**As** an Admin, **I want** all applications in a period with status and approvers, **so that** I can audit leave.
- **Given** filters type = Sick and status = Approved, **when** run, **then** only matching applications are listed and exportable.

### US-REPORT-010 — Leave summary by type and department · Should · R1.0 · F-RPT-10
**As** a Super Admin, **I want** days taken by type × department × month, **so that** I see patterns.
- **Given** year 2027, **when** run, **then** a matrix totals days per department per type per month.

### US-REPORT-011 — Who's on leave · Must · R1.0 · F-RPT-11
**As** a Manager or Admin, **I want** who is on leave on a date or range, **so that** I can plan cover.
- **Given** a Manager runs it for tomorrow, **when** run, **then** only their reportees appear with type and session.

### US-REPORT-012 — Unpaid leave · Must · R1.0 · F-RPT-12
**As** an Admin, **I want** unpaid days per employee for a month, **so that** salary deductions are correct.
- **Given** month 11/2027, **when** run, **then** each employee's approved unpaid days in November are listed with dates and references.

### US-REPORT-013 — Sick and hospitalisation utilisation · Should · R1.0 · F-RPT-13
**As** an Admin, **I want** SL/HL utilisation against entitlement and the 60-day pool, **so that** I can monitor absence — with access logged.
- **Given** the report runs, **when** it loads, **then** an access-log entry (Health) is written; Managers cannot run it.

### US-REPORT-014 — Replacement leave report · Should · R1.0 · F-RPT-14
**As** an Admin, **I want** credits earned, used, expiring and expired, **so that** I can manage replacement leave.
- **Given** "expiring within 30 days", **when** run, **then** only unexpired credits with expiry in the next 30 days are listed.

### US-REPORT-015 — Year-end carry-forward and forfeiture · Must · R1.0 · F-RPT-15
**As** an Admin, **I want** each employee's closing, carried, forfeited and expired days, **so that** year-end is transparent.
- **Given** roll-over for 2027 has run, **when** the report runs, **then** totals match the roll-over preview.

### US-REPORT-016 — Claims detail · Must · R1.0 · F-RPT-16
**As** an Admin, **I want** claim lines for a period with all attributes, **so that** I can analyse spend.
- **Given** a transaction date range and category, **when** run, **then** line-level columns as in the claims list are exported.

### US-REPORT-017 — Claims summary and limit utilisation · Should · R1.0 · F-RPT-17
**As** an Admin, **I want** an .xlsx summary by category × department × month, **so that** I can review spend like Kakitangan's Summary Report.
- **Given** a date range, **when** exported, **then** totals excl. SST, SST and total reconcile to the claims detail for the same range.

### US-REPORT-018 — Approved-not-disbursed claims · Must · R1.0 · F-RPT-18
**As** an Admin, **I want** Approved claims not yet Disbursed with ageing, **so that** nothing is forgotten at month end.
- **Given** as-at today, **when** run, **then** every Approved claim is listed with approver, age in days and its batch or payroll run no. if already included; Disbursed, Cancelled and Rejected claims are excluded.

### US-REPORT-019 — Disbursement batches report · Must · R1.0 · F-RPT-19
**As** a Super Admin, **I want** all month-end disbursement batches with totals, status and HLB references, **so that** I can reconcile to the bank.
- **Given** a date range, **when** run, **then** batches are listed with month, approval cut-off, payment date, count, total, status, payment reference, prepared by and approved by (if the SA-approval setting was on).

### US-REPORT-020 — Claims by tax treatment · Should · R1.0 · F-RPT-20
**As** an Admin, **I want** yearly claim totals per employee by tax treatment and EA line, **so that** EA forms are complete.
- **Given** year 2027, **when** run, **then** each employee's totals per tax treatment are shown and match Disbursed claims.

### US-REPORT-021 — Monthly payroll-input pack for Kakitangan · Must · R1.0 · F-RPT-21
**As** an Admin, **I want** one monthly .xlsx with joiners, leavers, job changes, bank changes, statutory-profile changes, unpaid leave and rest-day work paid, **so that** Kakitangan payroll stays correct until R1.1 cut-over *(Q5)*.
- **Given** payroll month 11/2027, **when** generated, **then** each sheet lists the month's changes using Kakitangan employee numbers, and leavers include final leave balance and notice shortfall.
- **Given** the pack, **when** generated, **then** it contains **no claims sheet** — claims are paid directly through HLB *(D16)*.
- **Given** a leave cancelled after the previous pack, **when** the next pack is generated, **then** a reversal line appears.
- **Given** the R1.1 cut-over is signed off, **when** an Admin looks for the pack, **then** it is retired (read-only history only).

### US-REPORT-022 — Manager dashboard · Should · R1.0 · F-RPT-22
**As** a Manager, **I want** pending approvals, team on leave and team probation due, **so that** I can manage my team.
- **Given** the manager dashboard, **when** loaded, **then** figures cover only my reportees.

### US-REPORT-023 — ~~Finance dashboard~~ · Removed (D11) · F-RPT-23
Removed: with one Admin role the claims KPIs are a panel of the Admin dashboard (US-REPORT-001).

### US-REPORT-024 — Export reports to Excel · Should · R1.0 · F-RPT-25
**As** an Admin, **I want** .xlsx export of reports, **so that** I can work with them like Kakitangan's Excel exports.
- **Given** any report, **when** EXPORT .XLSX is clicked, **then** the file contains the filtered data with dates as dd/mm/yyyy and amounts as numbers with 2 decimals.

### US-REPORT-025 — Leave report by individual · Should · R1.0 · F-RPT-27
**As** an Employee, Manager or Admin, **I want** one employee's leave for a year on one page, **so that** it can be printed or discussed.
- **Given** an Employee runs it, **when** run, **then** only their own record is available.

---

## Epic M8 — Notifications (US-NOTIF)

### US-NOTIF-001 — Leave notifications · Must · R1.0 · F-NTF-01
**As** a user, **I want** email and in-app notifications for leave events N-01–N-18, **so that** I know when to act and what happened.
- **Given** each leave event in PRD §12.2, **when** it occurs, **then** the listed recipients receive the in-app notification and, where marked, an email with a deep link.

### US-NOTIF-002 — Claim notifications · Must · R1.0 · F-NTF-01
**As** a user, **I want** notifications for claim events N-20, N-22, N-23, N-25–N-29 and N-59 (N-21 and N-24 removed — D12), **so that** I can follow my claims.
- **Given** a claim is Submitted, **when** saved, **then** the claimant's Manager (and delegate) receives N-20 by email and every Admin sees it in-app.
- **Given** a month-end batch is marked Disbursed, **when** saved, **then** each employee in it receives N-25 with amount, payment date, HLB reference and batch no.
- **Given** an Approved claim is cancelled, **when** saved, **then** the employee receives N-59 with the reason.

### US-NOTIF-003 — Employee and admin notifications · Must · R1.0 · F-NTF-01
**As** a user, **I want** notifications N-40–N-58 for profile, lifecycle, account and privacy events, **so that** changes are visible.
- **Given** a bank account change, **when** saved, **then** N-41 goes to the employee's work and personal email and to SA.

### US-NOTIF-004 — In-app notification centre · Must · R1.0 · F-NTF-02
**As** a user, **I want** all notifications stored in-app with read state, **so that** I have a history even if email fails.
- **Given** an email bounces, **when** the user signs in, **then** the in-app notification is still present.

### US-NOTIF-005 — Daily reminder digest · Should · R1.0 · F-NTF-03
**As** an approver, **I want** one daily email listing items pending 2+ working days, **so that** I'm reminded without spam.
- **Given** 4 items pending ≥ 2 working days, **when** the digest runs, **then** one email lists all 4.

### US-NOTIF-006 — Scheduled HR alerts · Should · R1.0 · F-NTF-04
**As** an Admin, **I want** alerts for probation, retirement, document/passport expiry, carry-forward/credit expiry and external-user access expiry, **so that** deadlines are met.
- **Given** a passport expiring in 30 days, **when** the job runs, **then** HR and the employee receive N-46.

### US-NOTIF-007 — PDPA-safe email content · Must · R1.0 · F-NTF-08
**As** the data controller, **I want** emails never to contain sensitive data, **so that** misdirected email cannot leak it.
- **Given** any email template, **when** rendered, **then** it contains no MyKad, bank account, salary/net pay, diagnosis, religion, family details or attachments; payslip emails say only that a payslip is available.

### US-NOTIF-008 — Notification log · Should · R1.0 · F-NTF-07
**As** an Admin, **I want** a log of sent notifications with delivery status, **so that** I can answer "I never got the email".
- **Given** the log, **when** filtered by recipient and date, **then** each email's event, sent time and delivery status are shown (content summary only).

### US-NOTIF-009 — Opt out of FYI emails · Could · R1.0 · F-NTF-06
**As** a user, **I want** to switch off FYI emails, **so that** I only get emails that need action.
- **Given** FYI emails switched off, **when** an FYI event occurs, **then** only the in-app notification is created; action-required emails still send.

### US-NOTIF-010 — Edit notification templates · Could · R1.0 · F-NTF-05
**As** a Super Admin, **I want** to edit email subjects and bodies, **so that** wording fits Interact.
- **Given** SA edits a template with a sensitive placeholder (e.g. MyKad), **when** saved, **then** saving is blocked.

---

## Epic M9 — Data migration (US-MIG)

### US-MIG-001 — Download import templates · Must · R1.0 · F-MIG-01
**As** an Admin, **I want** templates with a field guide and code lists, **so that** I can prepare Kakitangan data correctly.
- **Given** the Imports page, **when** HR downloads the Employees template, **then** it contains headers for every importable field, a Field guide sheet (mandatory, format, allowed values, synthetic example) and code lists.

### US-MIG-002 — Validate a file without saving (dry run) · Must · R1.0 · F-MIG-10
**As** an Admin, **I want** to validate a file and see row-level errors, **so that** I can fix data before importing.
- **Given** a file with a date in yyyy-mm-dd format, **when** validated, **then** that row reports "Date must be dd/mm/yyyy" and nothing is saved.
- **Given** errors exist, **when** HR downloads the error report, **then** it is the original file plus an Error column.

### US-MIG-003 — Commit an import and keep a log · Must · R1.0 · F-MIG-11
**As** an Admin, **I want** all-or-nothing commits with an import log, **so that** imports are safe and traceable.
- **Given** a file with 0 errors, **when** HR commits, **then** all rows are inserted/updated and the log `IM-yyyy-nnn` shows counts, user and time; with any error, commit is unavailable.
- **Given** the same file is re-imported, **when** committed, **then** records are updated, not duplicated.

### US-MIG-004 — Import organisation masters · Must · R1.0 · F-MIG-02
**As** an Admin, **I want** to import departments, positions, grades, locations and patterns, **so that** employees can reference them.
- **Given** a positions file referencing a department code that doesn't exist, **when** validated, **then** those rows error.

### US-MIG-005 — Import employees · Must · R1.0 · F-MIG-03
**As** an Admin, **I want** to import employees including statutory and bank fields, **so that** records move from Kakitangan in one go.
- **Given** a file where a manager appears later in the same file, **when** validated, **then** two-pass validation resolves the reference; a reporting loop is rejected.
- **Given** imported employees, **when** the import completes, **then** no invites are sent automatically.

### US-MIG-006 — Import family and emergency contacts · Must · R1.0 · F-MIG-04
**As** an Admin, **I want** to import spouses, children (or counts) and emergency contacts, **so that** PCB inputs and contacts are complete.
- **Given** only Kakitangan child counts are available, **when** imported, **then** the derived counts are stored and the employee is flagged "per-child detail missing".

### US-MIG-007 — Import opening leave balances · Must · R1.0 · F-MIG-06
**As** an Admin, **I want** to import balances as at the cut-over date, **so that** employees keep exactly what they had.
- **Given** an opening-balance row (entitlement, taken YTD, carry-forward with expiry, replacement credits with expiry, paternity used), **when** committed, **then** the ledger shows "Opening balance" entries and Available matches the file.
- **Given** a leave type code not configured, **when** validated, **then** the row errors listing valid codes.

### US-MIG-008 — Import job history · Should · R1.0 · F-MIG-05
**As** an Admin, **I want** historical job records imported, **so that** history is preserved.
- **Given** two rows with the same employee and effective date, **when** validated, **then** the duplicate errors.

### US-MIG-009 — Import leave history and future leave · Should · R1.0 · F-MIG-07, F-MIG-09
**As** an Admin, **I want** this year's taken leave and future approved leave imported, **so that** reports and calendars are complete.
- **Given** future approved leave after cut-over, **when** imported, **then** it appears as Approved in calendars and counts as Taken in the year.

### US-MIG-010 — Import public holidays · Should · R1.0 · F-MIG-08
**As** an Admin, **I want** to import holidays, **so that** calendars are set up quickly.
- **Given** a holiday file for 2027 Selangor, **when** committed, **then** the year is created as Draft for HR to publish.

### US-MIG-011 — Invite imported employees in bulk · Must · R1.0 · F-MIG-12
**As** a Super Admin, **I want** to invite selected imported employees at once, **so that** go-live access is simple.
- **Given** 5 selected employees, **when** SA clicks SEND INVITES, **then** 5 invites are sent and statuses show Invited.

### US-MIG-012 — Reconcile and sign off migration · Must · R1.0 · F-MIG-13
**As** a Super Admin, **I want** PRET totals compared with Kakitangan control totals with sign-off, **so that** R1.0 goes live only on matching data.
- **Given** control totals entered, **when** PRET totals differ for any leave type or employee, **then** the differences are listed and sign-off is unavailable; at zero variance SA can sign off with name and time.

### US-MIG-013 — Import claims history and documents · Could · R1.0 · F-MIG-14, F-MIG-15
**As** an Admin, **I want** historical claims and a zip of documents imported, **so that** references are kept.
- **Given** a zip with a manifest, **when** imported, **then** each file attaches to the right employee and category; unmatched files are reported.

### US-MIG-014 — Import compensation · Must · R1.1 · F-MIG-16
**As** an Admin, **I want** basic salaries and recurring pay items imported, **so that** the parallel run starts with Kakitangan's figures.
- **Given** a compensation file, **when** committed, **then** each employee has an effective-dated basic salary and recurring items, visible only to Admin, SA and the employee.

### US-MIG-015 — Import YTD payroll balances · Must · R1.1 · F-MIG-17
**As** an Admin, **I want** YTD figures imported for the cut-over year, **so that** PCB is correct and cut-over can be any month (D5).
- **Given** YTD as at 31/03/2028, **when** committed, **then** the April 2028 PCB calculation uses those YTD amounts.

### US-MIG-016 — Import Kakitangan payroll results · Must · R1.1 · F-MIG-18
**As** an Admin, **I want** each parallel month's Kakitangan results imported per employee per element, **so that** reconciliation is automatic.
- **Given** a Kakitangan result file for April 2028, **when** committed, **then** the reconciliation report for the April parallel run shows Kakitangan values beside PRET values.

### US-MIG-017 — Import TP1, TP3 and CP38 records · Should · R1.1 · F-MIG-19
**As** an Admin, **I want** current declarations and LHDN orders imported, **so that** PCB starts correctly.
- **Given** a CP38 row with start and end months, **when** committed, **then** the deduction applies in runs within those months.

---
## Epic M10 — Payroll (US-PAY)

All payroll acceptance criteria are verified against **golden test cases built from anonymised Kakitangan payslips** (*Q44*) and the official statutory tables in force for the test month; amounts must match **to the sen**. Statutory figures in examples are illustrative — tests use the verified tables.

### US-PAY-001 — Configure payroll settings · Must · R1.1 · F-PAY-01
**As** an Admin, **I want** pay date rule, cut-offs, proration, daily-rate, overtime, rounding and payslip options, **so that** the payroll matches Interact's practice.
- **Given** settings, **when** opened the first time, **then** defaults are those in PRD §14.2 (pay on last working day, proration by calendar days, daily rate ÷ 26, no net rounding) *(Q38, Q42)*.
- **Given** a setting is changed while a run is In Review, **when** saved, **then** the run is flagged "Settings changed — recalculate" and cannot be submitted until recalculated.

### US-PAY-002 — Maintain pay groups · Must · R1.1 · F-PAY-02
**As** an Admin, **I want** pay groups, **so that** runs include the right employees.
- **Given** the seed group "MONTHLY – All staff", **when** a new employee is created, **then** they default into it.

### US-PAY-003 — Maintain the pay item master · Must · R1.1 · F-PAY-03
**As** an Admin, **I want** earnings, deductions and contributions with PCB, EPF, SOCSO, EIS and HRDF flags, EA line and AutoCount GL accounts, **so that** each item is treated correctly everywhere.
- **Given** a new earning without an EA form line or GL account, **when** saved, **then** saving is blocked.
- **Given** a system statutory item, **when** the Admin edits it, **then** only label and GL accounts are editable.
- **Given** an item used in an open run, **when** the Admin deactivates it, **then** the action is blocked.

### US-PAY-004 — Maintain employee compensation · Must · R1.1 · F-PAY-04, F-EMP-17
**As** an Admin, **I want** effective-dated basic salary and recurring items per employee, **so that** pay changes are recorded with history.
- **Given** an increment effective 01/04/2028 with reason Increment, **when** saved, **then** the history shows both rows and the April run uses the new salary.
- **Given** basic below the minimum-wage table value, **when** saved, **then** a warning is shown.
- **Given** a Manager opens a reportee's profile, **when** it loads, **then** the Compensation tab is not visible.
- **Given** an Admin who is also an employee opens their own Compensation tab, **when** they try to edit, **then** editing is unavailable (another Admin or SA must make the change).

### US-PAY-005 — Maintain statutory tables with maker-checker · Must · R1.1 · F-PAY-05
**As** a Super Admin, **I want** every statutory table version entered with its source and verified by a second person, **so that** no unverified rate is ever used.
- **Given** the Admin enters the new year's PCB table with source reference, **when** saved, **then** status = Draft and runs for that year are blocked ("PCB table not verified").
- **Given** SA (not the person who entered it) verifies, **when** saved, **then** status = Verified and runs can use it; the previous version becomes Superseded for later periods.
- **Given** the enterer tries to verify their own table, **when** they click Verify, **then** it is blocked.

### US-PAY-006 — Create a payroll run · Must · R1.1 · F-PAY-06
**As** an Admin, **I want** to create the month's run in Parallel or Live mode, **so that** I can process payroll.
- **Given** period 04/2028 and pay group MONTHLY, **when** the Admin creates a Regular run, **then** run `PR-2028-04-01` is created in Draft with all eligible employees snapshotted, and pay date from the rule.
- **Given** a Regular run already exists for that period and group, **when** the Admin creates another Regular run, **then** it is blocked.
- **Given** cut-over has not been signed off, **when** the Admin creates a run, **then** only Parallel mode is available.

### US-PAY-007 — Enter variable inputs · Must · R1.1 · F-PAY-07
**As** an Admin, **I want** to enter one-off allowances, commission, bonus, arrears and deductions by grid or .xlsx import, **so that** monthly changes are captured.
- **Given** an .xlsx with employee no., pay item code, quantity, rate, amount and remarks, **when** imported, **then** rows validate (unknown employee or item = error) and valid rows appear as inputs with source "Variable input".
- **Given** inputs change, **when** the run is In Review, **then** it returns to Draft until recalculated.

### US-PAY-008 — Calculate overtime · Should · R1.1 · F-PAY-08
**As** an Admin, **I want** overtime from hours × multiplier × hourly rate, **so that** eligible employees are paid correctly *(Q43)*.
- **Given** an eligible employee with 4 hours on a normal day at multiplier 1.5, **when** calculated, **then** amount = 4 × 1.5 × hourly rate (daily rate ÷ hours per day), rounded half-up to 2 dp.
- **Given** an ineligible employee, **when** overtime hours are entered, **then** a warning is shown.

### US-PAY-009 — Deduct unpaid leave from the leave module · Must · R1.1 · F-PAY-09
**As** an Admin, **I want** approved unpaid leave pulled automatically, **so that** deductions match leave records.
- **Given** 2.5 approved unpaid days in April and daily rate basis ÷ 26, **when** calculated, **then** deduction = 2.5 × basic ÷ 26 with source "Leave LV-…".
- **Given** unpaid leave for March is cancelled after March was finalised, **when** April is calculated, **then** a refund adjustment line referencing the March dates is added.

### US-PAY-010 — Prorate joiners and leavers · Must · R1.1 · F-PAY-10
**As** an Admin, **I want** basic and prorate-flagged items prorated for part months, **so that** joiners and leavers are paid correctly.
- **Given** a joiner on 18/04/2028 with proration by calendar days, **when** calculated, **then** basic × 13/30 is paid and EPF/SOCSO/EIS use the prorated wages.

### US-PAY-011 — Pay approved claims with salary in the payroll run · Must · R1.1 · F-PAY-11
**As** an Admin, **I want** Approved claims of employees in the run included as reimbursements, **so that** claims are paid with salary through the run's HLB salary payment list *(D12, D16)*.
- **Given** Approved claims (not in an open disbursement batch) approved before the cut-off, **when** the run is calculated, **then** non-taxable categories appear as "Claims Reimbursement" (no EPF/SOCSO/EIS/PCB) and taxable categories as "Taxable Claim Allowance", and the claims stay Approved showing the run no.
- **Given** the run is finalised, **when** complete, **then** those claims = **Disbursed** with the run no. as reference and the employee receives N-25; they were paid through the run's HLB salary payment list (US-PAY-028).
- **Given** the run is Parallel, **when** calculated, **then** claim statuses do not change.

### US-PAY-012 — Calculate EPF · Must · R1.1 · F-PAY-12
**As** an Admin, **I want** EPF employee and employer shares from the verified table including elected and extra rates, **so that** contributions are correct.
- **Given** an employee under 60 with EPF wages in a table band, **when** calculated, **then** employee and employer shares equal the table amounts for that band and category.
- **Given** an extra employee EPF % of 2, **when** calculated, **then** the extra amount is added to the employee share per the rounding rule in the table.
- **Given** "EPF borne by employer" = Yes, **when** calculated, **then** the employee deduction is 0 and the employer pays both shares.

### US-PAY-013 — Calculate SOCSO and SKBBK · Must · R1.1 · F-PAY-13
**As** an Admin, **I want** SOCSO by category and wage band (and SKBBK where flagged), **so that** PERKESO contributions are correct.
- **Given** a Category 1 employee, **when** calculated, **then** employee and employer amounts equal the band row for their SOCSO wages up to the ceiling.
- **Given** SKBBK flagged but the SKBBK table not verified, **when** calculated, **then** a blocking exception is raised *(Q40)*.

### US-PAY-014 — Calculate EIS · Must · R1.1 · F-PAY-14
**As** an Admin, **I want** EIS by wage band with exemptions, **so that** EIS is correct.
- **Given** an employee with EIS status Exempt, **when** calculated, **then** EIS = 0 for both shares.

### US-PAY-015 — Calculate PCB on normal remuneration · Must · R1.1 · F-PAY-15
**As** an Admin, **I want** PCB computed by the LHDN computerised method using master-data reliefs and YTD, **so that** monthly tax deductions are correct.
- **Given** each golden test employee (single; married spouse not working with 2 children; married spouse working; OKU), **when** calculated, **then** PCB equals the expected value from the LHDN specification/calculator to the sen.
- **Given** the employee's children change mid-year via an approved CR, **when** the next month is calculated, **then** the new relief count is applied.

### US-PAY-016 — Calculate PCB on additional remuneration · Must · R1.1 · F-PAY-15, F-PAY-26
**As** an Admin, **I want** bonus, commission and arrears taxed by the additional-remuneration formula, **so that** PCB on irregular pay is correct.
- **Given** a bonus in a Regular or Off-cycle run, **when** calculated, **then** PCB on the additional remuneration is shown separately and equals the expected golden value.

### US-PAY-017 — Record TP1 and TP3 · Must · R1.1 · F-PAY-16
**As** an Admin, **I want** TP1 and TP3 declarations recorded, **so that** PCB reflects reliefs and previous employment.
- **Given** a mid-year joiner without TP3, **when** their first run is calculated, **then** a warning "TP3 not recorded" is raised.
- **Given** a TP1 relief for May, **when** May is calculated, **then** the relief reduces PCB for May only.
- **Given** the employee submits a TP1 in the portal (Should), **when** submitted, **then** the Admin receives N-36 to verify it.

### US-PAY-018 — Deduct CP38 · Must · R1.1 · F-PAY-17
**As** an Admin, **I want** LHDN CP38 orders deducted for their months, **so that** Interact complies with LHDN instructions.
- **Given** a CP38 of RM 200 for 05/2028–10/2028, **when** each run in that period is calculated, **then** RM 200 is deducted separately from PCB; in 11/2028 it stops automatically.

### US-PAY-019 — Deduct zakat and offset PCB · Must · R1.1 · F-PAY-18
**As** an Admin, **I want** zakat deducted and offset against PCB, **so that** Muslim employees' zakat and tax are correct.
- **Given** zakat RM 100 and computed PCB RM 250, **when** calculated, **then** zakat = RM 100 and PCB payable = RM 150.
- **Given** zakat RM 300 and computed PCB RM 250, **when** calculated, **then** zakat = RM 300 and PCB payable = RM 0.

### US-PAY-020 — Compute HRDF levy · Must · R1.1 · F-PAY-19
**As** an Admin, **I want** the HRDF levy computed on HRDF wages, **so that** the levy report is ready.
- **Given** the company is not HRDF-registered, **when** calculated, **then** levy = 0 for all and the HRDF report is empty *(Q2)*.
- **Given** registered at 1%, **when** calculated, **then** levy = 1% of HRDF wages as employer cost only.

### US-PAY-021 — Deduct PTPTN and other deductions · Must · R1.1 · F-PAY-20, F-PAY-21
**As** an Admin, **I want** PTPTN, ASNB and other deductions applied within their dates, **so that** commitments are honoured.
- **Given** PTPTN RM 150 from 01/2028 to 12/2029, **when** April 2028 is calculated, **then** RM 150 is deducted; after 12/2029 it stops.

### US-PAY-022 — Review the run and exceptions · Must · R1.1 · F-PAY-22
**As** an Admin, **I want** totals, per-employee drill-down, exceptions and variance vs last month, **so that** I can check payroll before approval.
- **Given** an employee with net pay below zero, **when** calculated, **then** a blocking exception prevents submission.
- **Given** an employee missing EPF no., **when** calculated, **then** a blocking exception names the field.
- **Given** an employee whose gross varies by more than 10% from last month, **when** calculated, **then** a warning is listed and the variance tab shows the elements that changed.
- **Given** a drill-down, **when** opened, **then** every line shows its source (Compensation, Variable input, Leave, Claims, Final pay, System).

### US-PAY-023 — Approve the run · Must · R1.1 · F-PAY-23
**As** the Super Admin, **I want** to approve or return the reviewed run, **so that** no payroll is paid without my approval.
- **Given** a run Pending Approval, **when** SA approves, **then** status = Approved, the salary payment list is generated and the Admin receives N-31.
- **Given** open warnings, **when** SA approves, **then** a comment is mandatory.
- **Given** SA prepared the run, **when** they try to approve, **then** it is blocked.

### US-PAY-024 — Finalise and lock the run · Must · R1.1 · F-PAY-24
**As** an Admin, **I want** to finalise the approved run, **so that** results are locked and outputs produced.
- **Given** an Approved Live run, **when** the Admin finalises, **then** results lock, YTD updates, payslips are generated (published per setting), statutory reports/files and the AutoCount journal are generated, and claims in the run become Disbursed.
- **Given** a finalised run, **when** anyone tries to edit inputs, **then** editing is unavailable.

### US-PAY-025 — Re-open a finalised run · Must · R1.1 · F-PAY-25
**As** the Super Admin, **I want** to re-open a finalised run with a reason, **so that** errors can be corrected with a full audit trail.
- **Given** a finalised run, **when** SA re-opens without a reason, **then** it is blocked; with a reason, the run returns to Draft, version +1, YTD contribution is reversed, previous outputs are marked Superseded, and the Admins and SA receive N-33.
- **Given** the payment list or statutory files had been downloaded, **when** re-opened, **then** a warning lists them for manual correction.
- **Given** the run is re-finalised, **when** employees open payslips, **then** they show "Revised <date>".

### US-PAY-026 — Run off-cycle bonus or correction payrolls · Should · R1.1 · F-PAY-26
**As** an Admin, **I want** off-cycle runs in a period, **so that** bonuses or corrections can be paid separately.
- **Given** an Off-cycle run for a December bonus, **when** calculated, **then** PCB uses the additional-remuneration method with YTD including the December Regular run if finalised.

### US-PAY-027 — Generate and publish payslips · Must · R1.1 · F-PAY-27
**As** an Employee, **I want** a clear PDF payslip in the portal, **so that** I understand my pay.
- **Given** a finalised Live run, **when** the publish time arrives, **then** each employee's payslip (PRD §14.10 content) is published and N-32 is sent without amounts.
- **Given** the Admin downloads all payslips as a zip, **when** downloaded, **then** the download is access-logged.
- **Given** a Parallel run, **when** finalised, **then** payslips are watermarked "PARALLEL" and not published.

### US-PAY-028 — Produce the salary payment list for HLB · Must · R1.1 · F-PAY-28
**As** an Admin, **I want** a salary payment list (report + .xlsx) to key into HLB Connect First, **so that** salaries — including claims reimbursed in the run — are paid directly through HLB without a bank interface (D6, D16, *Q46*).
- **Given** an Approved run, **when** the list is generated, **then** it shows the header (company, paying account masked, run no., pay date, count, total net) and per employee: employee no., beneficiary name, bank, bank code, account no., net pay, reference `SALARY <MMM yyyy>`, description and email.
- **Given** the list total differs from the run's net total, **when** generated, **then** generation is blocked.
- **Given** an employee paid by cheque, **when** the list is generated, **then** they are excluded and listed separately.
- **Given** payment is made, **when** the Admin records the HLB reference and date, **then** the run shows the payment date and reference.

### US-PAY-029 — Generate Borang EA · Must · R1.1 · F-PAY-29
**As** an Employee, **I want** my EA form for the year in the portal, **so that** I can file my tax return.
- **Given** the year's runs are finalised, **when** the Admin generates EA forms, **then** each employee paid in the year (including leavers) gets an EA form in the LHDN layout with totals equal to the year's finalised payroll and claims tax treatments.
- **Given** the Admin issues the forms, **when** issued, **then** employees receive N-34 and can download their own.
- **Given** a correction after issue, **when** re-issued, **then** the previous version is kept and marked superseded.

### US-PAY-030 — Produce Form E data · Must · R1.1 · F-PAY-30
**As** an Admin, **I want** Form E (C.P.8D) data for the year, **so that** the employer return can be filed.
- **Given** year 2028, **when** generated, **then** every employee paid in 2028 is listed with remuneration and PCB totals equal to their EA forms *(Q41)*.

### US-PAY-031 — Produce KWSP contribution report and file · Must · R1.1 · F-PAY-31
**As** an Admin, **I want** the monthly EPF listing and upload file, **so that** contributions are submitted on time.
- **Given** a finalised run, **when** generated, **then** the report lists EPF no., MyKad, name, wages, employee and employer shares with totals equal to the run's EPF totals.
- **Given** the KWSP file spec is confirmed *(Q41)*, **when** the file is generated, **then** it passes KWSP's validation in the parallel run.

### US-PAY-032 — Produce PERKESO (SOCSO + EIS) report and file · Must · R1.1 · F-PAY-32
**As** an Admin, **I want** the monthly SOCSO + EIS listing and upload file, **so that** PERKESO contributions are submitted.
- **Given** a finalised run, **when** generated, **then** totals equal the run's SOCSO and EIS totals and joiners/leavers carry their dates.

### US-PAY-033 — Produce LHDN e-PCB / CP39 report and file · Must · R1.1 · F-PAY-33
**As** an Admin, **I want** the monthly PCB listing and e-PCB file, **so that** PCB is remitted.
- **Given** a finalised run, **when** generated, **then** each employee's tax no., MyKad, PCB and CP38 are listed and totals equal the run totals.

### US-PAY-034 — Produce the HRDF levy report · Must · R1.1 · F-PAY-34
**As** an Admin, **I want** a monthly levy listing, **so that** HRDF obligations are documented.
- **Given** a finalised run with levy, **when** generated, **then** employees, HRDF wages and levy totals are listed.

### US-PAY-035 — Produce zakat and PTPTN listings · Must · R1.1 · F-PAY-35
**As** an Admin, **I want** remittance listings per zakat body and for PTPTN, **so that** deductions are remitted.
- **Given** employees paying zakat to the Selangor body, **when** generated, **then** a listing for that body shows employee, MyKad, zakat account no. and amount.

### US-PAY-036 — Produce CP22 / CP22A data · Should · R1.1 · F-PAY-36
**As** an Admin, **I want** joiner and leaver particulars for LHDN, **so that** e-CP22/e-CP22A can be submitted.
- **Given** a joiner in April, **when** the CP22 report is run, **then** the joiner's particulars required by LHDN are listed.

### US-PAY-037 — Use payroll reports · Must · R1.1 · F-PAY-37, F-RPT-26
**As** a Super Admin, **I want** payroll register, department and cost-centre summaries, variance vs last month, employer cost, YTD and statutory summaries, **so that** I understand payroll cost.
- **Given** a finalised run, **when** the summary by department is run, **then** department totals add up to the run totals.
- **Given** the variance report, **when** run for April vs March, **then** each employee-element difference is shown and those over 10% are highlighted.

### US-PAY-038 — Export the AutoCount payroll journal · Must · R1.1 · F-PAY-38
**As** an Admin, **I want** a balanced .xlsx journal per run in AutoCount's import layout, **so that** payroll is booked without re-keying (D10, *Q37*).
- **Given** a finalised run, **when** exported, **then** debit and credit totals are equal and lines are grouped by GL account and department/cost centre.
- **Given** any pay item without a GL account, **when** exported, **then** export is blocked listing the items.

### US-PAY-039 — Reconcile the parallel run and sign off cut-over · Must · R1.1 · F-PAY-39
**As** the Super Admin, **I want** PRET results compared with Kakitangan per employee per element to the sen, **so that** cut-over happens only when payroll is proven (D5).
- **Given** a Parallel run and the imported Kakitangan results for that month, **when** the reconciliation report is run, **then** each employee-element shows Kakitangan, PRET, difference and status, and any non-zero difference requires an explanation.
- **Given** fewer than 2 consecutive zero-variance months, **when** SA tries to sign off cut-over, **then** sign-off is unavailable.
- **Given** 2–3 consecutive months with zero variance on every element, statutory listing and payment list, **when** SA signs off, **then** subsequent runs are Live and the Kakitangan payroll-input pack (US-REPORT-021) is retired.

### US-PAY-040 — Compute final pay for leavers · Must · R1.1 · F-PAY-40
**As** an Admin, **I want** encashment, recovery and notice pay computed from the leave and separation data, **so that** final pay is correct.
- **Given** a leaver with +3.0 encashable AL days, **when** calculated, **then** an encashment line = 3 × daily rate is added.
- **Given** a leaver with −2.0 days and a 5-day notice shortfall not waived, **when** calculated, **then** recovery and notice-in-lieu deductions appear; if net < 0 a blocking exception is raised for the Admin to resolve with a reason.

### US-PAY-041 — Audit every payroll action · Must · R1.1 · F-PAY-41
**As** a Super Admin, **I want** every payroll input, calculation, approval, finalise, re-open and export logged, **so that** payroll is fully accountable.
- **Given** any payroll action, **when** performed, **then** an audit entry with actor, time, run, before/after (inputs) and reason (re-open) is written.

### US-PAY-042 — View my YTD statement · Should · R1.1 · F-PAY-42
**As** an Employee, **I want** my year-to-date gross, EPF, SOCSO, EIS, PCB and zakat, **so that** I can track my tax position.
- **Given** finalised Live runs this year, **when** I open YTD, **then** the totals equal the sum of my payslips plus any imported opening YTD.

### US-PAY-043 — Restrict payroll data to Admin, Super Admin and the employee · Must · R1.1 · FR-PAY-11
**As** an Employee, **I want** my salary visible only to the Admin, the director and me, **so that** pay stays confidential.
- **Given** an Employee or Manager without the Admin or Super Admin role, **when** they request any other employee's compensation, payroll run, payslip or payroll report, **then** access is denied and logged.
- **Given** a Manager, **when** they open a reportee's profile, **then** no payroll data is shown.

---

## Open Questions for Albert

The full question list with context is in [`PRD.md` §17](PRD.md#17-open-questions-for-albert). This table shows **which stories each question affects** and the **default the acceptance criteria assume**.

| ID | Topic | Stories affected | Default assumed in the ACs |
|----|-------|------------------|----------------------------|
| Q1 | Kakitangan export samples | US-MIG-001–013 | Study = current config; templates accept Kakitangan columns once samples arrive. |
| Q2 | Headcount, locations, HRDF | US-ORG-003, US-PAY-020 | Design for 200; one Selangor location; HRDF off. |
| Q3 | Roles and holders | US-ADMIN-003/004, US-PORTAL-015 | **Answered — D11:** four roles; administrator = External user with Admin; Albert = SA (+ EMP + MGR). |
| Q4 | R1.0 claims payment route | US-CLAIM-019–022 | **Answered — D12/D16:** one approval; month-end disbursement directly through HLB; no Kakitangan route. |
| Q5 | Kakitangan payroll entry method (unpaid leave, HR changes) | US-REPORT-021 | No longer needed for claims (D16). .xlsx pack designed for manual keying. |
| Q6 | Compensation capture timing | US-PAY-004, US-MIG-014 | R1.1 migration. |
| Q7 | Leave entitlements & EA gaps | US-LEAVE-002/003/020/021/043 | **Answered — D13:** statutory seeds; AL 12/12/16; SL 14/18/22; ML 98; PL 7; HL pool 60; current-year correction by adjustment. Open sub-question: Marriage / Study-Exam (default inactive). |
| Q8 | Accrual, rounding, probation, negative | US-LEAVE-004–006 | Accrual pro-rata by day; round up to ½; EA floor; AL in probation; no negative. |
| Q9 | Carry-forward | US-LEAVE-026/027 | Cap 10, expiry 31/03, AL only. |
| Q10 | Leave approval chain | US-LEAVE-014 | Direct Manager → Admin. |
| Q11 | Top-of-chain approvals | US-LEAVE-014, US-CLAIM-028 | Manager level → SA; SA's own leave auto-approved at manager level; SA claims approved by any Admin. |
| Q12 | Delegation/escalation | US-LEAVE-031–033 | Delegate; re-route to manager's manager/HR; reminder 2, escalate 5 working days. |
| Q13 | Back-dating & emergency | US-LEAVE-019/024 | SL back-date 3 working days; emergency < 3 days. |
| Q14 | Working week & replacement holidays | US-ORG-004/006 | Mon–Fri; Sat off; Sun rest; no Saturday replacement. |
| Q15 | Holidays observed | US-ORG-005 | All gazetted holidays of the work state. |
| Q16 | Replacement leave | US-LEAVE-022/023 | 1/0.5 day; manager approval; 90-day validity; carry forward. |
| Q17 | Calendar privacy | US-LEAVE-030 | Everyone sees "On leave" without type. |
| Q18 | MC visibility | US-LEAVE-019 | Approving manager may view MC for the item being approved (logged); no consent capture (D14). |
| Q19 | Claim categories, mileage rate, limits | US-CLAIM-002/003/006 | 20 categories; RM 0.60/km placeholder; Medical RM 300/txn; limits incl. SST. |
| Q20 | Claims chain & segregation | US-CLAIM-012/019/028 | **Answered — D12:** single approval by Manager or Admin or SA; SA batch approval optional, default off; bank details by Admin/SA without confirmation (D15). |
| Q21 | Deadline & cut-off | US-CLAIM-008/026 | 60 days; cut-off 31st. |
| Q22 | Foreign currency | US-CLAIM-005 | MYR only. |
| Q23 | Medical for dependants | US-CLAIM-002 | Employee only. |
| Q24 | Claim tax treatment, e-Invoice | US-CLAIM-001, US-PAY-011/029 | §7.5 proposals; e-Invoice/UUID optional. |
| Q25 | Grades | US-ORG-002, US-CLAIM-003 | Import Position Levels; no grade-based limits. |
| Q26 | Self-update scope | US-EMP-006/017 | PRD Q26 split. |
| Q27 | Probation | US-EMP-010 | 3 months, max 12. |
| Q28 | Leavers | US-EMP-011, US-ADMIN-006, US-PAY-040 | Access ends on LWD; encash/recover. |
| Q29 | Retention | US-ADMIN-016 | 7 years. |
| Q30 | PDPA arrangements | US-ADMIN-003/015 | **Answered — D14:** no DPA fields/go-live block, DPO, acknowledgement or consent capture; optional company privacy notice. |
| Q31 | MFA | US-PORTAL-001, US-ADMIN-007 | Mandatory for privileged roles. |
| Q32 | Employee no. format | US-EMP-001 | `INT-nnn`. |
| Q33 | Dates | US-MIG-012, US-PAY-039 | R1.0 on the 1st of a month; 3-month parallel run. |
| Q34 | Kakitangan features outside scope | — (catalogue §1.11) | Later candidates. |
| Q35 | Success targets | — (BRD) | As written. |
| Q36 | Project/customer reference | US-CLAIM-005 | Optional free text. |
| Q37 | AutoCount templates | US-CLAIM-024, US-PAY-038 | Expense at approval; layout from template. |
| Q38 | Pay date & cut-off | US-PAY-001 | Last working day; period-end leave cut-off. |
| Q39 | Payroll approver & SA own pay | US-PAY-004/023 | SA approves; SA pay changes flagged on review. |
| Q40 | SKBBK | US-PAY-013 | Flags captured; calculation after confirmation. |
| Q41 | Statutory file specs | US-PAY-030–033 | Reports from day one; files to official spec. |
| Q42 | Proration/daily rate | US-PAY-009/010/040 | Match Kakitangan; until known calendar days and ÷ 26. |
| Q43 | Overtime/commission/bonus | US-PAY-008/016/026 | OT supported, no policy configured. |
| Q44 | Golden test data | US-PAY-015/016/039 | Anonymised Kakitangan payslips (2–3 months). |
| Q45 | Payslip distribution | US-PAY-027 | Portal only; email notice without amounts. |
| Q46 | Manual HLB keying details | US-CLAIM-020, US-PAY-028 | Admin keys, Albert authorises; MyKad excluded unless HLB requires. |

No new questions were raised by the D11–D14 amendment: the two follow-ups (SA confirmation of Admin bank-detail changes; R1.0 claims payment route) were settled by Albert as **D15** and **D16**.

---

## Coverage summary

| Epic | Must | Should | Could | Total |
|------|------|--------|-------|-------|
| US-EMP | 19 | 5 | 3 | 27 |
| US-LEAVE | 34 | 6 | 3 | 43 |
| US-CLAIM | 20 | 6 | 1 | 27 |
| US-PORTAL | 14 | 2 | 1 | 17 |
| US-ORG | 9 | 1 | 1 | 11 |
| US-ADMIN | 17 | 6 | 0 | 23 |
| US-REPORT | 15 | 9 | 0 | 24 |
| US-NOTIF | 5 | 3 | 2 | 10 |
| US-MIG | 12 | 4 | 1 | 17 |
| US-PAY | 39 | 4 | 0 | 43 |
| **Total (active)** | **184** | **46** | **12** | **242** |

**Amendment D11–D16:** 248 story ids, of which **6 removed** — US-CLAIM-013, US-CLAIM-014 (D12), US-CLAIM-023 (D16), US-PORTAL-003, US-ADMIN-019 (D14), US-REPORT-023 (D11) — and **3 added** — US-LEAVE-043 (D13), US-CLAIM-029, US-CLAIM-030 (D12): 245 − 6 + 3 = **242 active**. US-ADMIN-015 is now Should (optional privacy notice).

By release: **R1.0 = 194 stories**, **R1.1 = 48 stories** (US-PAY ×43, US-PORTAL-018, US-MIG-014–017). **Every active Phase-1 (R1.0/R1.1) function in the PRD Function Catalogue is traced by at least one story** (re-checked by script after the amendment); only the removed functions, the Won't items (F-CLM-16, F-CLM-24, F-LTR-07) and the Later candidates (§1.11) have no active story, by design.

---

## Ready for GATE 1? (self-check)

- [x] Stories grouped by epic for all ten modules with stable ids (US-EMP, US-LEAVE, US-CLAIM, US-PORTAL, US-ORG, US-ADMIN, US-REPORT, US-NOTIF, US-MIG, US-PAY).
- [x] Every story has role, capability, value, MoSCoW, **release tag (R1.0 / R1.1)** and a trace to PRD function ids.
- [x] Every story has testable Given/When/Then acceptance criteria, with worked numeric examples for leave and payroll rules.
- [x] Cross-cutting access-control stories (US-ADMIN-020–024, US-PAY-043) operationalise the Definition of Done (employee isolation, manager scope, sensitive fields, no self-approval).
- [x] Payroll acceptance tied to golden test cases from anonymised Kakitangan data and zero-variance cut-over (D5).
- [x] Open questions mapped to affected stories with the default assumed.
- [x] **D11–D16 applied:** stories use the four roles (Employee, Manager, Admin, Super Admin); claims stories use the D12 statuses (New, Submitted, Approved, Disbursed, Rejected, Withdrawn, Cancelled), single-level approval, copy-a-rejected-claim and cancellation; month-end disbursement only through HLB (D16); bank details by Admin/SA without confirmation (D15); statutory leave seeds (D13); acknowledgement/consent/DPA stories removed (D14).
- [ ] **Albert to confirm or amend the remaining defaults** (Q3, Q4, Q20, Q30 and the main part of Q7 are answered); Q37, Q41, Q42 and Q44 inputs are needed before R1.1 build.

**Verdict:** Stories and acceptance criteria are testable and traceable; ready for GATE 1 review on Albert's decisions D11–D16 and the remaining proposed defaults.
