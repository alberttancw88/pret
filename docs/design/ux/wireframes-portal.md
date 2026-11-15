# PRET — Wireframes: Self-service portal (EMP) and Approvals & team (MGR)

**Work item:** W1-004 · **Author:** UX Designer · **Status:** Draft for GATE 2 (Design) · **Last updated:** 15/11/2026
**Index & shared primitives:** [`wireframes.md`](wireframes.md) (shell §0.1, list §0.2, form §0.3, detail §0.4, dialog §0.5, widgets §0.6 apply to every screen here).
**Screens:** S-PT-01 – S-PT-25 (EMP; R1.1 = S-PT-21 – 25) · S-AP-01 – S-AP-08 (MGR; inbox and decision views also ADM/SA).

> **Phone-first.** Every screen in this file is designed at **360 px** first (FR-G-14,
> §8.4): single column, tap targets ≥ 44 px, primary action sticky at the bottom, no
> horizontal scroll (tables become cards). The desktop layout is the same content in a
> two-column grid. Field ids `{LA3}` etc. refer to the PRD field tables.

---

## P1 · Home — S-PT-01 · `/home` · F-PRT-03, F-RPT-22 · US-PORTAL-004, US-REPORT-022

```
┌──────────────────────────────┐
│ ☰ Home                 🔔 2  │
├──────────────────────────────┤
│ Hi, Aina  ●Manager           │
│ ┌ Leave balances ──── All › ┐│  horizontal scroll of tiles
│ │ Annual   Sick   Replacement││
│ │ 8.5 d    14.0 d  1.0 d     ││
│ │ 6.0 earned to date         ││  (accrual only)
│ │ ⚠ 3.0 CF expires 31/03/2028││
│ └────────────────────────────┘│
│ [APPLY LEAVE] [NEW CLAIM]     │  quick actions (2×2 grid)
│ [REQUEST REPLACEMENT CREDIT]  │
│ [MY PAYSLIPS]  (R1.1)         │
│ ┌ Manager ─────────────────┐ │  only if MGR
│ │ Approvals waiting   4  › │ │
│ │ Team on leave today 1  › │ │
│ │ This week           3  › │ │
│ │ Probation due (30d) 1  › │ │
│ │ Team claims submitted 2 ›│ │
│ └──────────────────────────┘ │
│ ┌ My pending items ────────┐ │
│ │ LV-2027-00031 Annual ●Pending L1 │
│ │ CL-2027-00102 RM 245.60 ●Submitted│
│ │ CR-2027-00004 Bank ●Submitted     │
│ └──────────────────────────┘ │
│ ┌ Upcoming leave (next 3) ─┐ │
│ ┌ Public holidays (next 3) ┐ │  "Selangor" label
│ ┌ Recent claims (last 3) ──┐ │
│ ┌ Latest payslip (R1.1) ───┐ │  "Nov 2028 · Net RM •••• [Show]"
└──────────────────────────────┘
```
| Widget | Fields / content | Tap → |
|--------|------------------|-------|
| Greeting | "Hi, {A3 preferred name or first word of A2}" + role chip | — |
| Leave balance tiles | One per visible leave type (LT31) the employee is eligible for, in display order (LT34): type name · **Available** (BR-LV-20, 1 dp) · under accrual "x.x earned to date" · expiring CF/credits within 30 days "⚠ x.x expires dd/mm/yyyy" | S-PT-06 ledger for that type; "All ›" → S-PT-05 |
| Quick actions | `APPLY LEAVE` → S-PT-02 · `NEW CLAIM` → S-PT-13 · `REQUEST REPLACEMENT CREDIT` → S-PT-08 · `MY PAYSLIPS` (R1.1) → S-PT-21 | — |
| Manager panel (MGR only, F-RPT-22) | Approvals waiting (count of items where I am current approver/delegate) · Team on leave today · Team on leave this week · Probation due in team (≤ 30 days) · Team claims Submitted | S-AP-01 / S-AP-06 / S-RP-07 / S-AP-01 Claims tab |
| My pending items | Leave Pending/Cancellation pending, claims New/Submitted, change requests Submitted, credits Pending — reference · short label · chip; max 5, "See all" | detail |
| Upcoming leave | Next 3 Approved: type · dd/mm/yyyy – dd/mm/yyyy · days | S-PT-04 |
| Public holidays | Next 3 for my state: date · day · name | S-PT-11 |
| Recent claims | Last 3: claim no. · title · total · chip | S-PT-15 |
| Latest payslip (R1.1) | Month · pay date · Net hidden "RM ••••" + `[Show]` | S-PT-22 |

Empty states: no leave types eligible → tile area shows "No leave types available yet — contact HR"; no pending items → "Nothing pending"; no PH published → "Holiday calendar for {year} not yet published". Loading: skeleton tiles (target ≤ 3 s on 4G, FR-PRT-03).

---

## P2 · Apply leave — S-PT-02 · `/my/leave/apply` · F-LV-05/06/07/12/13/14/16/17/30/33/34, F-PRT-04 · US-LEAVE-008–012, 018–021, 024, 038, 039, US-PORTAL-005

Single scrolling form; balance preview pinned **directly above** the sticky `SUBMIT` (FR-PRT-04). After dates are chosen the user needs at most: session (if not Full) → reason → `SUBMIT` → confirm = ≤ 4 taps.

