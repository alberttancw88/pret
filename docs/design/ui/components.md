# PRET — Component Specs (MUI mapping)

**Work item:** W1-005 · **Author:** UI Designer · **Status:** Draft for GATE 2 (Design)
**Last updated:** 15/11/2026
**Styles:** `docs/design/ux/wireframes.md` Part 0 (shell, list, form, detail, dialog, widgets) and `interaction-notes.md`. **Tokens:** [`design-system.md`](design-system.md). Dashboard tiles: [`dashboard-visuals.md`](dashboard-visuals.md).

> Every component below maps 1:1 to a UX wireframe box. This file adds MUI components, props,
> states and contrast values only. No new screens or features. MUI v6 / MUI X v7 assumed.
> Formats everywhere: dates **dd/mm/yyyy**, date-times **dd/mm/yyyy HH:mm** (MYT), money
> **RM 1,234.56** (tables: `1,234.56` under a header "(RM)"), leave days 1 dp ("12.5 days").

---

## 1. Buttons (colour roles)

Theme default: `variant` per role below, `disableElevation`, `borderRadius: 8`, label via `typography.button` (13/20, 600, UPPERCASE, +0.03em). Min height **40 px desktop, 44 px phone** (`size="medium"`); `size="small"` is 32 px desktop and **44 px on phone** (hit area enlarged by padding). Icon-only buttons are 40 / **44** px.

| Role | MUI props | Fill / text | Hover / pressed | Contrast (label on fill) | Used for (examples) |
|---|---|---|---|---|---|
| **Primary** | `variant="contained" color="primary"` | `#5A5FF2` / `#FFF` | `#4548C9` | 4.82 / 6.95 | `ADD NEW …`, `SEARCH`, `SUBMIT`, `SAVE`, `APPLY LEAVE`, `NEW CLAIM`, `CREATE BATCH`, `SIGN IN` |
| **Success (positive / export)** | `contained` `color="success"` | `#198754` / `#FFF` | `#0F6B40` | 4.53 / 6.57 | `EXPORT .CSV`, `APPROVE`, `APPROVE SELECTED`, `MARK DISBURSED`, `GENERATE OUTPUTS`, `PUBLISH` |
| **Danger (confirm)** | `contained` `color="error"` | `#D32F2F` / `#FFF` | `#B42318` | 4.98 / 6.57 | Confirm inside destructive dialogs only: `REJECT CLAIM`, `CANCEL CLAIM`, `DISCARD`, `DELETE` |
| **Danger (trigger)** | `outlined` `color="error"` | border `#D32F2F`, text `#B42318` on white | fill `#FCE8E8` | text 6.57 | `REJECT`, `DECLINE SELECTED`, `CANCEL CLAIM` triggers on decision panels and row actions |
| **Secondary / neutral** | `outlined` `color="inherit"` | border `#8F95A3`, text `#1A1D28` | fill `action.hover` | 16.8 | `CLEAR`, `(CANCEL)`, `(BACK)`, `(KEEP EDITING)`, `WITHDRAW`, `EDIT` |
| **Text / link button** | `variant="text" color="primary"` | text `#4548C9` | fill `rgba(90,95,242,.08)` | 6.95 | `View all notifications`, `Forgot password?`, `Show`, `Previous versions` |
| **Warning (rare)** | `contained` `color="warning"` | `#B45309` / `#FFF` | `#92400E` | 5.02 / 7.09 | `OVERRIDE …` actions (Admin override, SA override with reason) |
| **Disabled** | any | `#ECEEF3` / `#8F95A3`; cursor `not-allowed` | none | exempt | Disabled-with-reason only; a `Tooltip` states why (UX §0.4); wrap in `<span>` so the tooltip fires |
| **Loading** | add `loading` (MUI `LoadingButton` / v6 `loading` prop) | spinner + "Saving…" / "Submitting…", disabled | | | `SUBMIT`, `SAVE`, `CONFIRM` (FR-G-07) |

Rules
- **Action bar order** (right-aligned, canonical list): `EXPORT .CSV` (success + `FileDownloadOutlined`) -> `ADD NEW …` (primary + `Add`) -> `(CLEAR)` (neutral outlined) -> `SEARCH` (primary). Phone: `SEARCH` and `CLEAR` inside the Filters sheet footer; `EXPORT` and `ADD NEW` become an overflow `⋮` + a floating-style bottom primary where the screen's main action is creation (`APPLY LEAVE`, `NEW CLAIM`).
- One **primary** per view; success is the "positive/finish" role and may co-exist (`EXPORT .CSV` next to `ADD NEW`).
- Destructive and irreversible actions **name the effect** in the label (UX §0.5) and use the danger pair: outlined trigger -> contained confirm in the dialog.
- Icons: `startIcon`, 18 px, `currentColor`. Icon-only buttons need `aria-label` and a tooltip.
- Sticky bottom action (phone forms): `position: sticky; bottom: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: #FFF; border-top: 1px solid #E4E6EC;` the primary button is `fullWidth`, height 48. On pages with the bottom bar, the sticky action sits **above** the bar (`bottom: 56px + safe-area`).

---

## 2. Inputs and validation states

Pattern: `TextField variant="outlined" size="small"`, **floating label** (labels always visible, never placeholder-only: interaction-notes §13). Mandatory fields append ` *` to the label and set `required` (screen readers say "required"). Phone: `size="medium"` (height 48), `font-size: 16px`, label above-style is still the floating label.

