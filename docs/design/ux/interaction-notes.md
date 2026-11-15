# PRET — Interaction Notes (states, validation, approvals, uploads, previews)

**Work item:** W1-004 · **Author:** UX Designer · **Status:** Draft for GATE 2 (Design)
**Last updated:** 15/11/2026
**Companions:** [`screen-inventory.md`](screen-inventory.md) · [`information-architecture.md`](information-architecture.md) · [`wireframes.md`](wireframes.md) and module files.

> Behaviour rules that apply across screens. Where a wireframe says "per interaction
> notes", this file is the spec. Message texts are the proposed English copy (R2); the
> UI Designer owns their visual treatment. Rule ids from the PRD are cited so QA can
> trace each message to its requirement.

---

## 1. Loading states

| Situation | Behaviour |
|-----------|-----------|
| First load of a list | Table skeleton (5 grey rows) under the real filter card and action bar; filter card is usable immediately |
| Re-query (SEARCH, page, sort) | Keep current rows, show a thin progress bar on the table card; disable `SEARCH` until done |
| Dashboard / home | Each tile loads independently with its own skeleton; a failing tile shows "Couldn't load — [RETRY]" and does not block others |
| Detail page | Header skeleton then body; actions appear only after permissions are known (never flash actions the user can't use) |
| Saving / submitting | Primary button shows spinner + "Saving…"/"Submitting…" and is disabled (FR-G-07); the rest of the form becomes read-only until the response |
| Long jobs (import validation, year-end preview, payroll calculation, attachment zip, data export, EA bulk) | Progress panel "Validating 57 rows…" with elapsed time; user may leave the page — completion arrives as an in-app notification with a deep link (N-56 for imports) |
| Live recalculation (leave days, balance preview, claim totals, limit check) | Value replaced by "…" for ≤ 1 s; if the server check fails, show "Couldn't check balance — [RETRY]" and keep `SUBMIT` disabled |
| Performance targets | Lists/details ≤ 2 s desktop, ≤ 3 s on 4G phone (NFR-02); Home ≤ 3 s on 4G (FR-PRT-03) |

## 2. Empty states

Two kinds, never confused:
- **Nothing exists yet** — friendly line + the create action if the user may create: "No claims yet. [NEW CLAIM]" · "No employees yet. Import from Kakitangan or add one. [IMPORT] [ADD NEW EMPLOYEE]" · "No leave types configured." (ADM: [ADD NEW LEAVE TYPE]).
- **Filters exclude everything** — "No {items} match these filters." + `[CLEAR]`.

Specific empties: Approvals tab "Nothing waiting for you." · Notifications "You're all caught up." · My documents "HR hasn't shared any documents with you." · Payslips (R1.1) "No payslips yet." · Holidays "The {year} calendar has not been published yet." · Team calendar day "No one is on leave." · Reports before `SEARCH` on heavy reports "Choose filters and press SEARCH."

## 3. Error states

| Error | What the user sees | Notes |
|-------|--------------------|-------|
| Field validation | Message under the field, field outlined in error; on submit, focus moves to the first error and a summary card lists all errors with anchors | FR-G-07; data kept |
| Business-rule block (server) | Summary card at the top of the form: title "Can't submit yet" + one line per problem, each linked to the field/line | Specific messages §4 |
| Warning needing acknowledgement | Amber card: message + `[x] I understand` checkbox; `SUBMIT` re-enabled after ticking | e.g. Warn-type claim limit, paternity notice < 30 days, DOB ≠ MyKad |
| Network failure on submit (phone) | Banner "No connection — your entries are kept. [TRY AGAIN]"; retry re-sends the **same** request (idempotency key → Architect) so exactly one record is created | EC-PRT-01, EC-LV-09, US-PORTAL-006 |
| Server error | "Something went wrong. Your changes were not saved. [TRY AGAIN]" + reference code for support; data kept | No stack traces |
| No permission / not found | Full page S-GL-10 "Not found or no access" — identical for both cases; logged | EC-PRT-03, FR-G-02 |
| Concurrency — already decided | Banner on the detail: "Already decided by {name} at dd/mm/yyyy HH:mm." Actions removed; nothing changes | BR-CLM-25, EC-CLM-04; also leave levels |
| Concurrency — record changed while editing | On save: "This record was changed by {name} at HH:mm. [RELOAD] to see the latest (your edits will be shown side by side)." | → Architect (optimistic locking) |
| Concurrency — limit reached by a parallel submission | Normal limit block message on the second submission (re-validated server-side) | EC-CLM-02 |
| Session expired | S-GL-11 re-authenticate dialog; form data kept and restored | F-ADM-14 |
| Account locked | Sign-in message per S-GL-01 | N-52 |
| Out-of-date outputs | Disabled `MARK DISBURSED` with tooltip "Outputs out of date — regenerate first"; warning banner on batch | BR-CLM-26, EC-CLM-10/11 |

## 4. Validation message catalogue

### 4.1 Leave (S-PT-02, S-LV-02)
| Rule | Message |
|------|---------|
| BR-LV-24 | "No working days in the selected dates." |
| BR-LV-50 | "You can't apply for dates after your last working day (dd/mm/yyyy)." / "Leave isn't available for your current status." |
| BR-LV-51 | (type not offered in the list; deep-linked type) "You're not eligible for {type}: {reason — e.g. requires 12 months' service}." |
| BR-LV-52 | "You already have leave on dd/mm/yyyy (LV-…)." (AM + PM halves allowed) |
| BR-LV-53 | "Not enough balance: you have x.x days available to apply; this needs y.y." |
| BR-LV-31 / EC-LV-08 | "Hospitalisation available: 38.0 days (60-day pool less sick leave taken). Consider Annual or Unpaid leave for the rest." |
| BR-LV-30 | "Sick leave for {year} is used up. Apply for Hospitalisation (if hospitalised), Annual or Unpaid leave." |
| BR-LV-54 / US-LEAVE-019 | "This is past the {n}-working-day limit for {type}. Contact HR — they can record it for you." |
| BR-LV-55 | Warn: "{type} needs {n} days' notice." · Block: "{type} must be applied at least {n} days ahead." |
| BR-LV-56 | "Maximum {n} days per application for {type}." / "You've used all {n} {type} occurrences." |
| BR-LV-57 | "Medical certificate required." / "{type} needs a supporting document." |
| BR-LV-58 | "Applications for {year} open on dd/mm/yyyy." / "Holiday calendar for {year} not yet published." |
| LA10 | "Please give a reason." |
| BR-LV-48 (warning) | "Paternity leave should be notified 30 days before the expected confinement. You can still submit." |
| Reject without comment | "Add a comment to reject." |
| Year split (info) | "This will be split into 2 linked applications…" |

### 4.2 Claims (S-PT-13/14, S-CL-02/03)
| Rule | Message |
|------|---------|
| BR-CLM-10 | "Older than {60} days — Admin override required." / "Transaction date can't be in the future." |
| BR-CLM-11 | "Amount must be more than RM 0.00 and at most RM 99,999.99." · "SST can't be more than the amount." |
| BR-CLM-12 | "Line {n}: receipt required." · "Line {n}: notes required for {category}." |
| BR-CLM-13/14 Block | "Line {n}: exceeds RM 300.00 per transaction." / "…exceeds your monthly limit for {category} by RM x (used RM y of RM z)." |
| BR-CLM-13/14 Warn | "Line {n}: over the {category} limit by RM x. Your approver will see this." + I understand |
| BR-CLM-15 | "Distance must be between 0.1 and 2,000 km." · "From, To and Purpose are required for mileage." |
| BR-CLM-16 | "This MyInvois UUID was already claimed on CL-… ." |
| BR-CLM-17 (warning) | "Possible duplicate: same receipt no. and amount on CL-… . Your approver will see this flag." |
| BR-CLM-18 | "{category} isn't available to you." / "Transaction date is after your last working day." |
| Title | "Give the claim a title." |
| Reject / cancel without reason | "Add a reason." |
| Own claim | "You can't decide your own claim." |

### 4.3 Employee records & profile
| Rule | Message |
|------|---------|
| BR-EMP-01/02 | "MyKad must be 12 digits." · "Invalid MyKad date." |
| BR-EMP-03 (warning) | "Place-of-birth code {nn} isn't in the JPN list — check the number." |
| BR-EMP-05 | "This MyKad already exists for INT-… ." [+ REHIRE THIS PERSON if separated] |
| BR-EMP-02/04 override | "Date of birth differs from MyKad." / "Gender differs from MyKad." + confirm |
| BR-EMP-06 | Warn "Employee will be under 18 at join date." · Block "Employee must be at least 15." |
| BR-EMP-07 | "This work email is already used." · "Email domain must be one of: interact.com.my." |
| BR-EMP-08 | "Enter a Malaysian mobile number, e.g. +60 12-345 6789." |
| BR-EMP-09 | "Postcode must be 5 digits." |
| BR-EMP-10 / EC-EMP-03 | "Reporting line would create a loop." · "Choose a reporting manager or tick Top of organisation." |
| BR-EMP-12 | "New probation end must be after dd/mm/yyyy." · "Total probation can't exceed 12 months." |
| BR-EMP-16 | Flag "Spouse details required" (completeness) |
| BR-EMP-17 | "PCB category doesn't match the child's age." |
| BR-EMP-18 | "Account number must be 6–20 digits." · Warn "Holder name differs from the employee's name." |
| C (emergency) | "At least one emergency contact is required." |
| EC-EMP-07 | "You already have an open request for {category} (CR-…)." |
| FR-EMP-12 | "Use a change request for your own record." |
| Zakat H28 | "Amount and account no. are required for zakat." · Warn "Zakat is usually for Muslim employees — check religion." |
| PTPTN H33/34 | "Start and end dates are required for PTPTN deductions." |

### 4.4 Setup, batches, imports, payroll
| Rule | Message |
|------|---------|
| BR-LV-02 | "Below Employment Act minimum (s60E/s60F/s37/s60FA)." — ADM blocked; SA override with reason |
| BR-ORG-10 | "At least one rest day per week is required (EA s59)." |
| BR-ORG-20 | "{state}: compulsory holiday {name} is missing — can't publish." · Warn "{state}: only {n} paid holidays (minimum 11)." |
| EB bands | "Bands must start at 0 years and have no gaps or overlaps." |
| Batch generation | "Bank details incomplete for: {names}." · "No AutoCount GL account for: {category}." |
| Payment list total | "List total RM x doesn't match batch total RM y." (blocking; should never happen — reported) |
| Import | "Row {n}, {column}: {message}" (download error report) |
| Payroll submit | "Resolve {n} blocking exceptions before submitting." |
| Journal | "Journal doesn't balance by RM x." |
| Statutory table | "PCB table {year} not verified." |
| Self-approval (any) | "You can't approve your own {item}." / "You prepared this — another Super Admin must approve." |
| Last SA | "There must always be at least one active Super Admin." |

## 5. Approval interactions

### 5.1 Leave — multi-level (default Direct Manager → Admin)
- Status chip shows the level: **Pending L1** / **Pending L2**; trail lists every level with who is waiting.
- Approve: comment optional → item moves to next level (N-01 to next approver) or **Approved** (N-02). Reject: comment mandatory → **Rejected** (N-03).
- Admin level is a pool: any active ADM (not the applicant) can act; first action wins.
- **Admin override** (BR-LV-62) — separate action `APPROVE AS ADMIN (OVERRIDE)` at levels before Admin, reason mandatory; trail "Admin override by {name}: {reason}" (UXQ-10).
- **Delegation**: delegate sees items in their inbox with chip "Delegated from {approver}"; original approver can still act; delegate's own items skip to the next level (BR-LV-60).
- **Re-routing** (approver on leave without delegate, manager change/separation): trail line "Re-routed: approver on leave" / "Re-routed: manager changed"; new approver notified.
- **Cancellation requests**: shown in the Cancellations tab; approve → Cancelled (days restored), reject → back to Approved (N-07).
- **Bulk**: only items where the user is the current approver are actioned; result table lists ✓ approved / ⤳ moved to L2 / ✕ skipped with reason. One comment for all. Desktop only (FR-PRT-07: not required on phone).
- After any decision on a phone, the inbox opens the next item automatically, with "Back to inbox".

### 5.2 Claims — single level, first decision wins (D12)
- Eligible deciders see the same Submitted claim: claimant's Manager (or delegate), every ADM, every SA — never the claimant.
- Approve → **Approved** immediately (no further level); tax treatment/GL snapshot; N-22. Reject → reason mandatory → **Rejected**; N-23 with reason. **No Return action, no amount editing** (BR-CLM-21).
- If someone decided first, the next actor sees "Already decided by …" and nothing changes.
- **Cancel** (Approved, not Disbursed): Manager (team) / ADM / SA, reason mandatory → **Cancelled**; removed from any open batch; batch outputs marked out of date; N-59.
- **Withdraw** (employee, Submitted only) → **Withdrawn**; leaves every queue at once.
- **Copy** (employee, Rejected only) → new claim **New**, "Copied from CL-…".
- **Undo disbursement** (ADM/SA, Disbursed) → **Approved**, reason mandatory, N-28.

### 5.3 Change requests, credits, batches, payroll
- CR: ADM/SA approve/reject (remarks required on reject); never own; one open CR per category.
- Replacement credits: same pattern as a single-level leave item (default Direct Manager only).
- Disbursement batch SA approval (only when the setting is on): SA ≠ preparer; Return with comment → Draft.
- Payroll run: SA approves/returns (S-PY-11), approver ≠ preparer; open warnings require a comment.

## 6. Forms — saving, leaving, re-trying

- **Unsaved changes guard** on every form: navigating away → "Discard unsaved changes?" `[KEEP EDITING] [DISCARD]`.
- **Single submission**: primary button disabled while saving; server rejects duplicates by idempotency key (→ Architect, NFR-09).
- **Claim drafts**: `SAVE` creates/updates a **New** claim; a line must pass its own field rules to be saved; claim-level rules (limits, deadline, receipts) are checked only on `SUBMIT`. If the network drops mid-entry, the unsent form state is kept on the device for that session and restored on return (US-PORTAL-006).
- **Session timeout** while editing: warning 2 minutes before; after re-authentication the page restores the form values that were on screen.
- **Effective-dated edits** (job changes, marital status, compensation, rates): the effective date is asked in the same dialog; future-dated rows show a **Scheduled** chip.
- **Destructive confirmations** name the object and effect: "Delete CL-2027-00102? This cannot be undone."

## 7. Receipt & attachment upload (claims lines, MC, CR documents, employee documents)

| Aspect | Behaviour |
|--------|-----------|
| Entry points | `📷 TAKE PHOTO` (opens rear camera on phones) and `📎 CHOOSE FILE` (gallery/files); desktop: drag-and-drop zone + choose file |
| Types / size | JPG, JPEG, PNG, HEIC, PDF (+ DOCX for employee documents); ≤ 10 MB each (FR-G-12). Wrong type/size is rejected **before** upload: "Only JPG, PNG, HEIC or PDF up to 10 MB." (EC-EMP-13, EC-PRT-04) |
| Compression | Phone photos compressed on the device before upload where possible (target well under 10 MB); a 12 MB photo is compressed, not rejected, if compression succeeds (EC-PRT-04) — method → Architect |
| HEIC | Accepted; thumbnails and approver viewer show it normally (conversion → Architect, EC-CLM-09) |
| Progress | Per-file progress bar; `✕` cancels; failed upload shows "Upload failed — [RETRY]" without losing other fields |
| Limits | Claim line ≤ 5 files; leave ≤ 3; counter "2 of 5" |
| Thumbnails | Square thumbnails with file name; PDF shows a document icon + page count; tap → full-screen viewer |
| Viewer | Full screen; pinch-zoom/scroll-zoom; rotate; ‹ › between attachments of the claim; `DOWNLOAD` (logged for non-owners) |
| Sensitive files | MC/medical attachments: viewer shows "Viewing is logged" for anyone but the owner (BR-ADM-21); managers only for the item they are approving (Q18) |
| Remove | Owner can remove while the item is editable (New claim, leave form before submit, "Attachment pending" leave) |
| Late MC | If LT18 > 0, leave can be submitted without MC; chip "Attachment pending"; `ADD ATTACHMENT` on the detail; reminder N-14 |

## 8. Leave balance preview (before submit)

- Panel always visible directly above `SUBMIT` on phone and desktop (FR-PRT-04).
- Recalculates on every change of type, dates, sessions; shows **Available now · This application · Pending · Available after** (US-LEAVE-010), with accrual "Earned to date at {end date}" (BR-LV-14) and pool line for Sick/Hospitalisation (BR-LV-31).
- "Available after" below zero → red with the block message (unless the type allows negative, then amber "Will go to −1.0 (allowed up to −2.0)").
- Days explanation expandable: each date with its weight and reason (PH name, rest day, half day).
- Cross-year: preview splits per year (2027 / 2028 rows).
- Type list shows "x.x days available" per type before choosing (Kakitangan parity, US-LEAVE-008).
- On approval screens (S-AP-02) the same panel shows the balance at decision time.

## 9. Sensitive data interactions (PDPA)

- MyKad and bank/ASNB account masked by default (`******-**-5678`, `••••••1234`); `Show` per field per view; re-masked on navigation/refresh; reveal logged; ADM gives a reason (S-EM-10).
- Religion, OKU, medical data shown only to E (own), ADM, SA; managers never (BR-EMP-21) — the field is absent, not blank.
- Team calendar: peers see "On leave" only; managers see "Medical" for sick/maternity/hospitalisation in calendars (Q17).
- Net pay and basic salary hidden until `Show` on employee screens (payslip list, home, compensation).
- Exports: list exports exclude sensitive columns; sensitive reports carry 🔒 "access is logged" before the user exports.
- External administrator sessions: every employee record opened is logged (BR-ADM-22) — a subtle persistent hint "Access is logged" in their shell.
- Emails never contain personal identifiers or amounts beyond claim amounts (F-NTF-08) — the UI copy for notification previews follows the same rule.

## 10. Feedback: toasts, banners, notifications

- **Toast** (bottom, 4 s, dismissible) for successful saves: "Saved." · "Leave submitted — LV-… ." · "Claim approved." Includes `VIEW` where a new record was created.
- **Banner** (persistent on the page) for states the user must act on: out-of-date outputs, parallel mode, pending warnings, unpublished calendar.
- **In-app notification** for asynchronous results and workflow events (catalogue N-01 – N-59); the bell count updates without reload where possible.
- Never use a toast for errors that block — errors stay on the page until fixed.

## 11. Lists — behaviour details

- Filters apply on `SEARCH`/Enter; `CLEAR` resets to defaults (including default status filters such as "Active").
- Filter, sort, page and rows-per-page persist per list for the session when returning from a detail (FR-G-06).
- `EXPORT .CSV` exports the filtered set, all pages, visible columns; > 10,000 rows → background job + notification (→ Architect threshold). File names `<list>-dd-mm-yyyy.csv`; dates inside as dd/mm/yyyy, money as plain numbers with 2 dp (no "RM" in cells; header says "(RM)").
- Bulk selection: header checkbox selects the current page; "Select all {n} matching" link selects the full filtered set where bulk is allowed.
- Row click target is the first-column link and the 👁 icon; the whole card is tappable on phone.

## 12. Phone specifics (EMP / MGR)

- 360 px minimum; no horizontal scroll; tap targets ≥ 44 px; primary action sticky at the bottom (FR-G-14, §8.4).
- Dialogs open as bottom sheets; date pickers full-screen with dd/mm/yyyy header, PH dots, greyed non-working days.
- Tables → cards (< 600 px); filter card → `Filters (n)` sheet.
- Bottom bar for employee users (UXQ-07); Approvals badge.
- Pull-to-refresh on Home, inbox and lists.
- Reference numbers tap-to-copy.
- Camera capture via the browser file input (→ Architect, §8.4); "Add to home screen" (PWA, Could) uses the browser's own prompt.

## 13. Accessibility (NFR-07, WCAG 2.1 AA for EMP/MGR screens)

- Every input has a visible label (no placeholder-only labels); errors linked to fields (aria-describedby); error summary focusable.
- Status is never colour-only: chips carry text; EMERGENCY and flags have text labels.
- Keyboard: full tab order; dialogs trap focus and return it; Escape closes non-destructive dialogs.
- Calendar and charts have a list/table alternative (calendar day list, dashboard tile numbers).
- Contrast and focus styles are the UI Designer's tokens.

## 14. Formatting (everywhere)

| Item | Format | Example |
|------|--------|---------|
| Date | dd/mm/yyyy | 05/05/2027 |
| Date-time | dd/mm/yyyy HH:mm (24 h, MYT) | 05/05/2027 14:32 |
| Month | MMM yyyy | Nov 2027 |
| Money | RM 1,234.56 (tables: 1,234.56 under "(RM)", right-aligned) | RM 18,816.51 |
| Leave days | 1 dp + "days" (or "d" in tiles) | 12.5 days |
| Rate | RM 0.600/km | — |
| Percent | 1 dp | 92.0% |
| MyKad | YYMMDD-PB-###G, masked `******-**-5678` | — |
| Phone | +60 12-345 6789 | — |
| Length of service | "4 years 1 month 14 days" | as Kakitangan |

## 15. Status chip labels (text fixed; colours by UI Designer)

| Object | Labels |
|--------|--------|
| Employment | Pending Join · On Probation · Confirmed · Notice Period · Separated · Withdrawn |
| Leave | Pending L1 / Pending L2 · Approved · Rejected · Withdrawn · Cancellation pending · Cancelled · (flags) EMERGENCY · On behalf · Attachment pending · MC invalid |
| Replacement credit | Pending · Approved · Rejected · Withdrawn · (flag on an Approved credit past its expiry) Expired |
| Claim (D12) | New · Submitted · Approved · Disbursed · Rejected · Withdrawn · Cancelled · (flags) Over limit · Late (override) · Possible duplicate · On behalf |
| Disbursement batch | Draft · Pending approval · Approved · Exported · Disbursed · Cancelled · (flag) Outputs out of date |
| Change request | Submitted · Approved · Rejected · Cancelled |
| User | Invited · Active · Locked · Disabled · Expired |
| PH calendar year | Draft · Published |
| Import | Validated · Committed · Failed |
| Payroll run (R1.1) | Draft · In Review · Pending Approval · Approved · Finalised · Cancelled · (mode) Parallel / Live |
| Payslip (R1.1) | Not generated · Generated · Published · Viewed · Revised |
| EA form (R1.1) | Draft · Final · Issued · Re-issued |
| Statutory table (R1.1) | Draft · Verified · Superseded |
| DSR | Open · Responded · Extended · Closed |

---

## Open UX questions for Albert
The consolidated list (UXQ-01 – UXQ-14) is in [`screen-inventory.md`](screen-inventory.md#open-ux-questions-for-albert). Interaction-specific: UXQ-04 (reason when requesting leave cancellation), UXQ-10 (Admin override as a separate action), UXQ-14 (single Super Admin and payroll approval).

## Ready for GATE 2 (design)?
Loading, empty and error states; the validation message catalogue traced to PRD rules; approval interactions (multi-level leave, single-level first-wins claims, bulk, delegation, cancel/withdraw/copy/undo); receipt upload; balance preview; sensitive-data handling; mobile and accessibility rules are specified. **Yes — ready for GATE 2 review.**