```
┌──────────────────────────────┐
│ ← Apply leave                │
├──────────────────────────────┤
│ ⓘ {LP9 form message}         │  only if set
│ Leave type *                 │
│ [ Annual Leave · 8.5 d avail ▾]│ {LA3}
│ ⓘ {LT4 policy text}          │
│ Start date *    Session      │
│ [ 05/05/2027 📅] [Full ▾]    │ {LA4}{LA5}
│ End date *      Session      │
│ [ 07/05/2027 📅] [Full ▾]    │ {LA6}{LA7}
│ ⓘ Days: 2.0 (06/05 public    │ {LA8} live, with why
│    holiday not counted)      │
│ Reason *                     │
│ [ Family trip            ]   │ {LA10} 0/500
│ Attachment (required)        │
│ [📷 TAKE PHOTO][📎 FILE]     │ {LA11} ≤3 files
│ ▸ More (contact, cover)      │ {LA14}{LA15}
│ ⚠ EMERGENCY — starts within 3 days │ {LA16} info, not a block
├──────────────────────────────┤
│ Available now        8.5     │ {LA9}
│ This application    −2.0     │
│ Pending             −1.0     │
│ Available after      5.5     │
│ (Earned to date at 07/05: 4.0)│ accrual only
│ [          SUBMIT          ] │ sticky
└──────────────────────────────┘
```
| # | Field | Control | Rules / behaviour |
|---|-------|---------|-------------------|
| LA3 | Leave type * | Select; each option "Name · x.x days available" (as Kakitangan) | Only eligible types (BR-LV-51: gender, marital status, min service, probation) and visible types (LT31); types with no entitlement show "approval only" or "cap x days left"; selecting shows LT4 text |
| LA4 | Start date * | Date picker: PHs dotted, rest/off days greyed (employee's pattern + state calendar) | BR-LV-50/54/58; back-dated beyond LT20 → block "Contact HR — {type} must be submitted within {n} working days after the last leave day" |
| LA5 | Start session | Select Full / AM / PM (single-day) · Full / PM (multi-day first day) | BR-LV-22; hidden if LT14 = No |
| LA6 | End date * | Date picker (≥ start) | **Read-only** for consecutive types: end = start + LT23 − 1 (Maternity 98 → start + 97; Paternity 7 → start + 6) with 🔒 "Fixed by policy" |
| LA7 | End session | Full / AM (multi-day only) | BR-LV-22 |
| LA8 | Days | Read-only, recalculated on every change | BR-LV-21–23; expandable "How is this counted?" lists each date with weight (1 / 0.5 / 0 PH / 0 rest day) |
| LA10 | Reason | Text area, counter 0/500 | * if LT15 |
| LA11 | Attachment(s) | `TAKE PHOTO` (camera) / `CHOOSE FILE`; thumbnails with ✕; max 3 | * per LT16/17; if LT18 > 0, optional with notice "You can add the MC within {n} hours" (flag "Attachment pending") |
| LA12 | Expected confinement date | Date | Shown & * for Maternity/Paternity |
| LA13 | Child's date of birth | Date | Paternity, shown after "Child already born?" (•) Yes |
| LA14 | Contact while on leave | Phone | Optional, under "More" |
| LA15 | Cover / handover person | Employee picker (active colleagues) | Optional (Could), under "More" |
| LA9 | Balance preview panel | Read-only | Available now · This application · Pending · Available after; accrual: earned to date at end date (BR-LV-14); pooled types also "Sick + hospitalisation pool: 22.0 of 60 used" (BR-LV-31) |
| LA16 | Emergency | Inline info chip | Shown when start < LP10 days away or back-dated (types in LP11): "This will be flagged EMERGENCY to your approver." |
| — | Cross-year notice | Info | Range spans 31/12: "This will be split into 2 linked applications (2027: 2.0 d, 2028: 1.0 d), approved together." (BR-LV-25) |
| — | Next-year notice | Info | Dates in next year (LP8): "Uses your projected 2028 entitlement." Before LP8 date or calendar unpublished → block "Applications for 2028 open on 01/11/2027" / "Holiday calendar for 2028 not yet published" (EC-ORG-01) |

Buttons: `SUBMIT` (sticky) · `(CANCEL)` (top-left ←, unsaved-changes guard). No draft for leave (not in scope).
On `SUBMIT`: server validation BR-LV-50–58. **Blocks** shown in a summary card at top + next to the field (messages in interaction-notes §4.1). **Warnings** (e.g. advance notice LT19 = Warn, paternity < 30 days' notice BR-LV-48) require ticking `[x] I understand` before `SUBMIT` is enabled again.
Success: "Leave submitted — LV-2027-00031 is waiting for {approver name} (level 1 of 2)." `[VIEW APPLICATION]` `[BACK TO HOME]`.

**Variant S-LV-02 (Admin on behalf)** — see `wireframes-leave-admin.md` §L2.

---

## P3 · My leave applications — S-PT-03 · `/my/leave` · F-PRT-06, F-LV-08, F-LV-10 · US-PORTAL-007

List pattern. Tabs above list: **Applications** · **Balances** (→ S-PT-05) · **Credits** (→ S-PT-09).

| Element | Specification |
|---------|---------------|
| Search | Reference no. |
| Filters | Leave year (default current) · Type (multi) · Status (multi: Pending, Approved, Rejected, Withdrawn, Cancellation pending, Cancelled) · Date from–to (leave dates) |
| Columns | Reference › · Type · From · To · Days · Status ●(Pending shows "Pending L1/L2") · Emergency ●(if flagged) · Submitted (dd/mm/yyyy HH:mm) · Decided by / at · Action ⋮ |
| Row actions (by status) | Pending → `WITHDRAW` · Approved & start in future & LT30 = Yes → `CANCEL LEAVE` · Approved & started/past (or LT30 = No) → `REQUEST CANCELLATION` · others → view only |
| Buttons | `APPLY LEAVE` (primary) · `EXPORT .CSV` · `CLEAR` · `SEARCH` |
| Sort / paging | Default From desc; 25 |
| Phone card | Title "Annual · 05/05 – 07/05/2027" · chip · "2.0 days · LV-2027-00031" · ⋮ |
| Empty | "You haven't applied for leave in {year}." `[APPLY LEAVE]` |

## P4 · Leave application detail (own) — S-PT-04 · `/my/leave/{ref}` · US-LEAVE-013, 016

Header: Reference {LA1} (copyable) · chips Status {LA18}, EMERGENCY {LA16}, "On behalf by {name}" {LA17}, "Attachment pending" · Type {LA3} · Dates {LA4}–{LA6} with sessions {LA5}/{LA7} · Days {LA8} · Linked application (split: "Part 2 of 2: LV-…-2 ›").
Body cards: **Details** — Reason {LA10} · Expected confinement {LA12} · Child's DOB {LA13} · Contact {LA14} · Cover {LA15} · Submitted at {LA21}. **Attachments** {LA11} — thumbnails (tap → full-screen viewer); if "Attachment pending": `[ADD ATTACHMENT]`. **Balance effect** — type balance before/after (read-only). **Approval trail** {LA19} — rows: Level · Approver · Acting as (delegate / Admin override / re-routed) · Decision chip · Comment · dd/mm/yyyy HH:mm; next pending level shown greyed "Waiting for {name}".
Actions (sticky on phone): `WITHDRAW` (Pending) → confirm dialog "Withdraw LV-…? Your 2.0 days will be released." `[(KEEP)] [WITHDRAW]` · `CANCEL LEAVE` (future Approved) → dialog: Reason (optional, 0/500) `[CANCEL LEAVE]` · `REQUEST CANCELLATION` (started/past) → dialog: Reason * (≥ 10 chars — UXQ-04) `[SEND REQUEST]`. Hint: "To change some days, cancel and apply again." (UXQ-08). Record footer (FR-G-13).

## P5 · My balances — S-PT-05 · `/my/leave/balances` · F-LV-21 · US-LEAVE-028

Leave year selector `[2027 ▾]` (current, previous, next if generated). One card per visible type:
```
┌ Annual Leave ─────────────────── 8.5 available ┐
│ Entitled 12.0 · Carried forward 3.0 · Earned 0.0│
│ Adjustments +1.0 · Taken −6.5 · Pending −1.0    │
│ Expired/forfeited 0.0                           │
│ Earned to date (accrual) 9.0                    │
│ ⚠ 3.0 carried forward expires 31/03/2028        │
│                                [VIEW LEDGER ›]  │
└─────────────────────────────────────────────────┘
```
Fields per card (BR-LV-20): Available (large) · Entitled · Carried forward · Earned (credits) · Adjustments · Taken · Pending · Expired/forfeited · Balance · Earned to date (accrual types) · expiring items with dates · for Sick/Hospitalisation the pool line "Pool used 22.0 of 60". Footer link `YEARLY LEAVE REPORT` → S-PT-07. Empty: "No leave entitlements for {year} yet."

## P6 · Balance ledger — S-PT-06 · `/my/leave/balances/{type}?year=` · F-LV-28 · US-LEAVE-028
List pattern. Filters: Year · Transaction type (multi: Entitlement, Accrual, Carry-forward, Credit earned, Taken, Cancelled, Adjustment, Expired, Forfeited, Opening balance) · Date from–to. Search: reference. Columns: Date · Transaction · Days (+/−, 1 dp) · Reference › (LV-/RL-/adjustment) · Running balance · By (user or "System"). Default sort Date asc. `EXPORT .CSV`. Admin/manager entry from S-LV-03 shows the same screen with the employee name in the header (scope-checked).

## P7 · Leave report by individual — S-PT-07 (S-RP-24 entry) · `/reports/leave-individual` · F-RPT-27 · US-REPORT-025
Filters: Employee * (EMP: fixed to self 🔒; MGR: team picker; ADM/SA: all) · Year *. Sections: header (employee no., name, department, position, join date, service) · Balances table (Type · Entitled · CF · Earned · Adjusted · Taken · Pending · Expired · Available) · Applications table (Reference · Type · From · To · Days · Status · Decided by/at). Actions: `PRINT` (print layout A4) · `EXPORT .CSV` · `EXPORT .XLSX`. Sensitive: Sick/Maternity rows visible to MGR as "Medical" (Q17).

## P8 · Request replacement credit — S-PT-08 · `/my/leave/credits/new` · F-LV-15 · US-LEAVE-022
| # | Field | Control | Rules |
|---|-------|---------|-------|
| RC3 | Date worked * | Date picker | ≤ today, ≥ today − 30 days (setting); on pick shows the day type chip: "Rest day" / "Off day" / "Public holiday: Hari Malaysia" — a normal working day → error "Replacement credit is only for work on a rest day, off day or public holiday"; duplicate date → "You already have a credit for this date" (BR-LV-80) |
| RC4 | Duration worked * | (•) Full day (•) Half day | Preview "Credit: 1.0 day" / "0.5 day" |
| RC5 | Reason / work done * | Text area 0/500 | — |
| RC6 | Attachment | File/camera | Optional |
| RC8 | Expiry (preview) | Read-only | "If approved, expires dd/mm/yyyy" (date worked + LP16) |
Approver shown: "Goes to {manager name} for approval." `SUBMIT REQUEST`. Success → S-PT-09.

## P9 · My replacement credits — S-PT-09 · `/my/leave/credits` · F-LV-15/20 · US-LEAVE-022, 023
List pattern. Search: credit no. Filters: Year · Status (Pending / Approved / Rejected / Withdrawn) · Expiring within (30 / 60 / 90 days). Columns: Credit no. › · Date worked · Day type · Days · Status ● · Expiry · Used (days) · Remaining · Decided by / at. Row action: `WITHDRAW` (Pending). Buttons `REQUEST CREDIT`, `EXPORT .CSV`. Detail (bottom sheet): all RC fields + approval trail + consumption ("Used by LV-… on dd/mm/yyyy"). Empty: "No replacement credits yet."

## P10 · Leave calendar — S-PT-10 · `/leave/calendar` · F-LV-23 · US-LEAVE-030
```
┌ ‹ November 2027 ›   [Month|Week]   [Filters (2)]       ┐
│ Legend: ■Annual ■Medical ■Unpaid … ◆Public holiday      │  legend only for viewers who see types
│        Mon  Tue  Wed  Thu  Fri  Sat  Sun                │
│ Aina   ■    ■                                            │  rows per employee (desktop)
│ Ben              ▣AM                                     │
│ ◆ 01/11 Deepavali (Selangor)                             │
└──────────────────────────────────────────────────────────┘
```
Filters: Department (multi) · Work location (multi) · "Holidays for location" (single, default mine) · Leave type (only viewers with type visibility) · Status: Approved / include Pending (MGR, ADM, SA). Visibility (§6.14, Q17): EMP peers → "On leave" / "On leave (AM)" only, approved only, scope per LP12; MGR → reportees with type, Sick/Maternity/Hospitalisation shown as "Medical", pending hatched; ADM/SA → everyone with type. Tap an entry → MGR/ADM: S-AP-02; EMP peers: nothing (no detail). Phone: month grid with dots per day; tapping a day opens a list for that day. `EXPORT .CSV` (rows visible to the viewer, same masking) · `CLEAR` · `SEARCH` (employee name).

## P11 · Public holidays — S-PT-11 · `/my/holidays` · F-PRT-10 · US-PORTAL-010
Header: "Public holidays — {state of my work location} · {year ▾}". List: Date · Day · Name · Type (National / State / Replacement / Company / Special declared) · Half day. Search: name. Filters: Year · Type. `EXPORT .CSV`. Only published calendars (BR-ORG-25); unpublished year → "The {year} calendar has not been published yet."

---

## P12 · My claims — S-PT-12 · `/my/claims` · F-CLM-13, F-CLM-20 · US-CLAIM-016

```
┌ Limit utilisation (Nov 2027)            [▾ details] ┐
│ Medical Claim – Direct Staff  RM 120.00 used · limit RM 300.00 per transaction │
│ (other categories: no limit)                        │
└─────────────────────────────────────────────────────┘
┌ Filters: [Search claim no./title] [Status ▾] [Category ▾] [Year ▾] [From] [To] ┐
│            [EXPORT .CSV] [NEW CLAIM] [(CLEAR)] [SEARCH]                       │
│ Claim no.›     Title              Lines  Total (RM)  Status      Submitted   Disbursed on  Payment ref │
│ CL-2027-00102› KL client visits     3     245.60     ●Submitted  12/11/2027  —             —           │
│ CL-2027-00088› Parking Oct          1      80.00     ●Disbursed  02/11/2027  30/11/2027    7781        │
└───────────────────────────────────────────────────────────────────────────────┘
```
| Element | Specification |
|---------|---------------|
| Search | Claim no., title |
| Filters | Status (multi: New, Submitted, Approved, Disbursed, Rejected, Withdrawn, Cancelled) · Category (multi) · Year · Transaction date from–to |
| Columns | Claim no. › {CH1} · Title {CH3} · Lines · Total {CH5} · Status ● {CH8} · Flags ●(Over limit / Late / Possible duplicate / On behalf) {CH9} · Submitted {CH14} · Disbursed on {CH13} · Payment reference {CH13} · ⋮ |
| Row actions | New → `EDIT`, `SUBMIT`, `DELETE` · Submitted → `WITHDRAW` · Rejected → `COPY TO NEW CLAIM` |
| Utilisation panel (F-CLM-20) | Per category with a limit: Category · Period (transaction / month / year) · Used (RM) · Limit (RM) · Remaining; period follows the limit-refresh day; categories without limits collapsed "No limit" |
| Reminder | New claims older than 90 days: banner "1 claim saved more than 90 days ago is still not submitted" (BR-CLM-27) |
| Empty | "No claims yet." `[NEW CLAIM]` |
| Phone card | "CL-2027-00102 · ●Submitted" / title / "3 lines · RM 245.60" / "Submitted 12/11/2027" |

## P13 · Claim form — create / edit New — S-PT-13 · `/my/claims/new`, `/my/claims/{no}/edit` · F-CLM-04–08, F-CLM-19, F-PRT-05 · US-CLAIM-005–010, US-PORTAL-006

```
┌──────────────────────────────┐
│ ← New claim       ●New       │  status chip after first save; "Copied from CL-…" if copy
├──────────────────────────────┤
│ Title / purpose *            │ {CH3} 0/120
│ [ KL client visits – Nov  ]  │
│ Project / customer ref       │ {CH4} 0/60
│ [                         ]  │
│ Lines (3)                    │
│ ┌ 1 Business Travel – Taxi… ┐│
│ │ 03/11/2027   RM 32.50 📎1 ││  tap → line editor S-PT-14
│ │ ✓ Within limit            ││  {CLN16}
│ └───────────────────────────┘│
│ ┌ 2 Employee Transport (km) ┐│
│ │ 05/11/2027 42.5 km RM 25.50││
│ └───────────────────────────┘│
│ ┌ 3 Medical Claim – Direct ─┐│
│ │ 08/11/2027  RM 350.00 📎1 ││
│ │ ⚠ Exceeds RM 300.00 per transaction │  block
│ └───────────────────────────┘│
│ [+ ADD LINE]                 │
├──────────────────────────────┤
│ Total excl. SST   RM 395.11  │ {CH7}
│ SST               RM   12.89 │ {CH6}
│ Total             RM  408.00 │ {CH5}
│ [(SAVE)]       [SUBMIT]      │ sticky
│ Delete claim                 │ (New only, text button)
└──────────────────────────────┘
```
| # | Field / control | Rules |
|---|-----------------|-------|
| CH1 | Claim no. | Assigned at first `SAVE` (CL-yyyy-nnnnn); shown in header |
| CH2 | Employee | Self (hidden); on-behalf variant S-CL-02 shows picker |
| CH3 | Title / purpose * | 1–120 chars |
| CH4 | Project / customer reference | Optional, 60 |
| — | Lines list | 1–50 lines; each card: line no. · category · transaction date · amount (and km for mileage) · attachment count · limit/duplicate result chip; swipe/⋮ → Edit · Duplicate line · Delete line |
| CH5–CH7 | Totals | Live Σ |
| CH16 | Copied from | "Copied from CL-…" chip (read-only) |
| `SAVE` | Saves as **New** (first save creates CL no.); allowed with incomplete lines? — **No**: each line must pass its own field validation to save; claim-level submit rules (limits, deadline, receipts) are checked on SUBMIT | Saving at any step keeps everything entered (FR-PRT-05) |
| `SUBMIT` | Saves then validates BR-CLM-10–22 server-side; blocks listed per line in a summary card ("Line 3: Exceeds RM 300.00 per transaction"); warnings (Warn limits, possible duplicate) need `[x] I understand` | Success → S-PT-15 with "Submitted — waiting for approval by {manager} or an Admin." |
| `DELETE` | New only; confirm "Delete CL-…? This cannot be undone." `[DELETE CLAIM]` | FR-G-08 |

## P14 · Claim line editor — S-PT-14 · dialog / full-screen sheet on phone · F-CLM-04/05/06 · US-CLAIM-005–007

Fields appear dynamically from the category (CC5–CC13):
| # | Field | Control | Shown / required when | Rules |
|---|-------|---------|----------------------|-------|
| CLN2 | Category * | Select grouped by CC3 group; CC4 policy text below | always | Active, eligible categories only (BR-CLM-18) |
| CLN3 | Date of transaction * | Date | always | ≤ today; older than deadline → error "Older than 60 days — Admin override required" (unless an override exists, then chip "Late (override)") |
| CLN14 | Claimant | Select Self / Spouse / Child (name) | CC13 = Employee and dependants | sensitive for Medical |
| CLN10 | From * · To * · Purpose * | Text ×3 | mileage (CC10) or CC12 | — |
| CLN11 | Distance (km) * | Decimal 0.1–2,000 | mileage | — |
| CLN12 | Rate (RM/km) | Read-only "RM 0.600/km" | mileage | rate effective on transaction date |
| CLN8 | Amount incl. SST (RM) * | Money | always | read-only for mileage = round(km × rate, 2); > 0 and ≤ 99,999.99 |
| CLN9 | SST amount (RM) | Money, label "To include SST" | CC9 = Yes | 0 ≤ SST ≤ amount |
| CLN5 | Merchant / vendor | Text 100 | CC12 includes Merchant (then *) | — |
| CLN6 | Tax invoice / receipt / e-Invoice no. | Text 50 | CC7 Optional / Required | duplicate check on submit (BR-CLM-17) |
| CLN7 | MyInvois UUID | Text 40 | CC8 Optional / Required | unique (BR-CLM-16) — error names the existing claim |
| CLN13 | Client / attendees | Text 300 | CC12 includes Client | — |
| CLN4 | Description / notes | Text 500 | CC6 = Yes → * | foreign currency hint "Enter MYR; note original currency and amount" (BR-CLM-19) |
| CLN15 | Receipts | `[📷 TAKE PHOTO] [📎 CHOOSE FILE]`, ≤ 5, thumbnails | CC5 = Yes → * on submit | JPG/PNG/HEIC/PDF ≤ 10 MB; compressed on device where possible |
| CLN16 | Limit check | Read-only chip after amount entry | category has a limit | "Within limit (RM 120.00 of RM 300.00)" / "Over limit by RM 50.00 (blocked)" / "(warning)" |
| CLN18 | Cost centre | Select | Could — only if cost centres exist | default employee's |
Buttons: `[(CANCEL)] [SAVE LINE]` · `SAVE & ADD ANOTHER`. Category change clears fields that no longer apply (confirm if values would be lost).

## P15 · Claim detail (own) — S-PT-15 · `/my/claims/{no}` · F-CLM-08/13/29 · US-CLAIM-011, 016, 029
Header: Claim no. {CH1} · Status ● {CH8} · Flags {CH9} · Title {CH3} · Project {CH4} · Totals {CH5–CH7} · Copied from {CH16}.
Lines table (phone: cards): Line · Category · Date · Description/merchant · Receipt no. · UUID · km (mileage) · Amount · SST · Receipts 📎 (tap → viewer) · Limit result.
**Status timeline** (side card / bottom on phone): Created (New) dd/mm/yyyy HH:mm · Submitted {CH14} · Approved/Rejected by {name} at … + reason {CH15} · Cancelled by … + reason · Included in batch PB-… / payroll run PR-… {CH12}, planned payment date · Disbursed {CH13} date + HLB payment reference · (Undo disbursement: "Payment reversed — {reason}; will be paid in the next batch").
Actions by status: New → `EDIT`, `SUBMIT`, `DELETE` · Submitted → `WITHDRAW` (confirm "Withdraw CL-…? It leaves the approval queue and stops counting toward your limits." `[WITHDRAW]`) · Rejected → `COPY TO NEW CLAIM` (→ S-PT-13 with copy) · Approved/Disbursed/Withdrawn/Cancelled → none. Footer (FR-G-13).

---

## P16 · My profile — S-PT-16 · `/my/profile` · F-PRT-08, F-EMP-03/06/07/20 · US-PORTAL-008, US-EMP-004, 006, 018

Header card: photo {A16} (`CHANGE PHOTO` E✎) · Full name {A2} · Preferred name {A3} · Employee no. {A1} · Position {F11} · Department {F10} · Manager {F13} · Status ● {F9} · Join date {F1} · Length of service {F24}.
Tabs (phone: horizontal scroll chips). ✎ = edit inline (`EDIT` → fields editable → `SAVE`/`CANCEL`); **CR** = read-only with `REQUEST CHANGE` → S-PT-17 pre-filled with that category; 🔒 = read-only.

| Tab | Fields shown to the employee (own) |
|-----|------------------------------------|
| Personal | A1 🔒 · A2 CR · A3 ✎ · A4 MyKad (full to owner, displayed `YYMMDD-PB-###G`) CR · A5 DOB 🔒 · A6 Age 🔒 · A7 Gender 🔒 · A8 Nationality 🔒 · A9/A10 Race CR · A11 Religion CR · A12/A13 Marital status + effective date CR · A14 OKU CR · A15 OKU card no. CR · A17 Passport no. ✎ · A18 Passport expiry ✎ · A19 Highest qualification ✎ |
| Contact & emergency | B1 Work email 🔒 · B2 Personal email ✎ · B3 Mobile ✎ · B4 Work phone 🔒 · B5–B10 Residential address ✎ · B11 Mailing same as residential ✎ · B12 Mailing address ✎ (if B11 = No) · Emergency contacts C1–C7 ✎ (table: Priority · Name · Relationship · Mobile · Alternate · Email · Next of kin; `ADD CONTACT` up to 3; delete blocked on the last one) |
| Family | Spouses D1–D9 (table; D9 phone ✎, others CR) · Children E1–E9 (table, CR) · Derived E10–E12 🔒 · `REQUEST CHANGE` (category Marital status & spouse / Children) |
| Employment | F1, F2, F3, F4, F5, F6, F8, F9, F10, F11, F12, F13, F15, F16, F17, F18, F19, F21, F24, F26, F27 🔒 · Job history (own, read-only; columns per §5.5 list minus "Entered by") · Separation G1, G2, G5 (if recorded) 🔒 · Prior employment L2 ✎ (table Employer · Position · From · To; `ADD`) |
| Statutory & tax | H1, H3, H4, H5, H11, H13, H15, H16, H17, H19, H21, H22, H23, H26, H28–H31, H33, H34 🔒 (CR for H3, H5, H15–H17, H23, H28–H31, H33–H34 via category "Statutory numbers") — employer-only flags (H2, H14, H18, H20, H24, H25, H27, H32) **not shown** |
| Bank | I1 🔒 · I2 CR · I3 CR · I4 `••••••1234 [Show]` (own reveal, logged) CR · I5 CR · I7 🔒 · I9 ASNB `••••[Show]` CR · `REQUEST CHANGE` (category Bank details) |
| Leave | Link cards → S-PT-05 balances, S-PT-03 applications |
| Claims | Link → S-PT-12 |
| Documents | → S-PT-19 |
| Change requests | → S-PT-18 |
| Compensation (R1.1) | CP1 current basic salary (hidden until `Show`) · CP2 effective date · CP5 recurring items (item · amount · start · end) 🔒 |

Self-update save: success toast "Saved. HR has been notified." (N-40). Validation per BR-EMP-08/09 (e.g. "Postcode must be 5 digits", "At least one emergency contact is required").
**Employee who holds ADM** (EC-EMP-10): own record uses this screen; CR fields cannot be edited directly even from admin screens.

## P17 · Request a change — S-PT-17 · `/my/profile/change-requests/new?category=` · F-EMP-19 · US-EMP-017
| # | Field | Control | Rules |
|---|-------|---------|-------|
| CR2 | Category * | Select: Legal name / MyKad / Marital status & spouse / Children / OKU / Religion / Race / Bank details / Statutory numbers | One open CR per category — if one exists: "You already have an open request for {category} (CR-…). Cancel it first or wait for HR." (EC-EMP-07) |
| CR3 | Changes * | Table per category: Field · Current value (masked where sensitive) · New value (input using the field's own control and validation) | At least one new value; e.g. Bank: I2 Bank ▾, I3 Type ▾, I4 Account no., I5 Holder name (name-match warning), I9 ASNB · Children: add/edit/remove child rows (E1–E9) · Marital: A12, A13 + spouse rows (D1–D8) |
| CR4 | Effective date * | Date, default today | Marital status may be past-dated ≤ 90 days |
| CR5 | Supporting document(s) | Camera / file, multiple | * for Legal name, MyKad, Marital status, Children, OKU, Bank (proof) — label tells which document ("Marriage or divorce certificate") |
| CR6 | Remarks | Text 0/500 | — |
Buttons `[(CANCEL)] [SUBMIT REQUEST]` → N-43 to Admins. Success: "Request CR-… submitted. HR will review it."

## P18 · My change requests — S-PT-18 · `/my/profile/change-requests` · US-EMP-017
List: Search CR no. · Filters Status (Submitted / Approved / Rejected / Cancelled), Category, Submitted from–to · Columns CR no. › · Category · Submitted at · Effective date · Status ● · Decided at · ⋮ (`CANCEL REQUEST` while Submitted) · `NEW REQUEST` · `EXPORT .CSV`. Detail: CR3 changes (current → new, masked) · CR4 · CR5 attachments (visible to the employee until decided; after decision HR-only — shows "Attachment kept by HR") · CR6 · Status · CR8 HR remarks · CR9 decided by/at.

## P19 · My documents — S-PT-19 · `/my/documents` · F-PRT-09 · US-PORTAL-009
List (only K5 = Visible): Search title · Filter Category · Columns Title {K2} › · Category {K1} · Document date / Expiry {K4} · Uploaded at {K7} · `DOWNLOAD` (logged) · `EXPORT .CSV` (list only). Tap title → in-browser preview (PDF/image). Empty: "HR hasn't shared any documents with you."

## P20 · Download my data — S-PT-20 · `/my/data-export` · F-PRT-16 · US-PORTAL-016
Text: "Download a copy of your personal data held in PRET: profile, family, leave, claims{, payslips}. The file is available here only (not emailed)." `[GENERATE MY DATA FILE]` → list: Requested at · Status (Preparing / Ready / Expired) · `DOWNLOAD` · Available until. Generation and download logged. File format → Architect.

---

## R1.1 — My pay

## P21 · My payslips — S-PT-21 · `/my/pay/payslips` · F-PRT-17, F-PAY-27 · US-PORTAL-018
List: Filter Year · Search month name · Columns Month (Nov 2028) › · Pay date · Net pay `RM •••• [Show]` (per row; FR-PRT-11) · Status (— / ●Revised dd/mm/yyyy) · `DOWNLOAD PDF`. `EXPORT .CSV` (Month, pay date, net pay, revised). Only Live, published payslips (Parallel never listed). Empty: "No payslips yet."

## P22 · Payslip viewer — S-PT-22 · `/my/pay/payslips/{month}` (ADM/SA: `/payroll/payslips/{id}`) · F-PAY-27
In-page PDF preview (§14.10 content) with `DOWNLOAD PDF` · `‹ previous month` / `next month ›`. Phone: summary card first (Gross · Total deductions · Net — Net hidden until `Show`), then `OPEN PDF`. ADM/SA viewing someone else's payslip: banner "Viewing is logged."

## P23 · My EA forms — S-PT-23 · `/my/pay/ea-forms` · F-PAY-29
List: Year of assessment › · Status (Issued / Re-issued dd/mm/yyyy) · Issued on · `DOWNLOAD PDF` · Filter year · `EXPORT .CSV`. Empty: "Your EA form for {year} will appear here once issued (by end of February)."

## P24 · My YTD statement — S-PT-24 · `/my/pay/ytd` · F-PAY-42 · US-PAY-042
Year selector. Summary cards: YTD Gross · EPF (employee) · SOCSO (employee) · EIS (employee) · PCB · Zakat. Monthly table: Month · Gross · EPF · SOCSO · EIS · PCB · Zakat · Net (Net hidden until `Show`). `EXPORT .CSV`. Includes imported opening YTD (T14) as a row "Before PRET (imported)".

## P25 · My TP1 declarations — S-PT-25 · `/my/pay/tp1` · F-PAY-16 (Should) · US-PAY-017
List: Year · Month · Relief/rebate type · Amount (RM) · Status (Submitted / Verified) · Submitted at · Verified by · Filters Year, Status · `NEW DECLARATION` · `EXPORT .CSV`. Form: Year * · Month * · Relief/rebate type * (LHDN TP1 list) · Amount (RM) * · Supporting document * · `SUBMIT` → N-36 to Admin. Submitted rows editable/deletable by employee until verified (FR-G-08 analogous — see UXQ-12).

---

# Approvals & team (MGR; inbox and decision views also ADM, SA)

## P26 · Approvals inbox — S-AP-01 · `/approvals` · F-PRT-11, F-LV-09/10/15, F-CLM-09/25/30 · US-PORTAL-011, US-LEAVE-014/015, US-CLAIM-012/015/028/030

```
┌ Approvals                                                                       ┐
│ [Leave (3)] [Cancellations (1)] [Replacement credits (0)] [Claims (2)] [Approved claims – not disbursed (5)] [Batches & runs (1)]* │
│ Filters: [Search ref/employee] [Department ▾] [Type ▾] [From] [To] [x] Only items pending my approval │
│                     [EXPORT .CSV] [(CLEAR)] [SEARCH]                            │
│ [ ] LV-2027-00031› Ben Lee  Dev  Annual 05/05–07/05 2.0d "Family trip" 📎 ●EMERGENCY 03/05 L1 2d │
│ 2 selected: [APPROVE SELECTED] [DECLINE SELECTED]                               │
└─────────────────────────────────────────────────────────────────────────────────┘
* "Batches & runs" tab: SA only, only when a disbursement batch (setting on) or payroll run (R1.1) awaits SA approval.
```
| Tab | Who sees which items | Columns | Filters | Actions |
|-----|---------------------|---------|---------|---------|
| **Leave** | Items where I am the current-level approver or delegate (MGR); ADM/SA: items at the Admin level + (toggle off "Only mine") all pending for override | [ ] · Reference › · Employee · Department · Type · From · To · Days · Reason · 📎 · EMERGENCY ● · Applied · Level (L1/L2) · Waiting (working days) | Type · Department · Location · Date range · Emergency only · Only items pending my approval (default on) | Row: `APPROVE` / `REJECT`; bulk `APPROVE SELECTED` / `DECLINE SELECTED` (BR-LV-64); `EXPORT .CSV` |
| **Cancellations** | Cancellation pending items routed to me (level-1 approver — setting) / ADM | Reference › · Employee · Type · From · To · Days · Requested at · Reason · Waiting | Type · Department · Date range | `APPROVE CANCELLATION` / `REJECT CANCELLATION` |
| **Replacement credits** | Pending credits routed to me / ADM | Credit no. › · Employee · Date worked · Day type · Duration · Days · Reason · Submitted · Waiting | Department · Date range | `APPROVE` / `REJECT` |
| **Claims** | MGR: Submitted claims of reportees + delegated; ADM/SA: all Submitted; claimant's own claims never actionable (shown read-only with "Your claim") | [ ] · Claim no. › · Employee · Department · Title · Lines · Total (RM) · SST (RM) · 📎 count · Flags ● · Submitted · Waiting | Department · Category · Amount from–to · Flags · Submitted date range · Only my reportees (default on for MGR) | Row `APPROVE` / `REJECT`; bulk `APPROVE SELECTED` / `REJECT SELECTED` (one comment); `DOWNLOAD ATTACHMENTS` (ADM/SA, S-CL-16); `EXPORT .CSV` |
| **Approved claims – not disbursed** | MGR: reportees; ADM/SA: all | Claim no. › · Employee · Title · Total (RM) · Approved on · Approved by · Batch / payroll run · Age (days) | Department · Approved date range · In batch (Yes/No) | Row `CANCEL` (reason mandatory, BR-CLM-26); `EXPORT .CSV` |
| **Batches & runs** (SA) | Disbursement batches Pending approval (setting on) · Payroll runs Pending approval (R1.1) | Ref › · Type · Period · Count · Total (RM) · Prepared by · Submitted at | — | Opens S-CL-11 / S-PY-08 |

Tab badges = actionable counts. Phone: tabs as a scrollable chip row; rows as cards; **no bulk on phone** (FR-PRT-07); tapping a card opens the decision view. After a decision the inbox advances to the next item ("Next ›"). Empty per tab: "Nothing waiting for you." Already decided by someone else: row disappears on refresh; opening it shows S-AP-04 banner (BR-CLM-25).

## P27 · Leave decision view — S-AP-02 · `/approvals/leave/{ref}` (also opened from S-LV-01) · F-LV-09/10/13/24/26/29 · US-LEAVE-014, 016, 020, 031, 032, 034, 042

```
┌ LV-2027-00031  ●Pending L1 of 2  ●EMERGENCY                     ┐
│ Ben Lee · INT-004 · Development · Software Engineer              │
│ Annual Leave · 05/05/2027 (Full) – 07/05/2027 (Full) · 2.0 days  │
│ Reason: Family trip   Contact: +60 12-345 6789   Cover: Aina     │
│ Applied 03/05/2027 09:12 · Waiting 2 working days                │
├ Balance (Annual, 2027) ──────────────────────────────────────────┤
│ Available 8.5 · This 2.0 · Other pending 1.0 · After approval 5.5 │
├ Team on leave on these dates ───────────────────────────────────┤
│ Aina — 06/05/2027 (on leave)    ⚠ 3 of 5 team members away (F-LV-29) │
├ Attachments ──── (MC viewing is logged) ─────────────────────────┤
├ Approval trail ──────────────────────────────────────────────────┤
│ L1 Direct manager — waiting (you)   L2 Admin — next               │
├──────────────────────────────────────────────────────────────────┤
│ Comment [                                  ] (required to reject) │
│ [(REJECT)]  [APPROVE]          ⋮ Reassign approver (ADM)          │
└──────────────────────────────────────────────────────────────────┘
```
Content: all LA fields the role may view (LA1–LA21; MGR sees LA11 MC attachment only for the item being approved — Q18 default, with "Viewing is logged" notice; Sick/Maternity labelled with the real type for the approver). Balance panel (type balance at approval). Overlap card: other team members on leave on any of the dates (approved + pending), team-absence warning if threshold exceeded (Could). Maternity: HR-only card "Maternity allowance eligibility: Eligible / Not eligible / Check" (BR-LV-42; ADM/SA only). Trail with "Acting as delegate of …", "Re-routed: approver on leave".
Actions by role/state:
| State | MGR (current approver/delegate) | ADM | SA |
|-------|-------------------------------|-----|----|
| Pending at my level | `APPROVE` (comment optional) · `REJECT` (comment *) | at Admin level: `APPROVE`/`REJECT`; at L1: `APPROVE AS ADMIN (OVERRIDE)` (reason *) — UXQ-10 · `REASSIGN APPROVER` — UXQ-05 · `WITHDRAW ON BEHALF` (reason *) | as ADM |
| Cancellation pending | `APPROVE CANCELLATION` · `REJECT CANCELLATION` (comment *) | same + `CANCEL ON BEHALF` | same |
| Approved | — | `CANCEL ON BEHALF` (reason *) | same |
| Any (Sick/HL with MC) | — | MC verified {LA20} select: Not checked / Verified / Invalid (Invalid → N-14) | same |
| Own application | read-only banner "You can't decide your own leave." | | |
Concurrency: if the item moved on, banner "Already decided by {name} at dd/mm/yyyy HH:mm" and actions hidden.

## P28 · Replacement-credit decision view — S-AP-03 · `/approvals/credits/{no}` · US-LEAVE-022
Header: Credit no. · ●Pending · Employee · Date worked (+ day type chip "Rest day"/"PH: …") · Duration · Credit days · Reason · Attachment · Submitted · Expiry if approved. Employee's RL balance now. Comment field. `[(REJECT)] [APPROVE]` (reject comment *). ADM extra: `COMPENSATE BY PAY` toggle with hours (BR-LV-84) — passed to payroll input instead of credit.

## P29 · Claim decision view — S-AP-04 · `/approvals/claims/{no}` (also from S-CL-01) · F-CLM-09/23/30 · US-CLAIM-012, 022, 028, 030

```
┌ CL-2027-00102  ●Submitted  ●Over limit  ●Possible duplicate     ┐
│ Ben Lee · INT-004 · Development · "KL client visits – Nov"       │
│ Project: ACME rollout · Submitted 12/11/2027 10:40 · Waiting 1 d │
│ Total RM 408.00 · SST RM 12.89 · Excl. SST RM 395.11             │
├ Lines ───────────────────────────────────────────────────────────┤
│ 1 Business Travel – Taxi  03/11  RM 32.50  Rcpt 88123  [🧾 view] │
│   ✓ Within limit                                                   │
│ 3 Medical – Direct Staff  08/11  RM 350.00  [🧾]                  │
│   ⚠ Over limit by RM 50.00 (warn)   ⚠ Same receipt no. on CL-2027-00077 │
├ Receipt viewer (tap 🧾): full screen, pinch-zoom, rotate, ‹ › between receipts ┤
├ Reason (required to reject) [                                 ]  │
│ [(REJECT CLAIM)]   [APPROVE CLAIM]                                │
└──────────────────────────────────────────────────────────────────┘
```
Content: header CH1–CH16 the role may view; lines with all CLN fields (CLN14 dependant medical shown to MGR as "Medical" only — Q18; CLN17 tax/GL to ADM/SA only, after approval); flags with explanation; employee's utilisation for the categories on the claim.
Actions:
| Claim status | MGR (reportee; not own) | ADM | SA |
|--------------|-------------------------|-----|----|
| Submitted | `APPROVE CLAIM` · `REJECT CLAIM` (reason *) — amounts read-only; no Return (BR-CLM-21) | same | same |
| Approved (not disbursed) | `CANCEL CLAIM` (reason *) | same | same |
| Disbursed | — | `UNDO DISBURSEMENT` (S-CL-14) | same |
| Own claim (any role) | read-only "You can't decide your own claim." | | |
First decision wins (BR-CLM-25): if someone acted first → banner "Already decided by {name} at dd/mm/yyyy HH:mm"; buttons removed; nothing changes.

## P30 · Decision dialog — S-AP-05 · F-LV-09, F-CLM-09/25/30 · US-LEAVE-015, US-CLAIM-015
Single: "Approve LV-…?" / "Reject CL-…?" — Comment (approve: optional 0/500) / Reason (reject, cancel: * ≥ 5 chars, 0/500) · `[(BACK)] [APPROVE]` / `[REJECT CLAIM]` / `[CANCEL CLAIM]`.
Bulk: "Approve 4 selected claims" — one comment/reason for all · confirm → **result table**: Reference · Result (✓ Approved / ⤳ Moved to L2 / ✕ Skipped) · Note ("Your own claim" / "Already decided by …" / "Not at your level"). `[DONE]`.

## P31 · My team — S-AP-06 · `/team` · F-PRT-12 · US-PORTAL-012
List: Search name/employee no. · Filters Department · Direct only / include indirect (default include) · Today status (On leave today / This week) · Columns Employee › (photo, name, employee no.) · Position · Department · Today (●On leave / ●On leave AM / —) · This week (dates) · AL available · SL available · RL available · Pending items (count) · `EXPORT .CSV`. Header summary: Team size · On leave today · This week. Tap → S-AP-07.

## P32 · Team member (limited profile) — S-AP-07 · `/team/{employeeNo}` · F-EMP-03 (M) · US-EMP-004, US-ADMIN-021
Only fields with **M** in PRD view columns: Photo A16 · Employee no. A1 · Full name A2 · Preferred name A3 · Gender A7 · Work email B1 · Mobile B3 · Work phone B4 · Emergency contacts C1–C5 (Q26) · Employment F1, F3, F4, F5, F6, F8, F9, F10, F11, F12, F13, F15, F16, F17, F18, F19, F24, F27 · Separation G1, G2, G5 (if any) · Leave: balances (all types; Sick/Maternity labelled "Medical" in calendar only) + applications (team scope) · Claims (team scope list). **Never shown:** MyKad, DOB, religion, race, OKU, family, statutory, bank, documents, notes, compensation. Action: `RECORD PROBATION RECOMMENDATION` (On Probation only) → S-AP-08. A non-reportee URL → S-GL-10 (logged).

## P33 · Probation recommendation — S-AP-08 · dialog · F-EMP-11 · US-EMP-010
Shows probation end {F5}/{F6}, days left. Fields: Recommendation * (•) Confirm (•) Extend probation (•) Do not confirm · Suggested extension (months, 1–9, shown if Extend; total ≤ 12) · Remarks * (0/1000). `[SUBMIT RECOMMENDATION]` → visible to ADM on S-EM-03 Employment tab and S-RP-07 "Recommendation" column; Admin still confirms/extends (S-EM-06). Values are a UX proposal — UXQ-11.

---

## Open UX questions touching this file
UXQ-01 (landing for ADM/SA employees), UXQ-04 (reason for cancellation request), UXQ-05 (reassign approver), UXQ-07 (phone bottom bar), UXQ-08 (partial cancellation), UXQ-10 (Admin override), **UXQ-11** (probation recommendation values: Confirm / Extend / Do not confirm — PRD names the action but not its options), **UXQ-12** (TP1: can the employee edit or withdraw a declaration before Admin verifies it, and can Admin reject one? PRD lists only "verified by A"; default: employee may edit/withdraw until verified; Admin can verify or return with a remark). Full list in `screen-inventory.md`.

## Ready for GATE 2 (design)?
All EMP and MGR screens (R1.0 and R1.1) specified at field level, phone-first, with actions per status and role. **Yes.**