| State | Border | Label / helper | Notes |
|---|---|---|---|
| Rest | 1 px `#8F95A3` (3.0 : 1) | label `text.secondary` | Helper text (format, limits) in `caption` `text.secondary` |
| Hover | 1 px `#5F6673` | | |
| Focus | 2 px `#5A5FF2` + 3 px glow `rgba(90,95,242,.18)` | label `#4548C9` | `:focus-visible` ring not doubled |
| Filled + clearable | | trailing `×` `IconButton` (aria-label "Clear {label}") | Filter-card fields (canonical list) |
| **Error** | 2 px `#D32F2F` | helper text `#B42318` (6.57 : 1), leading `ErrorOutline` icon 16 px, message from the validation catalogue (interaction-notes §4) | `aria-invalid`, `aria-describedby` -> helper; never colour-only |
| **Warning (acknowledge)** | 1 px `#B45309` | amber card under field: message + `[x] I understand` | Warn-type rules (limits, paternity notice, DOB mismatch) |
| Read-only / locked | no border, `#F7F7F9` fill, `Lock` 16 px adornment | tooltip "Fixed by policy" | e.g. end date for fixed-length leave |
| Disabled | `#E4E6EC` border, `#F7F7F9` fill, `text.disabled` | | |
| Success (rare) | none — no green borders on fields | | Avoid decoration |

Variants
- **Select** (`TextField select`), same look; menu `Paper` shadow level 4, max-height 320; option min-height 44 on phone. Options may carry secondary text (e.g. "Annual Leave · 8.5 d avail" — the secondary part in `text.secondary`).
- **Employee picker**: `Autocomplete` (type-ahead on employee no./name), option = `INT-004 · Name` + second line department in `caption`; debounce 250 ms; "No employee found" empty state; scope-filtered server-side.
- **Text area**: `multiline minRows={3}`; character counter bottom-right in `caption` ("0/500"; turns `#B42318` at limit).
- **Radio / checkbox**: `FormControlLabel`; control hit area 44 x 44 on phone (padding 10); unchecked border `#8F95A3`, checked `#5A5FF2`.
- **Masked value** (`••••••1234`, MyKad, bank, net pay): read-only text field look + text button `Show` (`aria-pressed`, `aria-label="Show account number"`); revealed value re-masks on navigation; ADM reveal opens a reason dialog (§7.3). Eye icon alone is not used (text label `Show`/`Hide`).
- **Form layout**: card per section (`Card` padding 24 / 16 phone), CSS grid 12-col, field gap 16, label column on top; two-up from `sm`. Error summary card (`Alert severity="error" variant="outlined"`, title "Can't submit yet", list of anchored errors) at the top; focus moves to it on a failed submit.
- **Record footer** (`caption`, `text.secondary`): "Created by {name} at dd/mm/yyyy HH:mm · Last updated by {name} at dd/mm/yyyy HH:mm".
- **Leaving guard** dialog "Discard unsaved changes?" uses §7.1 (`KEEP EDITING` / `DISCARD`).

---

## 3. Status chips

### 3.1 Anatomy and variants

`Chip size="small"` wrapped by `<StatusChip set="claim" value="Submitted" />` (single mapping source; no ad-hoc colours). Height 24, radius 6, padding `0 8px`, label 12/16 weight 600 (sentence case as given by the UX labels), optional leading icon 14 px. Non-interactive chips are not focusable and need no 44 px target; chips that filter (tab chip row on phone) get a 44 px hit area through wrapper padding. Always rendered with the visible text; also `aria-label="Status: {label}"` is **not** added (the text is already announced).

| Variant | Spec | Colour tokens (palette.tone[T]) |
|---|---|---|
| **filled** (tonal) | background `T.bg`, text `T.fg`, 1 px transparent border | The default for states in progress or settled |
| **outlined** | background transparent, 1 px `T.border`, text `T.fg` | Terminal / inactive / informational states and flags |
| **solid** (emphasis, flags only) | background `T.solid`, text `T.solidFg` | `EMERGENCY`, `Over limit`, `Outputs out of date` — the few items needing attention at a glance |

Cue beyond colour: the text label; flags also carry a leading icon (warning triangle, clock, copy, person-edit). Withdrawn/Cancelled/Expired are outlined or filled grey/red-outline so they read as "ended" by shape, not hue alone.

### 3.2 Mapping tables (colour tone · variant · label text · icon)

Tone key: **G**=grey, **I**=indigo, **S**=success, **N**=info (blue), **W**=warning, **E**=error, **P**=purple. Label texts are fixed (UX interaction-notes §15; IA §7).

**Claims (D12)**
| Status | Tone | Variant | Label | Meaning |
|---|---|---|---|---|
| New | G | filled | New | Saved draft |
| Submitted | W | filled | Submitted | Awaiting approval |
| Approved | N | filled | Approved | Awaiting month-end disbursement |
| Disbursed | S | filled | Disbursed | Paid |
| Rejected | E | filled | Rejected | Final |
| Withdrawn | G | outlined | Withdrawn | Final (employee) |
| Cancelled | E | outlined | Cancelled | Final (approved then cancelled) |
| Flag: Over limit | W | solid | Over limit | `WarningAmber` icon |
| Flag: Late (override) | W | outlined | Late (override) | `Schedule` icon |
| Flag: Possible duplicate | W | outlined | Possible duplicate | `ContentCopy` icon |
| Flag: On behalf | I | outlined | On behalf | `PersonAddAlt` icon |

**Leave applications**
| Status | Tone | Variant | Label |
|---|---|---|---|
| Pending (level 1 / 2) | W | filled | Pending L1 / Pending L2 |
| Approved | S | filled | Approved |
| Rejected | E | filled | Rejected |
| Withdrawn | G | outlined | Withdrawn |
| Cancellation pending | N | filled | Cancellation pending |
| Cancelled | G | filled | Cancelled |
| Flag | **E** | **solid** | EMERGENCY (`PriorityHigh` icon) |
| Flag | I | outlined | On behalf |
| Flag | W | outlined | Attachment pending (`AttachFile`) |
| Flag | E | outlined | MC invalid |
| Delegation note | I | outlined | Delegated from {approver} |

