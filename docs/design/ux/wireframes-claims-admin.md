# PRET — Wireframes: Claims administration (Admin / Super Admin; Manager team view)

**Work item:** W1-004 · **Author:** UX Designer · **Status:** Draft for GATE 2 (Design) · **Last updated:** 15/11/2026
**Shared primitives:** [`wireframes.md`](wireframes.md) §0. **Screens:** S-CL-01 – S-CL-16. Field ids are PRD §7 (`CH` header, `CLN` line, `CC` category, `CLM-L` limit, `PB` batch).
**D12 statuses everywhere:** New · Submitted · Approved · Disbursed · Rejected · Withdrawn · Cancelled. **D16 single route:** HLB Connect First manual payment list + AutoCount .xlsx — no Kakitangan payroll option exists anywhere in the UI.

---

## C1 · Claims — S-CL-01 · `/claims` (MGR: `/team/claims`) · F-CLM-12, F-CLM-25 · US-CLAIM-017, 015

```
┌ KPI strip (current filter) ─────────────────────────────────────────────────────────┐
│ Submitted 6 · Approved (not disbursed) 11 · Disbursed 42 · Rejected 2               │
│ Total excl. SST RM 18,204.11 · Total SST RM 612.40 · Total RM 18,816.51              │
├ Filters ─────────────────────────────────────────────────────────────────────────────┤
│ [Search claim no./employee/receipt no./UUID] [Employee ▾] [Department ▾] [Category ▾] [Status ▾] │
│ [Transaction from–to] [More filters ▸]                       View: (•)Header ( )Line │
│ [EXPORT .CSV] [EXPORT .XLSX] [AUTOCOUNT EXPORT] [DOWNLOAD ATTACHMENTS] [SUMMARY REPORT] [(CLEAR)] [SEARCH] │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
| Element | Specification |
|---------|---------------|
| Search | Claim no., employee no./name, receipt/e-Invoice no., UUID |
| Filters | Employee · Department (multi) · Category (multi) · Status (multi; New excluded unless on-behalf — BR-CLM-27) · Transaction date from–to · *More:* Application (submitted) date from–to · Approval date from–to · Disbursement date from–to · Batch (PB-… / payroll run) · Flags (Over limit / Late override / Possible duplicate / On behalf) · On behalf only · Include separated employees |
| Header-view columns | [ ] · Claim no. › · Employee · Department · Title · Lines · Total (RM) · SST (RM) · Status ● · Flags ● · Submitted · Approved/rejected by & date · Batch / run · Disbursed on · Payment ref · 👁 |
| Line-view columns (as Kakitangan) | Employee · Date of transaction · Date of application · Category · More info (claim no. ›, mileage km, description) · Amount (RM) · SST (RM) · 📎 · Receipt/e-Invoice no. · UUID · Date of approval/rejection · Approved/rejected by · Status ● · Batch / payroll run · Disbursed on |
| Bulk (header view) | `APPROVE SELECTED` / `REJECT SELECTED` — Submitted only, not own; result table (S-AP-05) |
| Buttons | `EXPORT .CSV` (columns of current view) · `EXPORT .XLSX` · `AUTOCOUNT EXPORT` (S-CL-15) · `DOWNLOAD ATTACHMENTS` (S-CL-16, filtered set) · `SUMMARY REPORT` (→ S-RP-19 with date range) · `SUBMIT ON BEHALF` (S-CL-02) · `CLEAR` · `SEARCH` |
| MGR scope | Reportees' claims only; no AutoCount/attachments/summary buttons; decisions only via S-AP-04 |
| Row → | S-AP-04 (admin mode) |
| Sort | Submitted desc |

## C2 · Submit claim on behalf — S-CL-02 · `/claims/new-on-behalf` · F-CLM-18 · US-CLAIM-025
S-PT-13 form with **Employee *** picker at the top (active, Notice Period, or Separated within portal-access end) and **On-behalf note** (optional 0/300). Saved New claims are visible to the employee and to ADM (BR-CLM-27). On submit: goes to Submitted for normal single approval; the entering Admin cannot approve it ("You entered this claim on behalf — another approver must decide"). Chip "On behalf by {name}".

## C3 · Bulk claim entry — S-CL-03 · `/claims/bulk` · F-CLM-28 (Could) · US-CLAIM-027
Editable grid; one row = one line: Employee * · Claim title * (rows with the same employee + title form one claim) · Category * · Transaction date * · Amount incl. SST * · SST · Receipt no. · UUID · Notes · Distance km (mileage) · From / To / Purpose (mileage) · Attachment (per row upload) · Row status (✓ / ✕ message). `ADD ROW` · paste from spreadsheet · `VALIDATE` · `SUBMIT ALL` (creates claims on behalf, Submitted, each validated as normal) → result table Claim no. · Employee · Lines · Total · Result.

## C4 · Late-submission overrides — S-CL-04 · `/claims/late-overrides` · F-CLM-21 · US-CLAIM-026 (UXQ-03)
List: Filters Employee, Applied from–to · Columns Employee · Claim no. · Line(s) · Transaction date · Days past deadline · Reason · Applied by/at · Used (claim submitted ✓/—) · `NEW OVERRIDE` · `EXPORT .CSV`.
New override: Employee * → table of that employee's **New** claims' lines older than the deadline (Claim no. · Line · Category · Transaction date · Amount — read-only) with checkboxes · Reason * (≥ 10 chars) · `APPLY OVERRIDE` → lines get "Late (override)" flag; employee notified in-app ("You can now submit CL-…"). On-behalf claims: the override can be applied directly from S-CL-02 line ("Apply late override").

## C5 · Claim categories — S-CL-05 · `/claims/setup/categories` · F-CLM-01 · US-CLAIM-001, 002
List: Search code/name · Filters Group, Active, Tax treatment · Columns Code › · Name · Group · Receipt required · Mileage rate (RM/km) · Limits summary ("RM 300.00 / transaction") · Tax treatment · GL account · Active ● · `ADD NEW CATEGORY` · `EXPORT .CSV`. Seed: Interact's 20 Kakitangan categories (§7.5).

## C6 · Claim category form — S-CL-06 · `/claims/setup/categories/{code}` · F-CLM-01/02 · US-CLAIM-001, 003
Tabs **Details** · **Limits** · **History**.
*Details* cards: Identity — CC1 Code * · CC2 Name * · CC3 Group * · CC4 Description/policy text · CC20 Active / display order. Capture rules — CC5 Receipt required * · CC6 Notes required * · CC7 e-Invoice/receipt no. (Hidden / Optional / Required) * · CC8 MyInvois UUID (Hidden / Optional / Required) * · CC9 Capture SST * · CC12 Extra line fields (multi: From/To/Purpose · Client/attendees · Travel destination · Merchant name). Mileage — CC10 Mileage-based * → CC11 Rate (RM/km, 3 dp) * with effective-from date and rate history table (Effective from · Rate · Set by). Eligibility — CC13 Claimant * · CC14 Min service (months), Statuses (Probation / Confirmed / Notice), Grades. Finance — CC16 Tax treatment * (verify note Q24) · CC17 EA form line (if not Reimbursement) · CC18 AutoCount GL account * (validated against the GL list from S-OR-01).
*Limits*: rows for this category (same columns as S-CL-07) + `ADD LIMIT`.
*History*: audit of changes (field · before · after · by · at).

## C7 · Claim limits — S-CL-07 · `/claims/setup/limits` · F-CLM-02 · US-CLAIM-003
List: Filters Category, Applies to, Effective on date, Behaviour · Columns Category · Applies to (Everyone / Grade / Department / Employee group / Employee) · Target · Per transaction (RM) · Per month (RM) · Per year (RM) · Behaviour (Block / Warn) · Effective from · Effective to · ⋮ Edit / End · `ADD LIMIT` · `EXPORT .CSV`. Form: CLM-L1 Category * · CLM-L2 Applies to * · CLM-L3 Target (picker per L2) · CLM-L4/5/6 amounts (blank = no limit; month ≥ transaction, year ≥ month) · CLM-L7 Behaviour * (default Block) · CLM-L8 Effective from * / to. Precedence note: "Employee > Department > Grade > Group > Everyone".

## C8 · Claims settings — S-CL-08 · `/claims/setup/settings` · F-CLM-03 · US-CLAIM-004
Fields: Submission deadline (days after transaction) * (default 60) · Monthly limit-refresh day * (1–31; default 31 = month end) · Month-end disbursement cut-off * (default "Last day of the month") · Notes required by default · Attachments required by default · Include separated employees in claims lists · **SA approval of disbursement batches** (toggle, default Off — **SA only** 🔒 for ADM) · AutoCount document date (Approval date / Disbursed date) · AutoCount claims-payable credit account (GL) · Claims cut-off for payroll (R1.1, PS4 link → S-PY-01). `SAVE SETTINGS`.

---

## Month-end disbursement (F-CLM-14/15/17/23/27, D12, D16)

## C9 · Disbursement batches — S-CL-09 · `/claims/batches` · F-CLM-14, F-RPT-19 · US-CLAIM-019
List: Search batch no. · Filters Year, Month, Status (Draft / Pending approval / Approved / Exported / Disbursed / Cancelled) · Columns Batch no. › · Disbursement month · Approval cut-off · Count · Total (RM) · Status ● · Payment date · Payment reference · Prepared by · Approved by (only when the setting is on) · Outputs (✓ current / ⚠ out of date) · `NEW MONTH-END BATCH` · `EXPORT .CSV`. Banner when Approved claims are waiting and no open batch for the current month: "11 approved claims (RM 2,140.60) are not in a batch yet. [NEW MONTH-END BATCH]".

## C10 · New month-end batch — S-CL-10 · `/claims/batches/new` · F-CLM-14 · US-CLAIM-019
```
Step 1 Month & cut-off ── Step 2 Select claims ── Step 3 Review & create
```
*Step 1:* PB3 Disbursement month * (default current) · PB4 Approval cut-off date * (default last day of PB3) · PB9 Planned payment date * (≥ today) · PB12 Notes. Info: "Route: Hong Leong Bank Connect First — manual payment list (D16)" 🔒.
*Step 2:* table of **Approved** claims not in another open batch: [x] (pre-ticked if approval date ≤ cut-off) · Claim no. › · Employee · Department · Title · Approved on · Approved by · Total (RM) · Bank details (✓ complete / ✕ missing) · Payment method. Filters: approval date, employee, department; `SELECT ALL` / `CLEAR SELECTION`. Claims already in an open batch are not shown (count note "3 claims are in PB-2027-010"). Deselected claims stay Approved for the next batch. Live totals: count · total · SST · employees.
*Step 3:* per-employee totals table (Employee · Claims · Amount) · blocking list "Employees with incomplete bank details" (link to profile Bank tab) · cheque/cash section if UXQ-06 default accepted · `[(BACK)] [CREATE BATCH]` → S-CL-11 status Draft; N-29 to employees (in-app).

## C11 · Batch detail — S-CL-11 · `/claims/batches/{no}` · F-CLM-14/15/17/26/27 · US-CLAIM-019–021, 024, 018
```
┌ PB-2027-011 · November 2027 · cut-off 30/11/2027          ●Exported ┐
│ 11 claims · 6 employees · Total RM 2,140.60 · SST RM 58.10           │
│ Planned payment 01/12/2027 · Prepared by Aina 30/11/2027 17:02       │
│ ⚠ Outputs out of date — CL-2027-00099 was cancelled after export     │
│ [GENERATE OUTPUTS] [MARK DISBURSED] [(SUBMIT FOR APPROVAL)] [⋮ Cancel batch] │
├ Tabs: Claims | By employee | Outputs | History ─────────────────────┤
```
| Tab | Content |
|-----|---------|
| Claims | Claim no. › · Employee · Title · Approved on · Total (RM) · Status ● (Approved until Disbursed) · ⋮ Remove from batch (Draft only) · `ADD CLAIMS` (Draft only: picker of eligible Approved claims) |
| By employee | Employee · Bank · Account ••••1234 · Claims (nos.) · Amount (RM) · Bank changed after export ⚠ (EC-CLM-10) |
| Outputs | Versions table: Version · Generated at · By · Status (Current / Out of date / Superseded) · `HLB PAYMENT LIST .XLSX` · `PDF` · `VIEW` (S-CL-12) · `AUTOCOUNT .XLSX` — every download logged |
| History | Status changes, regenerations, removals with by/at/reason |
Actions by status:
| Batch status | Actions (ADM unless stated) |
|--------------|-----------------------------|
| Draft | `GENERATE OUTPUTS` (setting off → status Exported) · `SUBMIT FOR APPROVAL` (setting on → Pending approval, N-26) · `ADD CLAIMS` · remove claims · `CANCEL BATCH` (reason) |
| Pending approval | SA (≠ preparer): `APPROVE BATCH` / `RETURN` (comment) → N-27 · ADM: `CANCEL BATCH` |
| Approved | `GENERATE OUTPUTS` → Exported · `CANCEL BATCH` |
| Exported | `MARK DISBURSED` (S-CL-13; disabled with tooltip if outputs out of date) · `REGENERATE OUTPUTS` · `DOWNLOAD ATTACHMENTS` (S-CL-16) · `CANCEL BATCH` (reason; claims stay Approved) |
| Disbursed | read-only; per-claim `UNDO DISBURSEMENT` via S-AP-04 / S-CL-14 |
Generation validation: blocked if any employee lacks complete bank details (list with links) or a category lacks a GL account (AutoCount).

## C12 · HLB claims payment list — S-CL-12 · `/claims/batches/{no}/payment-list` · F-CLM-15 · US-CLAIM-020
On-screen report mirroring the .xlsx/PDF: **Header** — Company name · Paying account "Hong Leong Bank ••••4321" · Batch no. · Disbursement month · Planned payment date · Count · Total (RM) · Prepared by/at · Approved by/at (if setting on) · Version · "Generated dd/mm/yyyy HH:mm". **Columns** — No. · Employee no. · Beneficiary name (account holder) · Bank · Bank code/BIC · Account no. (**full** — this report only; viewing logged) · Amount (RM) · Payment reference `CLAIM PB-2027-011` · Payment description `Claims reimbursement Nov 2027` · Beneficiary email · Claim nos. **Totals row** = batch total (✓ check shown). Buttons `DOWNLOAD .XLSX` · `DOWNLOAD PDF` · `PRINT` · `BACK TO BATCH`. Banner "Key these payments into HLB Connect First manually. PRET does not send anything to the bank."

## C13 · Mark batch disbursed — S-CL-13 · dialog · F-CLM-17 · US-CLAIM-021
Fields: PB10 Payment date * (≤ today) · PB11 HLB payment reference * (0/50) · Notes. Summary "11 claims for 6 employees, RM 2,140.60 will become Disbursed and each employee will be notified." `[MARK DISBURSED]` → N-25.

## C14 · Undo disbursement — S-CL-14 · dialog (from S-AP-04) · F-CLM-23 · US-CLAIM-022
"Undo disbursement of CL-… (RM 245.60, PB-2027-011, ref 7781)? It returns to Approved and will be proposed for the next batch." Reason * (e.g. "Rejected by HLB — invalid account", 0/500) · `UNDO DISBURSEMENT` → N-28.

## C15 · AutoCount claims postings export — S-CL-15 · dialog · F-CLM-27 · US-CLAIM-024
Source * (•) Disbursement batch [PB-… ▾] (•) Date range [from] [to] · Include statuses * [x] Approved [x] Disbursed · Document date (from setting, shown) · `EXPORT .XLSX`. Preview count of rows. Blocked list: "Category without GL account: {name} [FIX]". Columns (template order per Q37): Document date · Document no. · Employee no. · Employee name · GL account · Description · Amount excl. SST · SST · Amount incl. SST · Department / cost centre · Credit account · Batch no.

## C16 · Download attachment bundle — S-CL-16 · dialog · F-CLM-26 · US-CLAIM-018
"Download {n} receipts from {m} claims as one .zip? Files are named `<claim no.>-<line>-<n>.<ext>`. The download is logged." Scope shown (current filter or batch PB-…). `[DOWNLOAD .ZIP]`. Large sets: "Preparing… you'll get a notification when it's ready" (→ Architect for size threshold).

---

## Open UX questions touching this file
UXQ-03 (late overrides), UXQ-06 (cheque/cash employees in a claims batch). Full list in `screen-inventory.md`.

## Ready for GATE 2 (design)?
All claims-admin screens and the full month-end disbursement flow (D12, D16) specified at field level. **Yes.**
