# PRET — Dashboard Visuals

**Work item:** W1-005 · **Author:** UI Designer · **Status:** Draft for GATE 2 (Design)
**Last updated:** 15/11/2026
**Styles:** Employee/Manager Home (S-PT-01), My balances (S-PT-05), Approvals inbox (S-AP-01), Admin dashboard (S-RP-01), batch detail (S-CL-11). **Tokens:** [`design-system.md`](design-system.md). **Components:** [`components.md`](components.md).

> Visual treatment only. Content, tile lists, click targets and empty/loading rules come from
> the UX wireframes (`wireframes-portal.md` P1/P5/P26, `wireframes-reports.md` R1,
> `wireframes-claims-admin.md` C11) and are not changed here. Light theme. Numbers use
> `tabular-nums`. Dates dd/mm/yyyy; money RM 1,234.56; leave days 1 dp ("8.5 d" in tiles).

---

## 1. Shared tile anatomy

All dashboard tiles are `Card`s (white, 1 px `#E4E6EC`, radius 8, shadow level 1) that load independently (own skeleton, own "Couldn't load — [RETRY]").

| Part | Spec |
|---|---|
| Padding | 16 (phone) / 20 (desktop) |
| Label | `h6` 16/24 (or `caption` uppercase overline for dense KPI strips), `text.secondary` |
| Value | `kpi` 28/36, 700, `text.primary`, tabular. Unit/suffix ("d", "RM") `body2` 500 `text.secondary` |
| Sub-line | `caption` 12/18 `text.secondary` (e.g. "as at 15/11/2027 09:30") |
| Accent | 4 px left bar in a tone/leaveType colour (decorative — meaning also in the text). Never text on the bar |
| Click target | Whole tile is a link (`CardActionArea`), `Link`-coloured drill-in affordance `›` 16 px (`#4548C9`); min height 88 (phone, >= 44 touch); focus ring per `design-system.md` §7 |
| Skeleton | Same outer size; label + value bars `#ECEEF3`; no layout shift |
| Error | Inline small `Alert severity="error"` "Couldn't load — [RETRY]" inside the tile |
| Zero value | Shown as `0`, never hidden; alert tiles at 0 use the neutral (grey) accent |
| Tile grid | CSS grid `repeat(auto-fill, minmax(176px, 1fr))`, gap 16; phone 2-up (min 160); KPI strips of up to 6 across at >= 1280 |

Tone usage for accents/values (never the only cue): grey = neutral count, indigo = action needed by me, warning (amber) = waiting/at risk, error (red) = blocking/overdue, success (green) = done/healthy, info (blue) = informational.

---

## 2. Employee Home (S-PT-01)

Phone-first single column at 360 px; desktop 12-col grid (left 8: balances, pending, upcoming; right 4: quick actions, holidays, recent claims, payslip).

```
Hi, Aina  [Manager]                                   ← h5 + role chip, no card
┌ Leave balances ─────────────── All › ┐   ← horizontally scrollable tiles, scroll-snap
│ [Annual] [Sick] [Replacement] ...    │
```

### 2.1 Leave-balance card (one per visible leave type, display order LT34)

```
┌──────────────────────┐   width 168 (phone, horizontal scroll, snap start)
│▌● Annual leave       │   4px accent = leaveType colour; ● 10px dot same colour; name 14/20 600
│  8.5 d               │   Available — 28/36 700 tabular; "d" 14/20 500 secondary
│  Available           │   caption
│  6.0 earned to date  │   caption, only under accrual
│ ┌──────────────────┐ │
│ │⚠ 3.0 expires    │ │   expiring CF/credits within 30 days: tonal warning strip
│ │  31/03/2028      │ │   bg #FFF1DB, text #7A4100 (7.30:1), icon WarningAmber 16
│ └──────────────────┘ │
└──────────────────────┘
```
- Colour per type from `palette.leaveType[LT32 index]` (8 AA-safe swatches on white >= 3 : 1; text never sits on a swatch). The type name is always written, so colour is a decoration only.
- Desktop: cards wrap in a grid (min 200 wide); phone: horizontal scroll with `scroll-snap-type: x mandatory`, 16 px peek of the next card so scrolling is discoverable; "All ›" link top-right (44 px hit).
- Available <= 0: value in `text.primary` with "0.0 d"; negative allowed: value `#B42318` with `−` sign and a `caption` "Allowed down to −2.0".
- Tap -> ledger (S-PT-06). Eligible-but-"approval only" types show "Approval only" instead of a number (`body2` `text.secondary`).
- Empty: "No leave types available yet — contact HR" in one `EmptyState` card spanning the row. Loading: 3 skeleton cards.
- Detail page S-PT-05 reuses the card with the components list (Entitled / CF / Earned / Adjusted / Taken / Pending / Expired) as a two-column key-value list under the number.