**Replacement credits**
| Status | Tone | Variant | Label |
|---|---|---|---|
| Pending | W | filled | Pending |
| Approved | S | filled | Approved |
| Rejected | E | filled | Rejected |
| Withdrawn | G | outlined | Withdrawn |
| Flag on Approved credit past expiry | G | filled (`EventBusy` icon) | Expired |

**Change requests**
| Status | Tone | Variant | Label |
|---|---|---|---|
| Submitted | W | filled | Submitted |
| Approved | S | filled | Approved |
| Rejected | E | filled | Rejected |
| Cancelled | G | filled | Cancelled |

**Employment status**
| Status | Tone | Variant | Label |
|---|---|---|---|
| Pending Join | G | filled | Pending Join |
| On Probation | N | filled | On Probation |
| Confirmed | S | filled | Confirmed |
| Notice Period | W | filled | Notice Period |
| Separated | G | **solid** (dark grey) | Separated |
| Withdrawn | G | outlined | Withdrawn |
| Future-dated row (job history etc.) | I | outlined (`Event` icon) | Scheduled |

**Disbursement batches**
| Status | Tone | Variant | Label |
|---|---|---|---|
| Draft | G | filled | Draft |
| Pending approval | W | filled | Pending approval |
| Approved | N | filled | Approved |
| Exported | P | filled | Exported |
| Disbursed | S | filled | Disbursed |
| Cancelled | G | outlined | Cancelled |
| Flag | W | solid | Outputs out of date (`WarningAmber`) |

**Payroll runs (R1.1)**
| Status | Tone | Variant | Label |
|---|---|---|---|
| Draft | G | filled | Draft |
| In Review | N | filled | In Review |
| Pending Approval | W | filled | Pending Approval |
| Approved | S | outlined | Approved |
| Finalised | S | filled | Finalised (`Lock` icon) |
| Cancelled | G | outlined | Cancelled |
| Mode | P | filled | Parallel |
| Mode | I | outlined | Live |

**Import jobs**
| Status | Tone | Variant | Label |
|---|---|---|---|
| Validated | N | filled | Validated |
| Committed | S | filled | Committed |
| Failed | E | filled | Failed |

**Other sets in the wireframes (same engine)**
| Set | Value -> tone / variant |
|---|---|
| Users | Invited N filled · Active S filled · Locked E filled · Disabled G filled · Expired G outlined |
| PH calendar year | Draft W outlined · Published S filled |
| Payslip (R1.1) | Not generated G outlined · Generated N filled · Published S outlined · Viewed S filled · Revised W filled |
| EA form (R1.1) | Draft G filled · Final N filled · Issued S filled · Re-issued I filled |
| Statutory table (R1.1) | Draft G filled · Verified S filled · Superseded G outlined |
| DSR | Open N filled · Responded S filled · Extended W filled · Closed G filled |
| Role chip (shell) | `Employee`, `Manager`, `Admin`, `Super Admin`: I **solid** small (20 px high, 11/16); External: `Admin · External` I outlined |
| Parallel / Live banner | see §11 banners |

Fallback: an unknown status renders G outlined with the raw label and logs a warning (never crashes, never a random colour).

### 3.3 Contrast verification (WCAG AA, text 4.5 : 1)

| Tone | filled: `fg` on `bg` | outlined: `fg` on white | solid: `solidFg` on `solid` |
|---|---|---|---|
| Grey | #374151 on #ECEEF3 = **8.88** | #374151 = **10.31** | #FFF on #4B5563 = **7.56** |
| Indigo | #3A3FBF on #EDEDFE = **6.86** | #3A3FBF = **7.94** | #FFF on #5A5FF2 = **4.82** |
| Success | #0F6B40 on #E6F4EC = **5.79** | #0F6B40 = **6.57** | #FFF on #198754 = **4.53** |
| Info | #0F4FAE on #E3EEFD = **6.51** | #0F4FAE = **7.64** | #FFF on #1A6FE0 = **4.78** |
| Warning | #7A4100 on #FFF1DB = **7.30** | #7A4100 = **8.13** | #FFF on #B45309 = **5.02** |
| Error | #9B1C1C on #FCE8E8 = **6.93** | #9B1C1C = **8.15** | #FFF on #B42318 = **6.57** |
| Purple | #4C2E94 on #F0E9FB = **8.35** | #4C2E94 = **9.88** | #FFF on #7B4FC9 = **5.52** |

Outlined-chip borders (`T.border`) are decorative; the label carries meaning, so the 3 : 1 non-text rule is satisfied through text + icon. Chips on the grey canvas (rare: dashboard KPI tiles use white cards) still pass because `fg` ratios exceed 8.8 against `#F4F5F9`.

### 3.4 Implementation sketch

```tsx
// StatusChip: single source of truth
const MAP: Record<Set, Record<string, { tone: ToneName; variant: 'filled'|'outlined'|'solid'; icon?: ReactNode }>> = { claim: {...}, leave: {...}, /* … from §3.2 */ };
<Chip size="small" label={label} icon={icon}
  sx={(t) => variantSx(t.palette.tone[tone], variant)} />
// filled:  { bgcolor: T.bg, color: T.fg, border: '1px solid transparent' }
// outlined:{ bgcolor: 'transparent', color: T.fg, border: `1px solid ${T.border}` }
// solid:   { bgcolor: T.solid, color: T.solidFg, border: '1px solid transparent' }
```

---

## 4. Date picker (dd/mm/yyyy)

- `@mui/x-date-pickers` `DatePicker` with `AdapterDateFns` + `enGB` locale; `format="dd/MM/yyyy"`; field placeholder `dd/mm/yyyy`; helper "Enter a date as dd/mm/yyyy". Typing is allowed (sectioned field), arrows increment; invalid -> error "Enter a date as dd/mm/yyyy" (UX §0.6).
- Calendar icon button (aria-label "Choose date") is the only picker trigger on desktop; **phone (< 600 px)**: `MobileDatePicker` full-screen dialog with a header showing the chosen date as dd/mm/yyyy, 44 px day cells, `OK` / `CANCEL` actions.
- Day cell for leave screens (custom `slots.day`): **public holiday** = 6 px dot below the number `#B45309`, `aria-label="05/05/2027, Public holiday: Hari Wesak"`, tooltip on hover/focus; **non-working day** (rest day / off day) = number `#8F95A3` on `#F7F7F9`, `aria-label` adds ", rest day", not selectable only where the rule requires; today = 1 px `#5A5FF2` ring; selected = `#5A5FF2` fill + white (4.82 : 1); range middle = `#EDEDFE` fill + `#3A3FBF` (6.86). Legend row under the calendar: "• Public holiday   ▒ Rest day" (text, not colour only).
- Month/year header: "November 2027" (`MMMM yyyy`). Week starts Monday. Min/max passed as props from the rules (e.g. not in future for transaction dates).
- Date-range (reports / filters): two linked pickers "From" / "To" (not a single range widget) so each field is clearable.
- Date-time display (read-only) `dd/mm/yyyy HH:mm`, 24 h; month-only fields show `MMM yyyy`.

---

## 5. Money input and display

| Item | Spec |
|---|---|
| Display | `RM 1,234.56` via `formatRM(n)` (`Intl.NumberFormat('en-MY',{style:'decimal',minimumFractionDigits:2,maximumFractionDigits:2})` with literal `RM` + no-break space prefix); never `RM1,234` or `MYR` in UI text. 2 dp always |
| Table cells | Number only (`1,234.56`), right-aligned, `tabular-nums`, header "(RM)" (e.g. "Total (RM)"); totals row bold. CSV export: plain numbers 2 dp, no "RM" |
| Negative | `−RM 12.00` (U+2212); in tables `−12.00`; text colour stays `text.primary`; the sign is the cue. Positive adjustments in ledgers use `+` |
| Input | `MoneyField`: `TextField` with `InputAdornment position="start"` "RM" (`text.secondary`), `inputMode="decimal"`, `align right`, `tabular-nums`; accepts `1234.5`, formats to `1,234.50` on blur, strips on focus; max / min from rules (claims: > 0.00, <= 99,999.99; message "Amount must be more than RM 0.00 and at most RM 99,999.99.") |
| Rate | `RM 0.600/km` (3 dp, mileage only) |
| Masked (net pay, basic salary) | `RM ••••` + text button `Show` (`aria-pressed`); revealed state shows value and `Hide`; masked text has `aria-label="Amount hidden"` |
| KPI money | `kpi` style (28/36, 700, tabular) with "RM" in `body2` weight 500 directly before |
| Charts / axis | `RM 1.2k`-style short labels only on axes; tooltips show full `RM 1,234.56` |

---

## 6. Data table / DataGrid (canonical list)

Implements `wireframes.md §0.2`: **filter card -> action bar -> table card -> bulk bar + pagination**. One composite `ListPage` with four slots; used by every list.

### 6.1 Filter card
`Card` padding 16, `Grid` gap 16; first field is the **keyword search** (`TextField` with `Search` start icon, hint states what is searched), then filters. Field widths: `md` 3 per row (`xs` 12, `sm` 6). Multi-selects use `Autocomplete multiple` with chip tags (max 2 shown + "+n"); dates are From/To pickers (§4). "More filters ▸" `Button variant="text"` expands a second row when > 5 filters. Every populated field clearable (×). Filters apply on `SEARCH` / Enter; `CLEAR` resets to defaults. State persisted per list (URL search params) so Back returns to the same filters, sort, page, rows-per-page. Phone: collapses to `[Filters (3)]` (outlined, with badge count) opening a bottom sheet with the same fields, sticky footer `(CLEAR)` `SEARCH`.

### 6.2 Table
- **Component:** `@mui/x-data-grid` (Community) for admin and approvals lists (sorting, selection, server-side pagination `paginationMode="server"`, `sortingMode="server"`). Plain `Table` + `TablePagination` for very short fixed lists (e.g. delegations, leave types) with the same styling.
- **Card:** wrapper `Card` no padding; `DataGrid`: `disableColumnMenu`, `disableRowSelectionOnClick`, `density="standard"` (row 52; `compact` 40 only for line-item grids), `autoHeight`, `border: 0`.
- **Header:** 13/20 weight 600 `text.secondary`, bottom border `#E4E6EC`, fill `#F7F7F9`, sort arrow shown on hover and when active (`aria-sort`), sortable by default; column separators 1 px `#E4E6EC` (subtle, per Interact reference).
- **Rows:** white, `hover` fill `action.hover`, selected fill `action.selected`; cell 14/20, padding 12 x 16, 1 px bottom divider.
- **First column** = drill-in `Link` (`#4548C9`, weight 600, underline on hover/focus) -> detail. Reference numbers monospace-tabular, copyable (tap-to-copy on phone: `ContentCopy` icon button 44 px in card view).
- **Money** right-aligned `(RM)`; **dates** `dd/mm/yyyy`; **status** `StatusChip`; **flags** appended after the status chip, wrap max 2 then "+n".
- **Action column** (sticky right, 96 px): `Visibility` icon button (aria-label "View {ref}") + `MoreVert` menu `⋮` with only the row's allowed actions. Menu item min-height 44 phone.
- **Selection column:** header checkbox selects the current page; when all rows on the page are selected a banner row offers "Select all {n} matching" (only where bulk is allowed).
- **Bulk bar:** appears above pagination when n selected: "{n} selected: [BULK ACTION] [BULK ACTION]" (`#EDEDFE` bar, `#3A3FBF` text 6.86, buttons per §1).
- **Skeleton / progress:** first load = 5 skeleton rows; re-query = 2 px `LinearProgress` at the top of the card (rows stay).
- **Empty:** overlay per §10.1 (two kinds). **Error:** per §10.3.
- **Column priority on tablet (600-1023):** columns tagged `priority: low` hide first; the first column, status and action never hide.