### 2.2 Quick actions
2 x 2 grid of buttons (`APPLY LEAVE` primary, `NEW CLAIM` primary, `REQUEST REPLACEMENT CREDIT` and `MY PAYSLIPS` outlined neutral), each 48 px high, full cell width on phone. Icons 20 px. (Outlined for secondary so a single visual priority pair remains.)

### 2.3 Pending-claims tile and "My pending items"
Tile "Pending claims": `kpi` count of New + Submitted claims, sub-line "RM 245.60 awaiting approval" (money `body2`), accent amber; tap -> My claims filtered Submitted. "My pending items" card: up to 5 rows, each row 56 px: reference link (`#4548C9`) + short label left, `StatusChip` right (leave Pending L1, claim Submitted, change request Submitted, credit Pending); "See all" text button. Empty: "Nothing pending".

### 2.4 Other Home cards
- **Upcoming leave (next 3):** type dot + "Annual · 05/05/2027 – 07/05/2027" + "2.0 days".
- **Public holidays (next 3):** day-of-month in a 40 px rounded date block (`#EDEDFE` bg, `#3A3FBF` text 6.86 : 1, month in `caption`) + name + weekday, "Selangor" label as a grey outlined chip.
- **Recent claims (last 3):** claim no. link, title, total (RM, right aligned), status chip.
- **Latest payslip (R1.1):** "Nov 2028 · pay date 30/11/2028"; Net `RM ••••` with `Show`.

---

## 3. Manager panel and approvals queue

### 3.1 Manager panel (Home, MGR only; also dashboard top strip)
Card titled "Manager" with 5 rows (label left, count right `kpi`-small 20/28 700, chevron), each 56 px and a link:
Approvals waiting (indigo accent when > 0) · Team on leave today · Team on leave this week · Probation due in team (<= 30 days; amber accent when > 0) · Team claims Submitted. Counts at 0 show grey `0`.

### 3.2 Approvals queue visual (S-AP-01)
- **Tab chip row** (phone) / tabs (desktop): Leave · Cancellations · Replacement credits · Claims · Approved claims – not disbursed · Batches & runs (SA). Each tab carries an actionable-count badge: pill `#5A5FF2` / white (4.82 : 1) when the count is "waiting on me"; `#ECEEF3`/`#374151` otherwise; hidden tabs have no badge.
- **Row/card** (phone): title = reference link; right = flags chips (`EMERGENCY` solid red first); line 2 "Ben Lee · Development"; line 3 "Annual · 05/05 – 07/05 · 2.0 d"; line 4 `caption` "Applied 03/05/2027 · L1 · waiting 2 d" — waiting time >= 3 working days turns the text `#7A4100` and prefixes a `Schedule` icon (not colour alone); claims show "RM 245.60" bold right-aligned and a 📎 count badge. Whole card taps to the decision view; swipe is not used.
- **Desktop rows:** DataGrid with `[ ]` selection, columns per UX, row actions `APPROVE` (success, small) and `REJECT` (danger outlined, small) inline plus 👁; bulk bar per `components.md` §6.2.
- **Decision view:** header card (reference, chips, employee) + decision panel (`components.md` §8) + balance preview + trail. After a decision: toast "Claim approved." then the next item loads ("Next ›"); progress "3 of 7" `caption`.
- Empty per tab: "Nothing waiting for you." with a 48 px outline `TaskAlt` icon.

---

## 4. Admin dashboard (S-RP-01)

Page title "Dashboard", right-aligned `caption` "as at 15/11/2027 09:30" + refresh icon button (44 px, `aria-label="Refresh dashboard"`). Sections are labelled with `overline` rules, in the UX order: **HR**, **Claims**, **Payroll (R1.1)**.