### 6.3 Pagination footer
`GridPagination` / `TablePagination`: "Rows per page [25 ▾]" (10 / 25 / 50 / 100), "1–25 of 128", prev / next chevrons (44 px on phone). Default 25. Server-side; total from count query.

### 6.4 CSV export
`EXPORT .CSV` (success, §1) exports the **filtered set, all pages, only columns the user may view**; filename `<list>-dd-mm-yyyy.csv`; dates `dd/mm/yyyy`, money plain 2 dp; sensitive lists show a `Lock` icon + tooltip "Access is logged" before download. Click -> button shows spinner and "Preparing…"; > 10,000 rows -> toast "Export started — we'll notify you" + in-app notification with link. Never uses DataGrid's client-side export (page-only).

### 6.5 Phone card view (< 600 px)
`ResponsiveList` renders `Card` per row: tappable whole card (min height 88). Layout: row 1 = first-column link (h6) left + status chip right; row 2..4 = 3–4 key label/value pairs (`caption` label above `body2` value, two columns); money bold, right-aligned in its cell; flags below; `⋮` menu top-right 44 px. Card gap 12. Bulk select hidden (FR-PRT-07) except where stated.

---

## 7. Dialogs and sheets

`Dialog` (desktop) -> **bottom sheet** on phone (`<Drawer anchor="bottom">`, top radius 16, `max-height: 90dvh`, drag handle 4 x 32 `#D3D6DE`, safe-area padding, sticky action row).

### 7.1 Confirm dialog
Width `sm` (480), padding 24, title `h4` (names the object/effect: "Delete CL-2027-00102?"), body `body1`, actions right-aligned `[(CANCEL)] [CONFIRM ACTION]`. Initial focus on the **safe** action (Cancel) for destructive dialogs, on the primary for non-destructive. `Escape` closes non-destructive dialogs. Focus trapped and returned to the trigger. Destructive confirm = danger contained (§1). Backdrop `rgba(26,29,40,.5)`.

### 7.2 Reason-required dialog (reject, cancel, undo disbursement, override)
Title "Reject claim CL-…?" · multiline `TextField` label "Reason *" (`minRows 3`, counter 0/500) · confirm button names the effect (`REJECT CLAIM`, `CANCEL CLAIM`, `UNDO DISBURSEMENT`) and is **disabled until a non-blank reason** is entered; if the user taps it blocked, the field shows "Add a reason." (or "Add a comment to reject." for leave). Reject with comment on leave uses label "Comment *". The reason is read back in the trail. Phone: textarea auto-focuses, keyboard-safe sheet (`visualViewport` aware).

### 7.3 Sensitive reveal dialog (ADM)
Reason `Select`/text "Why do you need to see this? *" -> `SHOW`; logs the reveal. Copy: "Viewing is logged."

### 7.4 Warning acknowledgement
Inline amber `Alert severity="warning" variant="outlined"` (border `#B45309`, bg `#FFF1DB`, text `#7A4100` 7.3 : 1) with `FormControlLabel` "I understand"; the submit button re-enables when ticked.

### 7.5 Session-expiry dialog
Non-dismissible `Dialog` with live countdown (`aria-live="polite"` announced at 2:00, 1:00, 0:30), `[(SIGN OUT)] [STAY SIGNED IN]`.

---

## 8. Approval decision panel

Used on leave / claim / credit / change-request decision views and in the phone inbox. Layout (desktop: right column, sticky; phone: sticky bottom bar):

```
┌ Decision ─────────────────────────────┐
│ ⓘ Already decided by … (when applicable)│  info banner, actions removed
│ Comment (optional | required to reject) │
│ [ multiline, counter 0/500          ]   │
│ [ APPROVE ]  [ REJECT ]  ⋮ (override)    │
│ Balance at decision time (leave)         │
└─────────────────────────────────────────┘
```
- `APPROVE` = success contained; `REJECT` = danger **outlined** that opens §7.2 if the comment is empty (else confirms in place with the typed comment). Admin override = warning contained in the `⋮` menu "APPROVE AS ADMIN (OVERRIDE)", reason dialog.
- Phone: two equal 48 px buttons in a sticky bar (`APPROVE` | `REJECT`), comment field above in a collapsible "Add a comment" row; after a decision the inbox advances ("Next ›", "Back to inbox").
- **Trail** (side card, `Timeline`): dot 10 px (tone `solid`), line `#E4E6EC`; entry = chip-less text "Approved L1 by {name}" + `caption` `dd/mm/yyyy HH:mm`; re-route and override lines in `text.secondary` italic **not used** (use an info icon). Delegation lines get an `Delegated from …` indigo outlined chip.
- Concurrency banner: `Alert severity="info"` "Already decided by {name} at dd/mm/yyyy HH:mm." — decision buttons removed.
- Own item: buttons absent, `Alert` "Your claim" / "You can't decide your own {item}." (read-only).
- Bulk (desktop only): table selection bar → `APPROVE SELECTED` / `DECLINE SELECTED` open one dialog with a shared comment, then a result table (✓ approved · ⤳ moved to L2 · ✕ skipped with reason, using tone chips + icons).
- **Balance preview** (leave): `Card` variant `outlined`, 4 rows (label left, value right, tabular): *Available now* · *This application* (`−2.0`) · *Pending* (`−1.0`) · *Available after* (bold, 16 px). "Available after" < 0 -> text `#B42318` + `ErrorOutline` icon + block message; allowed-negative -> `#7A4100` on `#FFF1DB` row with "Will go to −1.0 (allowed up to −2.0)". Accrual line "Earned to date at {date}: 4.0" in `caption`. Pool line for Sick / Hospitalisation. While recalculating, the value is replaced by `…` for <= 1 s (`aria-busy`). On phone the panel sits directly above the sticky `SUBMIT`.

---

## 9. Left-nav shell, top bar and phone bottom bar

### 9.1 Structure
`AppShell` = `AppBar` (top) + `Drawer` (left) + `main` + `BottomNavigation` (phone). Nav is generated from a typed config and **filtered on the server** by role/scope, so unauthorised items are absent from the DOM; hiding is never the access control (routes, actions and RLS enforce separately).

```ts
type NavItem = { id: string; label: string; icon: ReactNode; href?: string; roles: Role[]; // 'EMP'|'MGR'|'ADM'|'SA'
  badge?: 'approvals'|'changeRequests'; children?: NavItem[]; requires?: 'employeeUser'|'releaseR11'|'settingOn:...' };
```
Section overlines (non-clickable, `overline`, `text.secondary`): **MY SPACE** (Home, My Leave, My Claims, My Pay, My Profile, Directory) · **WORK** (Approvals, My Team) · **ADMIN** (Employees, Leave, Claims, Payroll, Organisation, Reports, Imports) · **SYSTEM** (Users & access, Privacy & logs / Audit & privacy, Settings). Which items appear per role follows IA §3.5; overlines with no visible items are omitted.

### 9.2 Drawer
| Property | Spec |
|---|---|
| Width | 264 expanded, 72 collapsed (`«` toggle, state remembered per browser); `md`+ permanent; below `md` `temporary` with scrim, opened by hamburger, closes on navigation |
| Surface | white, right border 1 px `#E4E6EC`, no shadow (shadow level 8 when temporary) |
| Brand block | Interact logo (height 32, `object-fit: contain`, never stretched) + version badge `vX.Y.Z` (`Chip` outlined grey, 20 px high, 11/16). Collapsed rail shows the mark only (interim: cropped PNG; final `interact-mark.svg` — Open question 3) |
| Greeting | Avatar 32 (`primary.brand` bg, white initials — decorative; initials have `aria-hidden`) + "Hi, {preferred name}" (`body2` 600) + **role chip** (indigo solid, 20 px) — highest role held; External: "Admin · External" outlined |
| Item (leaf) | `ListItemButton` height 44 (phone 48), radius 8, margin `0 8px`, icon 20 px `#5F6673` + label `subtitle2` in `text.primary` |
| Hover | `action.hover` |
| **Active leaf** | fill `#5A5FF2`, text + icon `#FFF` (4.82 : 1), `aria-current="page"` — matches the reference's indigo fill |
| **Active parent** (child active, section open) | label + icon `#4548C9`, bold, no fill; open section shows children indented 40 px (children 14/20, 40 px high, active child = indigo fill) |
| Badge | `Badge color="error"` pill right-aligned, shows actionable count ("99+" above 99, hidden at 0), white on `#D32F2F` 4.98 : 1 + `aria-label="4 items awaiting approval"` |
| Collapsed | icons only, `Tooltip` placement right with the label, expandable sections open as a flyout `Menu` |
| Footer | `Privacy notice` (only if published) · `Help` text links, `caption` `#4548C9` |
| Icons (MUI outlined) | Home `HomeOutlined` · Dashboard `SpaceDashboardOutlined` · Approvals `TaskAltOutlined` · Employees `PeopleOutline` · Leave `EventAvailableOutlined` · Claims `ReceiptLongOutlined` · Payroll `PaymentsOutlined` · Organisation `AccountTreeOutlined` · Reports `AssessmentOutlined` · Imports `UploadFileOutlined` · Users & access `ManageAccountsOutlined` · Privacy & logs `PolicyOutlined` · Settings `SettingsOutlined` · My Pay `RequestQuoteOutlined` · My Profile `PersonOutline` · Directory `ContactsOutlined` · My Team `GroupsOutlined` |

### 9.3 Top bar
`AppBar color="inherit" elevation={0}`, white, bottom border 1 px `#E4E6EC`, height 64 (phone 56). Left: hamburger (below `md`) + **breadcrumb** (`caption`, `text.secondary`, links `#4548C9`; shown at admin depth >= 2) above/before the single `<h1>` page title (`h3`; phone `h3` 20/28 truncated with ellipsis). Right: bell `Badge` (error, max 99 -> "99+", hidden at 0) opening the notification panel (popover desktop / bottom sheet phone, max 10 items, "Mark all read"); avatar menu (`Account settings`, `Privacy notice`, `Sign out`). External administrator sessions show a persistent `Chip` outlined "Access is logged" (`Lock` icon) left of the bell. Payroll parallel mode shows the banner in §11, not the app bar.

### 9.4 Phone bottom bar (UXQ-07, designed as default)
`BottomNavigation showLabels`, fixed, height 56 + safe-area, white, top border `#E4E6EC`, 5 actions: **Home · Leave · Claims · Approvals (MGR/ADM/SA only; badge) · More** (opens the drawer). Employees without Approvals see Home · Leave · Claims · Profile · More. Each action is >= 64 x 56; icon 24 + label `caption` 12/16 (11 px forbidden: keep 12). Selected = icon + label `#4548C9` (6.95 : 1) with a 3 px top indicator `#5A5FF2` (non-colour shape cue); unselected `#5F6673` (5.78 : 1). Hidden on the sign-in screens and while the on-screen keyboard is open; sticky form actions sit above it.