### 4.1 KPI tiles (HR)
Active headcount · On leave today · Pending leave approvals · Probation ending <= 30 days · Missing payroll data · Change requests · PH calendar status.

| Tile | Value | Accent / emphasis rule |
|---|---|---|
| Active headcount | `kpi` | indigo (neutral count) |
| On leave today | `kpi` | info (blue) |
| Pending leave approvals | `kpi` + secondary "(n at Admin level)" | amber when > 0 |
| Probation ending <= 30d | `kpi` | amber when > 0 |
| Missing payroll data | `kpi` | amber when > 0; red only if R1.1 and a run is open |
| Change requests | `kpi` | amber when > 0 |
| PH calendar {year+1} | status chip (Draft warning outlined / Published success) + "publish by 31/12" | amber from 01/11 (N-58) |

Layout: strip of tiles, 3 across at 1024, 4–6 across at >= 1280; phone 2-up. Each tile click target per UX.

**Alerts card** (under the strip): list of up to 4 alert rows, each = icon (`WarningAmber`, amber `#B45309`) + message + `›` link — "2 reportees without an active manager", "External access ends in 7 days" (SA), "Statutory table not verified" (R1.1). Container `#FFF1DB` border `#B45309` only when at least one alert; otherwise hidden. Text `#7A4100` (7.30 : 1).

### 4.2 Claims KPI strip
Five count tiles: Submitted · Approved (not disbursed) · Disbursed · Rejected, plus a money row: **Excl. SST RM 18,204.11 · SST RM 612.40 · Total RM 18,816.51** (money in `kpi`-small 20/28 700, right-aligned in a 3-column key-value block, thousands separators, 2 dp). Period selector `ToggleButtonGroup` (This month / Last month / Year; 44 px phone) at the strip's right.

Highlight tiles (wider, with sub-values):
- **Awaiting approval:** count 6 + "RM 1,204.10" -> Approvals Claims tab. Amber accent.
- **Approved not disbursed:** count 11 + "RM 2,140.60" -> report. Info accent; aged items (> 30 days) show `caption` "2 older than 30 days" with a clock icon.
- **Current month-end batch:** `PB-2027-011` link, `StatusChip` (Exported), next-step line "Next: mark disbursed" (the step maps from status: Draft -> "Generate outputs", Pending approval -> "Awaiting Super Admin", Approved -> "Generate outputs", Exported -> "Mark disbursed", Disbursed -> "Done"); warning flag chip "Outputs out of date" (solid amber) when applicable. Accent follows the status tone.

### 4.3 Payroll panel (R1.1)
- Current run tile: `PR-2028-11-01` link + status chip + "3 exceptions" (red text `#B42318` + `ErrorOutline` icon when > 0), parallel/live mode chip.
- Statutory due-dates tile: list "EPF 15/12/2028 · SOCSO/EIS 15/12/2028 · PCB 15/12/2028" with days-remaining `caption`; <= 3 days -> amber text + clock icon.
- **Gross / net — last 6 months** bar chart (below).

### 4.4 Chart spec — gross / net, last 6 months
MUI X Charts `BarChart`, grouped bars, 2 series. Gross = `#5A5FF2` (indigo), Net = `#198754`; both on white (4.82 / 4.53 non-text >= 3 : 1); series are also distinguished by **order and direct labels** (value above each bar at >= 600 px; legend always visible with text). Axis: months "Jun 2028" (`MMM yyyy`), Y axis `RM 0 – 200k` short labels; gridlines `#E4E6EC`; bars radius 4 top; tooltip shows "Nov 2028 · Gross RM 182,400.00 · Net RM 151,230.55". Height 240 (phone 200). Net pay/salary totals are sensitive: tile shows `RM ••••` with `Show` for ADM view until revealed (per UX net pay masking). **Table alternative:** a "View as table" text button toggles a `Table` of the same 6 rows (chart `aria-hidden` while the table is shown; the chart also has `role="img"` with an `aria-label` summary).

---

## 5. Month-end disbursement summary (S-CL-11 header + C9 list highlight)

Header card of the batch detail:

```
┌ PB-2027-011 · November 2027 · cut-off 30/11/2027        [Exported] [Outputs out of date] ┐
│ ┌ Claims ─┐ ┌ Employees ┐ ┌ Total ────────┐ ┌ SST ──────┐ ┌ Planned payment ┐             │
│ │   11    │ │     6     │ │ RM 2,140.60   │ │ RM 58.10  │ │ 01/12/2027      │             │
│ └─────────┘ └───────────┘ └───────────────┘ └───────────┘ └─────────────────┘             │
│ Prepared by Aina 30/11/2027 17:02                                                          │
│ ⚠ Outputs out of date — CL-2027-00099 was cancelled after export                          │
│ [GENERATE OUTPUTS] [MARK DISBURSED] [(SUBMIT FOR APPROVAL)] [⋮ Cancel batch]              │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```
- **Summary metrics** are inline stat blocks (not nested cards): label `caption`, value `h5`/`kpi`-small, tabular. Money right-aligned within its block, 2 dp. Phone: 2-column grid.
- **Progress stepper** under the title (the status path set by the "approval" setting): `Draft -> (Pending approval -> Approved ->) Exported -> Disbursed` as horizontal `Stepper` (phone: vertical compact list with current step bold). Completed = `#198754` check, current = `#5A5FF2` filled circle, future = `#8F95A3` outline; labels always visible; `aria-current="step"`. A Cancelled batch replaces it with a grey outlined chip.
- **Warning banner** (out-of-date outputs): amber `Alert` (§11 of components). `MARK DISBURSED` is shown disabled with tooltip "Outputs out of date — regenerate first" (UX).
- **By employee** table beneath uses the standard table; the account column is masked `••••1234`; "Bank changed after export" cell gets an amber `WarningAmber` icon + text.
- **Batches list highlight (S-CL-09):** the open batch row has a 3 px indigo left border and its Status chip; no other decoration.
- **Mark-disbursed dialog:** summary line in a `#E6F4EC` panel with `#0F6B40` text (5.79 : 1): "11 claims for 6 employees, RM 2,140.60 will become Disbursed and each employee will be notified." Confirm `MARK DISBURSED` (success).

---

## 6. Charts, colour and accessibility rules (all dashboards)

| Rule | Spec |
|---|---|
| Palette | Categorical series use `palette.leaveType` order; status series use tone `solid` colours; max 6 series; grid `#E4E6EC`, axis text `text.secondary` 12/18 |
| Colour is never alone | Every series/segment has a direct label, legend text or table value; chips and tiles carry words |
| Alternatives | Each chart has "View as table" and an `aria-label` summary; tiles are real text numbers |
| Contrast | Chart marks >= 3 : 1 vs white; text >= 4.5 : 1 (see `design-system.md` §9); text on tonal tile strips verified (amber 7.30, green 5.79, blue 6.51, red 6.93) |
| Motion | Charts render without animation when `prefers-reduced-motion` |
| Touch | Tiles, tabs, legend toggles >= 44 px on phone; chart tooltips triggered on tap-and-hold, never required to read data |
| Loading | Skeleton per tile; chart area shows a grey rect with the axis frame |
| Numbers | 28/36 700 tabular; thousands separators; units written ("days", "RM") |
| Sensitive | Net pay, salary: masked `RM ••••` + `Show`; sensitive tiles show a `Lock` icon with tooltip "Access is logged" |

---

## Open UI questions for Albert

1. **Leave-type colours (LT32):** the 8 AA-safe swatches (indigo, green, blue, orange, purple, teal, pink, brown) are assigned by display order. Do you want fixed colours per Interact leave type (Annual, Sick, Hospitalisation, ...)?
2. **Amber highlight on Admin dashboard:** tiles turn amber when a count is > 0 (pending approvals, probation, missing payroll data). Too noisy for a normal week? Alternative: neutral grey unless overdue.
3. **Gross/net chart colours** (indigo/green) vs a single indigo with a lighter tint for net: preference? (Both pass; the current choice maximises separation.)
4. **Aged-claim threshold** (30 days "older than") is a design default; confirm or point to a setting.

## Ready for GATE 2 (design)?

Employee leave-balance cards, pending-claims tile, manager approvals queue, Admin dashboard KPIs (HR, claims, payroll) and the month-end disbursement summary are styled to the wireframes, with accessibility rules and chart alternatives. **Yes — ready for GATE 2 review**, subject to the open UI questions above.