### 9.5 Sign-in split panel (S-GL-01)
Two columns >= `md`: left **brand panel** (hidden < `md`) background `linear-gradient(160deg,#EDEDFE 0%,#F4F5F9 70%)`, Interact logo 160 px wide centred, "PRET" `h1`, "HR & Payroll" `h5` `text.secondary`; no marketing copy added. Right panel white, max-width 400 form: logo (phone only), `h4` "Sign in", fields per §2, `SIGN IN` primary full width (48 high), `Forgot password?` text button, `Privacy notice` link if published. Error alert (`Alert severity="error" variant="outlined"`) above the button for "Email or password is incorrect." Logo alt text "Interact — Business through Technology".

---

## 10. Empty, loading and error states

### 10.1 Empty (two kinds, never confused)
`EmptyState` inside the table card or content area, centred, min-height 240: 48 px outline icon `#8F95A3` (decorative, `aria-hidden`), `h6` message, `body2` `text.secondary` helper, then buttons. (a) **Nothing exists yet:** "No claims yet." + `[NEW CLAIM]` (primary) if the user may create. (b) **Filters exclude everything:** "No claims match these filters." + `[CLEAR]` (neutral outlined). Specific copy as in interaction-notes §2 ("Nothing waiting for you.", "You're all caught up.", "No one is on leave."). Tab chip rows keep their count badges at 0.

### 10.2 Loading
- First list load: 5 `Skeleton` rows (`variant="rectangular"`, radius 4, `#ECEEF3`, wave animation off with `prefers-reduced-motion`). Filter card and action bar are real and interactive immediately.
- Re-query: top `LinearProgress` (2 px `#5A5FF2`) on the table card; rows stay; `SEARCH` disabled.
- Dashboard tiles load independently; each tile skeleton keeps its height (no layout shift).
- Detail header skeleton; actions appear only after permissions are known.
- Saving: primary button spinner + "Saving…" and form becomes read-only (`aria-busy="true"` on the form).
- Long jobs (imports, payroll calculation, year-end preview, zips): `ProgressPanel` card with `LinearProgress` (determinate when known, "Validating 57 rows…", elapsed time) and "You can leave this page — we'll notify you".
- Live recalculation shows `…` for <= 1 s then the value; failure "Couldn't check balance — [RETRY]" with `SUBMIT` disabled.

### 10.3 Error
| Kind | Component | Spec |
|---|---|---|
| Field | Input error (§2) | red outline + icon + message |
| Form-level business rule | `Alert severity="error" variant="outlined"` summary card, title "Can't submit yet", linked list | focus moves here on submit; fields underneath outlined red |
| Tile / widget | Inline `Alert severity="error"` small: "Couldn't load — [RETRY]" | other tiles unaffected |
| Network on submit (phone) | Persistent banner "No connection — your entries are kept. [TRY AGAIN]" above the sticky action | retry re-sends same request (idempotency key) |
| Server error | Card with reference code, "[TRY AGAIN]" | no stack traces |
| Not found / no access (S-GL-10) | Full-page centred message | identical for both cases |
| Concurrency | Info/Warning banner (§8) | |
Error colours: border `#D32F2F`, text `#B42318` on white (6.57 : 1), fill `#FCE8E8` for banners (text `#9B1C1C` 6.93 : 1). Errors never use toasts (below).

---

## 11. Toasts, banners, badges

| Component | Spec |
|---|---|
| **Toast** | `Snackbar` `autoHideDuration={4000}`, dismissible (`Close` 44 px), `Alert variant="filled"`-style custom: success = bg `#0F6B40` text `#FFF` (6.57 : 1) with `CheckCircleOutline`; neutral info = bg `#1A1D28` text `#FFF` (16.8 : 1). Position: desktop bottom-left (margin 24); phone bottom-centre above the bottom bar (`bottom: calc(56px + 12px + env(safe-area-inset-bottom))`). One at a time (queue). Contains an optional `VIEW` text button (white, underlined). `role="status"` `aria-live="polite"`. **Never for errors that block** (interaction-notes §10) |
| **Banner** | Persistent `Alert variant="outlined"` at the top of the content area, full width, tone from §3.1: warning (`#FFF1DB` bg, `#7A4100` text, `#B45309` border) for out-of-date outputs, unpublished calendar, pending warnings; info (`#E3EEFD`/`#0F4FAE`) for parallel mode, read-only notices; error (`#FCE8E8`/`#9B1C1C`) for blocking states. Icon + text + optional action button on the right; dismiss only when non-critical |
| **Payroll mode banner** | Parallel: purple `#F0E9FB`/`#4C2E94` "Parallel run — figures are not live" under the app bar of payroll screens; Live: none (chip only) |
| **Notification item** | Unread: 8 px `#5A5FF2` dot + weight 600 title; read: no dot, weight 400. `caption` time. Row min-height 64 (touch 44 satisfied) |
| **Count badge** | See nav and bell: white on `#D32F2F` pill, min width 20, height 20, 12/16 600 |

---

## 12. File and camera upload (receipts, MC, documents)

`UploadField` per UX interaction-notes §7.

| Part | Spec |
|---|---|
| Entry buttons | `[📷 TAKE PHOTO]` (outlined primary, `CameraAltOutlined`, `<input type="file" accept="image/*" capture="environment">`; shown on touch devices) and `[📎 CHOOSE FILE]` (outlined, `AttachFile`, `accept=".jpg,.jpeg,.png,.heic,.pdf"` + `.docx` for documents). Phone: two 48 px buttons side by side (stacked below 360) |
| Desktop dropzone | `Card` with 2 px dashed `#8F95A3` border, radius 8, padding 24, `UploadFileOutlined` icon, "Drag and drop, or choose a file", helper "JPG, PNG, HEIC or PDF · up to 10 MB each"; drag-over = border `#5A5FF2`, fill `#EDEDFE` |
| Counter | "2 of 5" (`caption`) beside the label |
| Thumbnail tile | 88 x 88 (phone 96), radius 8, 1 px `#E4E6EC`, file name below (`caption`, ellipsis), `✕` remove button 44 x 44 hit area (visual 24 px, `aria-label="Remove {file}"`) top-right; PDF shows `PictureAsPdfOutlined` + page count; tap opens the full-screen viewer |
| Progress | Per-file `LinearProgress` 4 px under the tile, `✕` cancels; success tick; failure tile border `#D32F2F` + "Upload failed — [RETRY]" |
| Errors | `FormHelperText` error "Only JPG, PNG, HEIC or PDF up to 10 MB." (rejected before upload); "Receipt required" per line message |
| Viewer | Full-screen `Dialog fullScreen`, dark scrim `#1A1D28`, controls (zoom, rotate, ‹ ›, `DOWNLOAD`, close) as 44 px `IconButton`s with `aria-label`s, pinch / scroll zoom; sensitive files show a persistent "Viewing is logged" chip (white text on `#4B5563` 7.56 : 1) |
| Late MC | Chip "Attachment pending" (warning outlined) + `ADD ATTACHMENT` text button |

---

## 13. Other shared components (brief)

- **Tabs** (`Tabs variant="scrollable"` with `allowScrollButtonsMobile`): 48 px high, label `subtitle2`, selected `#4548C9` with 3 px `#5A5FF2` indicator; count badge as pill `#ECEEF3`/`#374151` (selected `#EDEDFE`/`#3A3FBF`). Phone = scrollable chip row (each 44 px tall).
- **Detail header card:** reference (`h4`) + status chip(s) left; key facts 2–4 columns (`caption` label, `body1` value); actions right-aligned (`[PRIMARY] [(SECONDARY)] [⋮]`); phone: actions wrap, primary full width.
- **Key-value rows:** label `caption` `text.secondary`; value `body1`; masked values per §2.
- **Timeline / trail**, **stepper** (new-employee wizard: `Stepper alternativeLabel`, step circle `#5A5FF2`, completed `#198754` with check, 44 px touch on phone as a "Step 2 of 6" text header), **breadcrumbs**, **tooltips** (`arrow`, dark `#1A1D28`, white text, also on keyboard focus, `enterTouchDelay 0`).
- **Org-chart node cards** (S-GL-13): 160 x 72 white cards, photo 40, name `subtitle2`, position `caption`; phone = indented collapsible list.
- **Calendar (leave)**: leave-type legend colours from `palette.leaveType`; every colour pairs with a text label or a list alternative (day list).

---

## 14. Accessibility checklist (component level)

| Requirement | Implementation |
|---|---|
| Contrast | Every chip and button pair verified above (§1, §3.3); links `#4548C9`; no `primary.brand` text |
| Focus rings | Global `:focus-visible` 2 px `#4548C9`, offset 2; visible on every control incl. table links, row menus, bottom bar, nav, chips (when interactive), date cells |
| Touch targets | >= 44 x 44 px on phone: buttons, icon buttons, checkboxes/radios, nav items (48), table row actions, menu items, tabs, date cells, bottom-bar items, thumbnail remove |
| Labels | Visible label on every input; errors via `aria-describedby`; error summary focusable |
| Status not colour-only | Text on every chip; flags carry icons |
| Keyboard | Full tab order; dialogs trap and restore focus; `Escape` closes non-destructive dialogs; DataGrid arrow navigation retained |
| Reduced motion | Animations off; skeleton static |
| Live regions | Toasts `role="status"`; countdown dialog `aria-live`; recalculating balance `aria-busy` |
| Zoom / reflow | Reflow to 320 CSS px without horizontal scroll (design floor 360); text resizes to 200% |
| Charts | Always a table / list alternative and direct labels |

---

## Open UI questions for Albert

1. **Bottom bar items** (UXQ-07 default): Home · Leave · Claims · Approvals · More. For employees with no approvals the 4th slot shows Profile. OK?
2. **Primary indigo variant** `#5A5FF2` on buttons and the active nav (AA) vs the exact `#666CFF` (4.07 : 1). See `design-system.md` question 1.
3. **Mark-only logo** for the collapsed sidebar and favicon is missing; please supply `interact-mark.svg`.
4. **Chip colour choices to confirm:** Claim *Approved* = blue (awaiting disbursement) while Leave *Approved* = green (final); Claim *Cancelled* = red outline; Disbursement batch *Exported* = purple; Payroll *Parallel* = purple. Any colour you want changed for your team's habits (e.g. Kakitangan used which colours)?
5. **Toasts** are bottom-left on desktop (UX says "bottom"); confirm bottom-left vs bottom-centre.
6. **Action label case:** buttons render UPPERCASE via CSS (`textTransform`), source text stays sentence case ("Export .CSV") so screen readers read normally. Fine?

## Ready for GATE 2 (design)?

Buttons, inputs and validation, status-chip mapping with contrast proof for every status set in the wireframes, date picker, money, DataGrid/table list pattern, dialogs, approval panel, left-nav shell with phone bottom bar, empty/loading/error states, toasts, upload and accessibility are specified. **Yes — ready for GATE 2 review**, subject to the open UI questions above.
