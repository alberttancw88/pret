# PRET — Theme tokens for Direction B "Sunrise" (implementation spec)

**Work item:** W2-009 · **Author:** UI Designer · **Status:** **Chosen by Albert at GATE 2 (D35)** for the admin portal, the employee self-service portal (desktop) and mobile web. Visual reference: [`preview.html`](preview.html), tab "B · Sunrise". Rationale and alternatives: [`directions.md`](directions.md). The unchosen Clarity version is archived in [`theme-tokens-clarity.md`](theme-tokens-clarity.md).
**Albert's smaller choices (coordinator: recommendations apply):** sentence-case buttons · labels above fields · Comfortable list rows with an optional Compact mode on admin lists · no dark mode this release · current PNG logo (`public/brand/interact-logo.png`) until a mark-only SVG arrives.
**Replaces (after this is built):** the colour, type, radius, shadow and component-override values in `docs/design/ui/design-system.md` and `components.md`. **Does not change:** component behaviour and states, field-level content, flows, roles, status-to-meaning mapping, dd/mm/yyyy dates, RM 1,234.56 money, "every list has search, filters, pagination, CSV export".
**Stack:** MUI 7 + Emotion, MUI X Data Grid + Date Pickers, Next.js App Router, single light theme. Keep the augmentation shape of `src/theme/augment.ts` (`tone`, `leaveType`, `link`, `kpi`, `chip`, `pret`) with the changes listed in §3.4.

---

## 0. How Sunrise stays a serious back office (rules for engineers and designers)

Sunrise is friendly and colourful on the portal. The admin side uses the **same tokens with colour rationed**, so payroll, batches and approvals read calmly.

| # | Rule | Where it applies |
|---|---|---|
| 1 | **Tables, forms, detail pages, dialogs and decision panels sit on plain white** cards on the `#F7F4FF` canvas. No pastel fills inside them. Colour inside a table comes only from status chips, the completeness bar and the link colour. | All admin and portal lists and forms |
| 2 | **The violet hero exists only on portal Home** (and the sign-in brand panel). Never on admin pages, detail pages, claims or payroll. | `PortalHero` |
| 3 | **Pastel KPI tiles** (`KpiTile variant="pastel"`) are allowed in one strip of at most 4 tiles at the top of a list or dashboard, one pastel per tile. On **money and approval screens** (claims lists and batches, disbursement batches, payroll runs, approval queue totals) use `variant="quiet"`: white card, 4 px left accent in the tone colour, number in `text.primary`. Pastel is decoration; a tile's meaning is always carried by its label and number, never by hue. | Dashboards, Employees, Leave lists |
| 4 | **Admin nav icon tiles are small (32 px), muted pastel, five hues only** and fixed per item (§8.1) so the rail never reads as a rainbow. The active item is the only saturated element in the rail. | Left nav |
| 5 | **Shadows are for floating things only:** hero, phone bottom bar, phone sticky submit bar, menus, dialogs, popovers, and hover lift on portal tiles. Admin cards, KPI tiles and the table card are flat with a hairline border `#E7E1F7`. | Everywhere |
| 6 | **Pill buttons are 40 px on admin desktop** (44 on phone). The violet primary glow shadow is used only on phone and `size="large"`, not in admin toolbars. One primary per view. | Buttons |
| 7 | **Compact density** (rows 48, filter fields 40) is available on every admin list for the outsourced administrator. Comfortable (rows 60) is the default. | Lists |
| 8 | **Large radii are for containers, not data:** cards 20, tables clip to the card, but cells, inputs inside dense grids and inline editors use 10-14 px. | Shape |
| 9 | Status chips are the **only** saturated tinted objects in tables. Never put a status colour on a whole row, only on the chip. | Tables |
| 10 | Pastel avatar colours are decorative and chosen by a hash of the employee number, so a person keeps their colour; initials always present. | Avatars |

---

## 1. Fonts

**Plus Jakarta Sans** (`next/font/google`, variable `wght` 400-800, `display: 'swap'`, subsets `['latin']`, CSS variable `--font-jakarta`). **Inter** is kept as a secondary face for **numerals only** (variable `--font-inter`, weights 500-700, subset `latin`) because tabular figures are mandatory for money, counts and dates in tables and Plus Jakarta Sans' `tnum` support must not be assumed.

```ts
export const FONT_FAMILY =
  'var(--font-jakarta), "Plus Jakarta Sans", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
export const FONT_NUMERIC =
  'var(--font-inter), Inter, "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
// Numeric surfaces: table cells with money/dates/counts, KPI numbers, balance tiles, money inputs, pagination counts.
// Apply with the class `.pret-tnum { font-family: FONT_NUMERIC; font-variant-numeric: tabular-nums; }`
```

If the frontend verifies at build time that Plus Jakarta Sans renders `tnum` correctly, `FONT_NUMERIC` may be dropped to save a font request. Until then keep both. (The static preview used Plus Jakarta Sans throughout.)

## 2. Breakpoints, spacing, layout

```ts
breakpoints: { values: { xs: 0, sm: 600, md: 1024, lg: 1280, xl: 1600 } },   // unchanged
spacing: 8,                                                                      // unchanged
pret: {
  minViewport: 360,
  drawerWidth: 264, drawerCollapsed: 80,
  appBarHeight: { xs: 56, md: 64 },
  bottomBarHeight: 64,            // floating bar; see §8.3
  bottomBarInset: 12,             // gap to screen edges and above safe area
  contentMaxWidth: 1440, portalMaxWidth: 1100, touchTarget: 44,
  pageGutter: { xs: 16, md: 32 },
  cardPadding: { xs: 16, md: 24 },
  rowHeight: { comfortable: 60, compact: 48 },     // §10
  inputHeight: { md: 44, mdCompact: 40, xs: 48 },
  focusRing: { width: 2, offset: 2, color: '#6D28D9', onDark: '#FFFFFF' },
}
```

## 3. Palette

### 3.1 Core

```ts
const palette = {
  mode: 'light',
  primary:   { main: '#6D28D9', light: '#8B5CF6', dark: '#5B21B6', contrastText: '#FFFFFF' }, // white on main 7.10 ; on dark 8.97
  secondary: { main: '#5B5675', light: '#857FA3', dark: '#3F3B56', contrastText: '#FFFFFF' }, // white on main 6.90
  success:   { main: '#047857', light: '#34D399', dark: '#065F46', contrastText: '#FFFFFF' }, // 5.48 ; dark 7.7
  info:      { main: '#1D4ED8', light: '#60A5FA', dark: '#1E40AF', contrastText: '#FFFFFF' }, // 6.70 ; dark 8.7
  warning:   { main: '#B45309', light: '#F59E0B', dark: '#92400E', contrastText: '#FFFFFF' }, // 5.02 ; dark 7.09
  error:     { main: '#B91C1C', light: '#EF4444', dark: '#991B1B', contrastText: '#FFFFFF' }, // 6.47 ; dark 8.3
  grey: { 50:'#F7F4FF', 100:'#F1EEFB', 200:'#E7E1F7', 300:'#D8CFF0', 400:'#A9A3C2', 500:'#857FA3', 600:'#5B5675', 700:'#3F3B56', 800:'#2B2748', 900:'#1F1B3B' },
  text: { primary: '#1F1B3B', secondary: '#5B5675', disabled: '#A9A3C2' },   // 16.4 / 6.90 on white (6.37 on canvas) / exempt
  background: { default: '#F7F4FF', paper: '#FFFFFF' },
  divider: '#E7E1F7',
  action: { hover: 'rgba(109,40,217,0.05)', selected: '#EDE9FE', focus: 'rgba(109,40,217,0.14)', disabledBackground: '#F1EEFB', disabled: '#A9A3C2' },
  link: '#5B21B6',                  // 8.97 on white, 8.26 on canvas
  controlBorder: '#857FA3',         // inputs, checkbox, radio, switch-off track: 3.78 on white, 3.48 on canvas (>= 3)
  rowDivider: '#F0EBFB',
  tone, tile, leaveType, hero,
};
```

All text/background pairs are WCAG 2.x ratios, computed from relative luminance and rounded.

| Pair | Ratio | Use |
|---|---|---|
| `#1F1B3B` on `#FFFFFF` / on `#F7F4FF` | 16.4 / 15.0 | Primary text |
| `#5B5675` on `#FFFFFF` / on `#F7F4FF` | 6.90 / 6.37 | Secondary text, labels, helper |
| White on `#6D28D9` | **7.10** | Primary button, active nav pill, active bottom-bar icon pill, selected date |
| White on `#5B21B6` (hover) | 8.97 | |
| `#5B21B6` on `#FFFFFF` / `#F7F4FF` | 8.97 / 8.26 | Links, text buttons, active tab text |
| `#5B21B6` on `#EDE9FE` | 7.56 | Secondary (lavender) button, selected tab/menu item, bulk bar |
| `#5B21B6` on `#DDD6FE` | 6.46 | Secondary button hover |
| White on `#047857` / `#B45309` / `#B91C1C` / `#1D4ED8` | 5.48 / 5.02 / 6.47 / 6.70 | Success, warning (override), danger, info fills |
| `#857FA3` on `#FFFFFF` (control border) | 3.78 | Non-text >= 3 |
| `#6D28D9` focus ring on white / on canvas | 7.10 / 6.4 | Non-text >= 3 |
| White focus ring on `#6D28D9` / on `#4F46E5` (inside the hero) | 7.10 / 6.29 | |

### 3.2 Tones (`palette.tone`) — chips, alerts, banners

Format `{ bg, fg, border, solid, solidFg }`. Renamed from the earlier system: `indigo` is now **`violet`** (the brand tone) and `purple` is now **`pink`** (the secondary accent, so Exported/Parallel stay distinct from the violet brand).

```ts
export const tone = {
  grey:    { bg: '#F3F4F6', fg: '#374151', border: '#857FA3', solid: '#4B5563', solidFg: '#FFFFFF' }, // fg/bg 9.37 · fg/white 10.3 · solid 7.56
  violet:  { bg: '#EDE9FE', fg: '#5B21B6', border: '#6D28D9', solid: '#6D28D9', solidFg: '#FFFFFF' }, // 7.56 · 8.97 · 7.10
  success: { bg: '#DCFCE7', fg: '#166534', border: '#047857', solid: '#047857', solidFg: '#FFFFFF' }, // 6.49 · 7.1  · 5.48
  info:    { bg: '#DBEAFE', fg: '#1E40AF', border: '#1D4ED8', solid: '#1D4ED8', solidFg: '#FFFFFF' }, // 7.14 · 8.7  · 6.70
  warning: { bg: '#FEF3C7', fg: '#92400E', border: '#B45309', solid: '#B45309', solidFg: '#FFFFFF' }, // 6.36 · 7.09 · 5.02
  error:   { bg: '#FEE2E2', fg: '#991B1B', border: '#B91C1C', solid: '#B91C1C', solidFg: '#FFFFFF' }, // 6.80 · 8.3  · 6.47
  pink:    { bg: '#FCE7F3', fg: '#9D174D', border: '#BE185D', solid: '#BE185D', solidFg: '#FFFFFF' }, // 6.70 · 7.88 · 6.04
} as const;
```

### 3.3 Pastel tiles (`palette.tile`) — KPI tiles, quick-action tiles, balance tiles, nav icon tiles

Each tile is a `bg` with one `ink` colour used for **all** text and icons on it (label, number, sub-text), so only one pair needs checking. Body text `#1F1B3B` also passes on every tile bg (13.8 - 14.5) if ink is not used.

| Tile | `bg` | `ink` | `ink` on `bg` | `#1F1B3B` on `bg` | Secondary `#5B5675` on `bg` | `accent` (bars, dots; >= 3 : 1 on `bg`) |
|---|---|---|---|---|---|---|
| lavender | `#EDE9FE` | `#4C1D95` | **9.2** | 13.8 | 5.82 | `#6D28D9` |
| mint | `#D1FAE5` | `#065F46` | **6.79** | 14.5 | 6.10 | `#047857` |
| sky | `#E0F2FE` | `#075985` | **6.59** | 14.3 | 6.03 | `#0369A1` |
| peach | `#FFEDD5` | `#9A3412` | **6.38** | 13.5 | 6.03 | `#C2410C` |
| rose | `#FCE7F3` | `#9D174D` | **6.70** | 13.2 | 5.88 | `#BE185D` |

```ts
export const tile = {
  lavender: { bg: '#EDE9FE', ink: '#4C1D95', accent: '#6D28D9' },
  mint:     { bg: '#D1FAE5', ink: '#065F46', accent: '#047857' },
  sky:      { bg: '#E0F2FE', ink: '#075985', accent: '#0369A1' },
  peach:    { bg: '#FFEDD5', ink: '#9A3412', accent: '#C2410C' },
  rose:     { bg: '#FCE7F3', ink: '#9D174D', accent: '#BE185D' },
} as const;
```

Progress-bar track on a pastel tile: `rgba(255,255,255,0.75)`; fill = `accent`.

### 3.4 Hero and leave-type colours

```ts
export const hero = {
  gradient: 'linear-gradient(135deg, #6D28D9 0%, #4F46E5 100%)',   // white text: 7.10 at the start, 6.29 at the end
  decor: 'rgba(255,255,255,0.10)',   // decorative circle only; worst case under text 5.84 : 1
  subtext: '#EDE9FE',                // on #6D28D9 5.98 · on #4F46E5 5.29
  shadow: '0 14px 28px -14px rgba(79,70,229,0.70)',
};
export const leaveType = ['#6D28D9', '#047857', '#1D4ED8', '#C2410C', '#BE185D', '#0F766E', '#B45309', '#4B5563']; // dots/bars only; each >= 3 : 1 on white
```

**`augment.ts` changes:** `ToneName = 'grey'|'violet'|'success'|'info'|'warning'|'error'|'pink'`; remove `primary.brand`; add to `Palette`/`PaletteOptions`: `tile: Record<'lavender'|'mint'|'sky'|'peach'|'rose', {bg,ink,accent}>`, `hero`, `controlBorder`, `rowDivider`; add `pret.rowHeight/inputHeight/bottomBarInset/focusRing.onDark`; add `fontNumeric` to the theme (`theme.typography.fontFamilyNumeric`). Rename `indigo`->`violet`, `purple`->`pink` in `StatusChip`.

### 3.5 Status chips — every set in `components.md` §3.2

`tone · variant` (`f` filled, `o` outlined, `s` solid). Labels, meanings and icons are unchanged. Unknown value: `grey · o`, raw label, console warning.

| Set | Value → tone · variant |
|---|---|
| **Claim** | New → grey f · Submitted → warning f · Approved → info f · Disbursed → success f · Rejected → error f · Withdrawn → grey o · Cancelled → error o · Flag Over limit → warning s (`WarningAmber`) · Late (override) → warning o (`Schedule`) · Possible duplicate → warning o (`ContentCopy`) · On behalf → violet o (`PersonAddAlt`) |
| **Leave application** | Pending L1/L2 → warning f · Approved → success f · Rejected → error f · Withdrawn → grey o · Cancellation pending → info f · Cancelled → grey f · EMERGENCY → error s (`PriorityHigh`) · On behalf → violet o · Attachment pending → warning o (`AttachFile`) · MC invalid → error o · Delegated from {approver} → violet o |
| **Replacement credit** | Pending → warning f · Approved → success f · Rejected → error f · Withdrawn → grey o · Expired → grey f (`EventBusy`) |
| **Change request** | Submitted → warning f · Approved → success f · Rejected → error f · Cancelled → grey f |
| **Employment status** | Pending Join → grey f · On Probation → info f · Confirmed → success f · Notice Period → warning f · Separated → grey s · Withdrawn → grey o · Scheduled (future-dated row) → violet o (`Event`) |
| **Disbursement batch** | Draft → grey f · Pending approval → warning f · Approved → info f · Exported → pink f · Disbursed → success f · Cancelled → grey o · Outputs out of date → warning s (`WarningAmber`) |
| **Payroll run (R1.1)** | Draft → grey f · In Review → info f · Pending Approval → warning f · Approved → success o · Finalised → success f (`Lock`) · Cancelled → grey o · Parallel → pink f · Live → violet o |
| **Import job** | Validated → info f · Committed → success f · Failed → error f |
| **User** | Invited → info f · Active → success f · Locked → error f · Disabled → grey f · Expired → grey o |
| **PH calendar year** | Draft → warning o · Published → success f |
| **Payslip (R1.1)** | Not generated → grey o · Generated → info f · Published → success o · Viewed → success f · Revised → warning f |
| **EA form (R1.1)** | Draft → grey f · Final → info f · Issued → success f · Re-issued → violet f |
| **Statutory table (R1.1)** | Draft → grey f · Verified → success f · Superseded → grey o |
| **DSR** | Open → info f · Responded → success f · Extended → warning f · Closed → grey f |
| **Role chip (shell)** | Employee / Manager / Admin / Super Admin → violet s (20 px high, 11/16 allowed) · External → violet o "Admin · External" |

**Chip rendering:** pill (radius 999), height 24, label 12/16 **700**, padding 0 10, no leading dot (icons only for flags), `aria-label` not added (text is announced). `filled`: `bg`/`fg`, 1 px transparent border. `outlined`: transparent, 1 px `border`, `fg` text. `solid`: `solid`/`solidFg`. Interactive chips (filter chip rows) get a 44 px hit area through wrapper padding. Separated (grey solid) and flags are the only dark chips.

## 4. Typography

Every variant sets explicit `fontSize` and `lineHeight` (MUI defaults must never leak). `rem` = 16 px.

| Variant | Desktop size/line | Phone | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `h1` | 32 / 40 (`2rem`/`2.5rem`) | 28 / 36 | 800 | -0.02em | Sign-in headline |
| `h2` | 28 / 36 | 24 / 32 | 800 | -0.02em | Large figures |
| `h3` | 26 / 34 | 22 / 30 | 800 | -0.02em | **Page title** (renders `<h1>`); hero greeting is `h3` + 2 px on phone (24/32) |
| `h4` | 20 / 28 | 18 / 26 | 700 | -0.01em | Dialog title, detail header |
| `h5` | 18 / 26 | 17 / 24 | 700 | -0.005em | Card section title |
| `h6` | 16 / 24 | same | 700 | 0 | Card title, hero section title |
| `subtitle1` | 16 / 24 | same | 600 | 0 | |
| `subtitle2` | 14 / 20 | same | 600 | 0 | Nav label, row title |
| `body1` | 15 / 22 | **16 / 24** | 400 | 0 | Default text (16 on phone so iOS does not zoom inputs) |
| `body2` | 14 / 20 | 14 / 20 | 400 | 0 | Table cells, helper copy |
| `button` | 14 / 20 | 15 / 20 | 700 | 0 | **Sentence case** (`textTransform: 'none'`) |
| `caption` | 12 / 18 | same | 500 | 0 | Helper, timestamps, record footer |
| `overline` | 12 / 16 | same | 700 | +0.06em | Uppercase nav section label |
| `kpi` (custom) | 32 / 38 | 28 / 34 | 800 | -0.02em | KPI and balance numbers; `fontFamily: FONT_NUMERIC`, tabular |
| `chip` (custom) | 12 / 16 | same | 700 | 0 | Status chips |

Minimum text size 12 px (the 20 px role chip may use 11/16). Money, counts and dates in tables, KPI tiles and money inputs use `FONT_NUMERIC` + `tabular-nums`. Plus Jakarta Sans runs a little wide: table first columns and chips must be checked at 1024 px for truncation (use `noWrap` with tooltip).

## 5. Shape

```ts
shape: { borderRadius: 14 },       // MUI base (Paper default, inputs, menu items inherit)
export const radius = {
  xs: 8,        // thumbnails, progress bars inside tiles, tooltips (10)
  input: 14,    // text fields, selects, autocomplete, date fields
  menu: 16,     // menus, popovers, date-picker popper
  card: 20,     // cards, KPI/balance/quick-action tiles, table card, alerts (16)
  dialog: 24,
  hero: 26,     // phone hero (28 on md+)
  sheet: 28,    // phone bottom sheet top corners
  floating: 28, // floating bottom bar and sticky submit bar
  pill: 999,    // buttons, chips, badges, tabs, toggle buttons
  avatar: 12,   // rounded-square avatars (list rows); 50% for profile photos
};
```

## 6. Elevation

Admin cards are flat (rule 5). Shadows are tinted and used only on floating or lifted surfaces. Build the 25-slot MUI array from levels 0/1/4/8/12 (unused slots repeat the nearest lower level), plus named extras.

| Level / name | Value | Use |
|---|---|---|
| 0 | `none` | Admin cards, table card, KPI tiles, app bar, rail, inputs |
| 1 | `0 1px 2px rgba(31,27,59,0.06)` | Hover on admin tiles |
| `card` (portal) | `0 8px 24px -10px rgba(109,40,217,0.28)` | Portal cards and tiles at rest; hover lift `0 12px 28px -10px rgba(109,40,217,0.34)` |
| 4 | `0 12px 32px -8px rgba(31,27,59,0.22), 0 0 0 1px rgba(109,40,217,0.06)` | Menus, popovers, date popper, notification panel |
| 8 | `0 28px 56px -16px rgba(31,27,59,0.35)` | Dialogs, bottom sheets |
| 12 | `0 28px 56px -16px rgba(31,27,59,0.40)` | Temporary drawer (phone) |
| `floating` | `0 12px 28px -8px rgba(31,27,59,0.35)` | Phone bottom bar, sticky submit bar |
| `hero` | `0 14px 28px -14px rgba(79,70,229,0.70)` | Portal hero |
| `cta` | `0 6px 16px -6px rgba(109,40,217,0.55)` | Primary button on phone and `size="large"` only |

## 7. Component overrides

Page background `#F7F4FF`. Admin card = white, `1px solid #E7E1F7`, radius 20, no shadow. Portal card = white, no border, `card` shadow.

```ts
components: {
  MuiCssBaseline: { styleOverrides: {
    body: { backgroundColor: '#F7F4FF', minWidth: 360, color: '#1F1B3B' },
    '*:focus-visible': { outline: '2px solid #6D28D9', outlineOffset: 2 },
    '.pret-on-dark *:focus-visible': { outline: '2px solid #FFFFFF', outlineOffset: 2 },   // hero, active nav pill
    '.pret-tnum': { fontFamily: FONT_NUMERIC, fontVariantNumeric: 'tabular-nums' },
    '@media (prefers-reduced-motion: reduce)': { '*, *::before, *::after': { animationDuration: '0.01ms !important', transitionDuration: '0.01ms !important' } },
  } },

  // ---- Buttons: pill, sentence case ----
  MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: {
    borderRadius: 999, textTransform: 'none', fontWeight: 700, minHeight: 40, padding: '0 20px',
    '@media (max-width:599.95px)': { minHeight: 44, boxShadow: 'none' },
    '&.Mui-disabled': { cursor: 'not-allowed', pointerEvents: 'auto', backgroundColor: '#F1EEFB', color: '#A9A3C2', borderColor: 'transparent' },
    variants: [
      { props: { size: 'small' }, style: { minHeight: 32, padding: '0 14px', '@media (max-width:599.95px)': { minHeight: 44 } } },
      { props: { size: 'large' }, style: { minHeight: 48, padding: '0 24px' } },
      { props: { variant: 'contained', color: 'primary' }, style: { '&:hover': { backgroundColor: '#5B21B6' } } },
      { props: { variant: 'contained', color: 'primary', size: 'large' }, style: { boxShadow: '0 6px 16px -6px rgba(109,40,217,0.55)' } },
      { props: { variant: 'contained', color: 'success' }, style: { '&:hover': { backgroundColor: '#065F46' } } },
      { props: { variant: 'contained', color: 'error' },   style: { '&:hover': { backgroundColor: '#991B1B' } } },
      { props: { variant: 'contained', color: 'warning' }, style: { '&:hover': { backgroundColor: '#92400E' } } },
      // Secondary / neutral: lavender fill, no border (text #5B21B6 on #EDE9FE = 7.56)
      { props: { variant: 'outlined', color: 'inherit' }, style: { backgroundColor: '#EDE9FE', color: '#5B21B6', borderColor: 'transparent', '&:hover': { backgroundColor: '#DDD6FE', borderColor: 'transparent' } } },
      // Outlined primary (camera / choose-file on phone)
      { props: { variant: 'outlined', color: 'primary' }, style: { color: '#5B21B6', borderColor: '#6D28D9', '&:hover': { backgroundColor: '#EDE9FE' } } },
      // Danger trigger
      { props: { variant: 'outlined', color: 'error' }, style: { color: '#B91C1C', borderColor: '#B91C1C', '&:hover': { backgroundColor: '#FEE2E2' } } },
      { props: { variant: 'text', color: 'primary' }, style: { color: '#5B21B6', '&:hover': { backgroundColor: '#EDE9FE' } } },
    ],
  }, startIcon: { '& > *:nth-of-type(1)': { fontSize: 18 } } } },
  MuiIconButton: { styleOverrides: { root: { borderRadius: 14, '@media (max-width:599.95px)': { width: 44, height: 44 } } } },

  // ---- Surfaces ----
  MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
  MuiCard: { defaultProps: { elevation: 0 }, styleOverrides: { root: { border: '1px solid #E7E1F7', borderRadius: 20, boxShadow: 'none' } },
    variants: [{ props: { variant: 'portal' }, style: { border: 'none', boxShadow: '0 8px 24px -10px rgba(109,40,217,0.28)' } }] },
  MuiCardContent: { styleOverrides: { root: { padding: 24, '&:last-child': { paddingBottom: 24 }, '@media (max-width:599.95px)': { padding: 16, '&:last-child': { paddingBottom: 16 } } } } },

  // ---- Inputs: label ABOVE the field, 44 px (phone 48, compact 40), radius 14 ----
  MuiTextField: { defaultProps: { variant: 'outlined', size: 'medium', fullWidth: true } },
  MuiInputLabel: { styleOverrides: { root: {
    position: 'static', transform: 'none', marginBottom: 6, fontSize: 12, lineHeight: '16px', fontWeight: 700, color: '#5B5675',
    '&.Mui-focused': { color: '#5B21B6' }, '&.Mui-error': { color: '#B91C1C' }, '&.Mui-disabled': { color: '#857FA3' },
  } } },
  MuiOutlinedInput: { styleOverrides: {
    root: {
      borderRadius: 14, backgroundColor: '#FFFFFF', minHeight: 44,
      '&.MuiInputBase-sizeSmall': { minHeight: 40 },
      '@media (max-width:599.95px)': { minHeight: 48 },
      '& legend': { display: 'none' }, '& fieldset': { top: 0 },                     // no notch
      '&:hover:not(.Mui-disabled):not(.Mui-focused):not(.Mui-error) .MuiOutlinedInput-notchedOutline': { borderColor: '#5B5675' },
      '&.Mui-focused': { boxShadow: '0 0 0 3px rgba(109,40,217,0.18)' },
      '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#6D28D9', borderWidth: 2 },
      '&.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: '#B91C1C', borderWidth: 2 },
      '&.Mui-disabled': { backgroundColor: '#F1EEFB' },
      '&.Mui-disabled .MuiOutlinedInput-notchedOutline': { borderColor: '#E7E1F7' },
      '&.Mui-readOnly': { backgroundColor: '#F7F4FF' },
      '& input:focus-visible, & textarea:focus-visible': { outline: 'none' },
    },
    notchedOutline: { borderColor: '#857FA3' },
    input: { fontSize: 15, '@media (max-width:599.95px)': { fontSize: 16, paddingBlock: 12 } },
  } },
  MuiFormHelperText: { styleOverrides: { root: { marginLeft: 2, fontSize: 12, lineHeight: '16px', color: '#5B5675', '&.Mui-error': { color: '#B91C1C' } } } },
  MuiCheckbox: { styleOverrides: { root: { color: '#857FA3', '&.Mui-checked': { color: '#6D28D9' }, '@media (max-width:599.95px)': { padding: 10 } } } },
  MuiRadio:    { styleOverrides: { root: { color: '#857FA3', '&.Mui-checked': { color: '#6D28D9' }, '@media (max-width:599.95px)': { padding: 10 } } } },
  MuiSwitch: { styleOverrides: {
    switchBase: { '&.Mui-checked': { color: '#FFFFFF', '& + .MuiSwitch-track': { backgroundColor: '#6D28D9', opacity: 1 } } },
    track: { backgroundColor: '#857FA3', opacity: 1, borderRadius: 999 },
    root: { '@media (max-width:599.95px)': { width: 64, height: 44, padding: 15 } },
  } },
  MuiLink: { defaultProps: { underline: 'hover' }, styleOverrides: { root: { color: '#5B21B6', fontWeight: 700 } } },

  // ---- Chips (StatusChip builds on this) ----
  MuiChip: { styleOverrides: {
    root: { height: 24, borderRadius: 999, fontWeight: 700, fontSize: 12 },
    label: { paddingLeft: 10, paddingRight: 10 },
    icon: { fontSize: 14, marginLeft: 6, marginRight: -4 },
  } },

  MuiTooltip: { defaultProps: { arrow: true, enterTouchDelay: 0 }, styleOverrides: {
    tooltip: { backgroundColor: '#1F1B3B', color: '#FFFFFF', fontSize: 12, lineHeight: '18px', borderRadius: 10, padding: '6px 12px' },
    arrow: { color: '#1F1B3B' } } },
  MuiMenu: { styleOverrides: { paper: { borderRadius: 16, boxShadow: '0 12px 32px -8px rgba(31,27,59,0.22), 0 0 0 1px rgba(109,40,217,0.06)', marginTop: 4 } } },
  MuiMenuItem: { styleOverrides: { root: { fontSize: 14, borderRadius: 10, margin: '0 6px', '&.Mui-selected': { backgroundColor: '#EDE9FE', color: '#5B21B6', fontWeight: 700 }, '@media (max-width:599.95px)': { minHeight: 44 } } } },
  MuiSelect: { defaultProps: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 320 } } } } } },

  // ---- Dialogs and sheets ----
  MuiDialog: { styleOverrides: { paper: { borderRadius: 24, boxShadow: '0 28px 56px -16px rgba(31,27,59,0.35)' } } },
  MuiDialogTitle: { defaultProps: { variant: 'h4' }, styleOverrides: { root: { padding: '28px 28px 8px' } } },
  MuiDialogContent: { styleOverrides: { root: { padding: '8px 28px' } } },
  MuiDialogActions: { styleOverrides: { root: { padding: 28, gap: 8, '& > :not(style) ~ :not(style)': { marginLeft: 0 } } } },
  MuiBackdrop: { styleOverrides: { root: { '&:not(.MuiBackdrop-invisible)': { backgroundColor: 'rgba(31,27,59,0.5)' } } } },
  // Phone bottom sheet = <Drawer anchor="bottom">: paper borderRadius '28px 28px 0 0', maxHeight '90dvh',
  //   drag handle 32x4 #D8CFF0, safe-area padding, sticky action row (pill buttons, 48 px).

  // ---- Shell (see §8) ----
  MuiAppBar: { defaultProps: { elevation: 0, color: 'inherit' }, styleOverrides: { root: { backgroundColor: '#F7F4FF', borderBottom: '1px solid transparent', '&.pret-scrolled': { backgroundColor: '#FFFFFF', borderBottomColor: '#E7E1F7' } } } },
  MuiDrawer: { styleOverrides: { paper: { backgroundColor: '#FFFFFF', borderRight: '1px solid #E7E1F7' } } },
  MuiListItemButton: { styleOverrides: { root: {
    borderRadius: 14, minHeight: 46, margin: '2px 8px', padding: '0 8px', gap: 12, color: '#1F1B3B', fontWeight: 600,
    '&:hover': { backgroundColor: '#F7F4FF' },
    '&.Mui-selected': { backgroundColor: '#6D28D9', color: '#FFFFFF', fontWeight: 700, '&:hover': { backgroundColor: '#5B21B6' } },   // white on #6D28D9 7.10
    '@media (max-width:599.95px)': { minHeight: 48 },
  } } },
  MuiListItemIcon: { styleOverrides: { root: { minWidth: 0, color: 'inherit' } } },   // the pastel tile is a custom <NavIconTile/> (§8.1)
  MuiBottomNavigation: { styleOverrides: { root: {
    position: 'fixed', left: 12, right: 12, bottom: 'calc(12px + env(safe-area-inset-bottom))',
    height: 64, borderRadius: 28, backgroundColor: '#FFFFFF', boxShadow: '0 12px 28px -8px rgba(31,27,59,0.35)', padding: '0 4px',
  } } },
  MuiBottomNavigationAction: { styleOverrides: {
    root: { minWidth: 64, maxWidth: 'none', color: '#5B5675', paddingTop: 8, '&.Mui-selected': { color: '#5B21B6', fontWeight: 700 } },   // 6.90 / 8.97
    label: { fontSize: 12, lineHeight: '16px', fontWeight: 600, '&.Mui-selected': { fontSize: 12, fontWeight: 700 } },
  } },
  // Selected icon pill: wrap the icon in <span class="pret-bb-pill"> 60 x 32, radius 999;
  //   rest: transparent; selected: bg #6D28D9, icon #FFFFFF (7.10). Badge: error pill 18 px at top-right of the pill.

  MuiBreadcrumbs: { styleOverrides: { root: { fontSize: 12, color: '#5B5675' }, separator: { margin: '0 6px' } } },
  MuiAvatar: { styleOverrides: { root: { fontSize: 12, fontWeight: 800, borderRadius: 12, backgroundColor: '#EDE9FE', color: '#5B21B6' } } },
  // Avatar hue: pick a tile (lavender|mint|sky|peach|rose) by hash(employeeNo); text = tile.ink.

  // ---- Tables (plain MUI Table): plain white card, header lavender-white ----
  MuiTableCell: { styleOverrides: {
    root: { fontSize: 14, lineHeight: '20px', padding: '16px 16px', borderBottom: '1px solid #F0EBFB' },
    head: { fontSize: 12, lineHeight: '16px', fontWeight: 700, color: '#5B5675', backgroundColor: '#F7F4FF', whiteSpace: 'nowrap', borderBottom: '1px solid #E7E1F7' },
  } },
  MuiTableRow: { styleOverrides: { root: { '&.MuiTableRow-hover:hover': { backgroundColor: '#FBF9FF' }, '&.Mui-selected': { backgroundColor: '#EDE9FE' } } } },
  MuiTablePagination: { styleOverrides: { root: { borderTop: '1px solid #E7E1F7', color: '#5B5675' }, toolbar: { minHeight: 56 },
    selectLabel: { fontSize: 13 }, displayedRows: { fontSize: 13, fontFamily: FONT_NUMERIC, fontVariantNumeric: 'tabular-nums' },
    actions: { '& .MuiIconButton-root': { '@media (max-width:599.95px)': { width: 44, height: 44 } } } } },

  // ---- MUI X Data Grid (import '@mui/x-data-grid/themeAugmentation') ----
  MuiDataGrid: { styleOverrides: { root: {
    border: 0, borderRadius: 0, fontSize: 14,
    '--DataGrid-containerBackground': '#F7F4FF',
    '& .MuiDataGrid-columnHeaders': { borderBottom: '1px solid #E7E1F7' },
    '& .MuiDataGrid-columnHeader': { backgroundColor: '#F7F4FF' },
    '& .MuiDataGrid-columnHeaderTitle': { fontSize: 12, fontWeight: 700, color: '#5B5675' },
    '& .MuiDataGrid-columnSeparator': { display: 'none' },
    '& .MuiDataGrid-cell': { borderBottom: '1px solid #F0EBFB', display: 'flex', alignItems: 'center' },
    '& .MuiDataGrid-row:hover': { backgroundColor: '#FBF9FF' },
    '& .MuiDataGrid-row.Mui-selected, & .MuiDataGrid-row.Mui-selected:hover': { backgroundColor: '#EDE9FE' },
    '& .MuiDataGrid-footerContainer': { borderTop: '1px solid #E7E1F7' },
    '& .MuiDataGrid-cell:focus-within, & .MuiDataGrid-columnHeader:focus-within': { outline: '2px solid #6D28D9', outlineOffset: -2 },
    '& .pret-num': { fontFamily: FONT_NUMERIC, fontVariantNumeric: 'tabular-nums', justifyContent: 'flex-end' },
  } } },
  // rowHeight = pret.rowHeight[density] (60 / 48); columnHeaderHeight 48; autoHeight; disableColumnMenu; disableRowSelectionOnClick.
  // Wrap in <Card> (radius 20, overflow hidden) so the corners clip. The grid itself never carries colour apart from header and selection.

  // ---- Feedback ----
  MuiAlert: { styleOverrides: { root: { borderRadius: 16, fontSize: 14, variants: [
    ...(['success','info','warning','error'] as const).map((s) => ({ props: { severity: s }, style: {
      backgroundColor: tone[s].bg, color: tone[s].fg, border: `1px solid ${tone[s].border}`, '& .MuiAlert-icon': { color: tone[s].fg } } })),
  ] }, message: { fontWeight: 500 } } },
  MuiAlertTitle: { styleOverrides: { root: { fontWeight: 700, fontSize: 14, marginBottom: 4 } } },
  MuiSnackbarContent: { styleOverrides: { root: { backgroundColor: '#1F1B3B', color: '#FFFFFF', borderRadius: 16 } } },   // 16.4 : 1 ; success toast bg #065F46 (white 7.7)
  MuiBadge: { styleOverrides: { badge: { fontSize: 12, fontWeight: 700, minWidth: 20, height: 20, borderRadius: 999, padding: '0 6px' } } },
  MuiSkeleton: { defaultProps: { animation: 'wave' }, styleOverrides: { root: { backgroundColor: '#EFEAFB', borderRadius: 14 } } },
  MuiLinearProgress: { styleOverrides: { root: { height: 6, borderRadius: 6, backgroundColor: '#E7E1F7' }, bar: { borderRadius: 6 } } },

  // ---- Tabs: pill segments (calm on admin) ----
  MuiTabs: { styleOverrides: { root: { minHeight: 40 }, indicator: { display: 'none' }, flexContainer: { gap: 8 } } },
  MuiTab: { styleOverrides: { root: { minHeight: 40, minWidth: 0, padding: '0 16px', borderRadius: 999, textTransform: 'none', fontSize: 14, fontWeight: 600, color: '#5B5675',
    '&:hover': { backgroundColor: '#F1EEFB' }, '&.Mui-selected': { backgroundColor: '#EDE9FE', color: '#5B21B6', fontWeight: 700 },   // 7.56
    '@media (max-width:599.95px)': { minHeight: 44 } } } },
  MuiToggleButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, color: '#5B5675', borderColor: '#D8CFF0', borderRadius: 999, '@media (max-width:599.95px)': { minHeight: 44 },
    '&.Mui-selected': { backgroundColor: '#EDE9FE', color: '#5B21B6', '&:hover': { backgroundColor: '#DDD6FE' } } } } },
}
```

### 7.1 Date pickers (`@mui/x-date-pickers`, enGB, `dd/MM/yyyy`)
Day cell 40 px (phone 44), radius 999. Selected `#6D28D9` + white (7.10); today = 1 px `#6D28D9` ring; range middle `#EDE9FE` + `#5B21B6` (7.56); public-holiday dot 6 px `#B45309` (+ aria-label and legend); non-working day number `#5B5675` on `#F7F4FF` (6.37). Popper `Paper` radius 16, elevation 4. Behaviour unchanged (components.md §4); phone uses the full-screen `MobileDatePicker`.

### 7.2 Upload (components.md §12)
Dropzone: 2 px dashed `#857FA3`, radius 20, padding 24; drag-over border `#6D28D9` + fill `#EDE9FE`. Phone: "Take photo" and "Choose file" are outlined-primary pill buttons 48 px side by side (lavender fill variant allowed: `#EDE9FE` + `#5B21B6`). Thumbnail 96 x 78 radius 12, 1 px `#E7E1F7`, remove target 44 px, progress bar 4 px `#6D28D9` on `#E7E1F7`; failure border `#B91C1C`.

## 8. Shell treatment and portal components

### 8.1 Admin / desktop left nav with pastel icon tiles

| Property | Spec |
|---|---|
| Rail | 264 px (80 collapsed), white, right border `#E7E1F7`; brand block: Interact logo PNG (height 26-28, never stretched) + version badge (outlined pill, 11/16, `#5B5675` on white 6.90); user block: avatar + name (`subtitle2`) + role chip; section overlines (`overline`, `#5B5675`): MY SPACE, WORK, ADMIN, SYSTEM per `components.md` §9.1 |
| Item | `ListItemButton` 46 px high, radius 14, `NavIconTile` + label `subtitle2` 600 `#1F1B3B` |
| `NavIconTile` | 32 x 32, radius 11, icon 20 px outline, tile bg and icon colour from `palette.tile[x].bg` / `.ink` (icon 3:1+ against bg: >= 6.38) |
| Active | whole item filled `#6D28D9`, label white 700 (7.10), icon tile becomes `rgba(255,255,255,0.20)` with a white icon; `aria-current="page"`; focus ring white on dark (`pret-on-dark`) |
| Hover | `#F7F4FF` |
| Badge | red `#B91C1C` pill, 20 px, white 12/16 700, `aria-label="4 items awaiting approval"` |
| Collapsed | tile only (32 px) centred, `Tooltip` right; sections open as a flyout `Menu` |
| Tile hue per item (fixed, five hues only) | Home, Dashboard, Approvals, Employees, Reports → **lavender** · Leave, My Leave, Users & access → **mint** · Claims, My Claims, Settings → **peach** · Payroll, My Pay, Directory → **sky** · Organisation, My Team, Privacy & logs, Imports, My Profile → **rose** |
| Role chip | violet solid, 20 px |

Admin calm rule 4 applies: only the active item is saturated.

### 8.2 Top bar and page header
Top bar 64 px (56 phone), background `#F7F4FF`, no border until scroll (`pret-scrolled` -> white + hairline). Left: hamburger (< `md`) + breadcrumb (`caption`); right: bell (`Badge`), avatar menu, External "Access is logged" chip. **Page header row** below the bar: `h3` page title left, action buttons right in canonical order: `Import` (secondary) · `Export .CSV` (success) · `Add new …` (primary), phone: overflow `⋮` plus one primary.

### 8.3 Floating phone bottom bar
`BottomNavigation` as in §7: fixed, inset 12 px each side, `bottom: calc(12px + safe-area)`, height 64, radius 28, white, `floating` shadow, 5 slots (Home · Leave · Claims · Approvals* · More, *only MGR/ADM/SA, else Profile). Selected: icon in a 60 x 32 violet pill (white icon 7.10) and label `#5B21B6` 700; unselected icon + label `#5B5675` (6.90). Hidden on sign-in and while the keyboard is open. Pages that show it add `padding-bottom: calc(64px + 12px + 12px + env(safe-area-inset-bottom))` to the scroll area so content is never covered. Toasts sit above it: `bottom: calc(64px + 12px + 12px + 12px + safe)`.

### 8.4 Portal Home hero (portal Home only)
`PortalHero` wraps greeting + leave balance tiles.

| Part | Spec |
|---|---|
| Surface | `hero.gradient`, radius 26 (28 on `md`+), padding 18 16 16 (24 on `md`+), `hero.shadow`, `overflow: hidden`, `className="pret-on-dark"` |
| Decor | 140 px circle `hero.decor` at top -40 / right -40, `aria-hidden`, `pointer-events: none`, never under chip or link text beyond the 5.84 : 1 worst case |
| Greeting | `body2` date in `#EDE9FE` (5.98 on `#6D28D9`, 5.29 on `#4F46E5`); name `h3` white; role chip (violet filled `#EDE9FE`/`#5B21B6`) right |
| Section row | `h6` white "Leave balances" + "All ›" text link white underlined (44 px target) |
| Balance tiles | Pastel tiles (§8.5) in a horizontal scroll row on phone (148 px wide, gap 10, bleed to the screen edge); 3-column grid on `md`+; each uses `tile[x]` bg + `ink`; progress track `rgba(255,255,255,0.75)` fill `accent`; number `kpi`; meta `caption` in ink |
| Warning note | inside the hero: `Alert`-like strip `#FEF3C7` / `#92400E` (6.36) with `WarningAmber` icon, radius 12, no border |
| Below the hero | quick actions as a 2 x 2 grid of pastel tiles (lavender, mint, peach, sky; 84 px high phone, icon in a white 70 % rounded square, label in ink), then white cards for manager items and pending items |

### 8.5 KPI and balance tiles (`KpiTile`)
| Variant | Where | Spec |
|---|---|---|
| `pastel` | Employees list strip, dashboards, portal balances | `tile[x].bg`, radius 20, padding 18 x 20 (phone 14 x 16), no border, no shadow (admin) or `card` shadow (portal); label 12/16 700 in ink; value `kpi` in ink; sub-text 12/18 in ink; hue by position: lavender, sky, peach, mint |
| `quiet` | Money / approval screens, payroll, batches | white card with `1px #E7E1F7`, 4 px left bar in the tone colour (`tile.accent`), label `text.secondary`, value `kpi` `text.primary`; no pastel fill |
Max 4 tiles per strip; a tile is never the only carrier of status (label + number always present).

### 8.6 Sticky submit bar (phone forms)
Floating pill container: `position: fixed; left: 12; right: 12; bottom: calc(12px + safe-area); border-radius: 28; padding: 10; background: #FFFFFF; box-shadow: floating`. Contents: `Save draft` (secondary lavender pill, 40 %) + `Submit …` (primary pill, 60 %), 48 px high, `size="large"`. Pages with the bottom bar lift it to `bottom: calc(64px + 12px + 12px + safe)`. The form scroll area gets `padding-bottom` of the bar height + 24. Desktop: inline, right-aligned at the bottom of the form card (no floating bar).

### 8.7 Other portal patterns
- **Lists on phone** (`ResponsiveList`): white cards, radius 20, `card` shadow, min height 88, first-column link + chip on row 1.
- **Empty state:** 72 px lavender blob (`#EDE9FE`) with a 32 px `#5B21B6` icon, `h6` message, `body2` secondary helper, one pill button.
- **Sign-in:** brand panel (>= `md`) uses `hero.gradient` with the logo on a white rounded plate; form side white.

## 9. Page-level patterns (admin)

**List page** top to bottom: (1) page header with title and actions; (2) optional KPI strip (rule 3); (3) filter card: white, radius 20, border `#E7E1F7`, labels above, 12-col grid, `Clear` secondary + `Search` primary right; (4) table card: white, radius 20, header `#F7F4FF`, no vertical lines, 60 px rows (48 compact), selected `#EDE9FE`, bulk bar docked under the table `#EDE9FE`/`#5B21B6`, pagination footer. **Search, filters, pagination and CSV export on every list** unchanged. **Forms and detail:** white cards, `h5` section titles, labels above, 2-up grid from `sm`, error-summary `Alert`, record footer `caption`. **Dialogs:** radius 24, white, pill buttons; destructive confirm `error` contained.

## 10. Density toggle (admin lists)

A `ToggleButtonGroup` (pill segments "Comfortable | Compact", icons + text) in the table-card header, persisted in `localStorage` (`pret.density`), default `comfortable`.

| | Comfortable | Compact |
|---|---|---|
| DataGrid `rowHeight` / table cell padding | 60 / `16px` | 48 / `10px 16px` |
| Avatar in rows | 34 | 28 |
| Filter fields | 44 | 40 (`size="small"`) |
| Header height | 48 | 40 |
| Buttons in toolbars | 40 | 36 |

Not offered on phone (card view). The toggle changes density only; it never hides columns.

## 11. Dark mode

None this release (D35). Keep every colour in `palette.ts` (override object imports from it; no stray hex in components) so a dark scheme can be added later without a redesign.

## 12. Verification (the frontend must add)

1. **Tone test:** for every entry in `tone`, assert contrast >= 4.5 for `fg/bg`, `fg/#FFFFFF` and `solidFg/solid`.
2. **Tile test:** for every entry in `tile`, assert `ink/bg` >= 4.5, `#1F1B3B/bg` >= 4.5, `#5B5675/bg` >= 4.5, `accent/bg` >= 3.
3. **Button test:** `primary`, `secondary`, `success`, `warning`, `error` `main` vs `contrastText` >= 4.5 (primary must be >= 7.0); `#5B21B6` on `#EDE9FE` and `#DDD6FE` >= 4.5 (secondary button states).
4. **Hero test:** `#FFFFFF` and `hero.subtext` on both gradient stops, and on the stop blended with `hero.decor`, >= 4.5.
5. **Non-text test:** `controlBorder` and `focusRing.color` on `#FFFFFF` and `#F7F4FF` >= 3.
6. **Shell test:** `#FFFFFF` on `#6D28D9` (active nav) and `#5B21B6` on `#FFFFFF` (active bottom-bar label) >= 4.5.
7. Visual check against `preview.html` tab B at 1240 px (admin) and 360 px (phone); axe scan on sign-in, Employees list, portal Home and claim form; keyboard walk of the nav, filters, table and dialogs.

## Open UI questions for Albert

1. **Admin calm rules (§0):** OK that the hero is portal-Home only, admin tables stay on plain white, and money/approval screens use the quiet KPI tiles?
2. **Second font:** OK to load Inter for numerals only (money, dates, counts), unless Plus Jakarta Sans proves to have tabular figures at build time? (Costs one extra font request.)
3. **Pastel nav tiles on admin:** keep the five-hue icon tiles, or make all admin nav tiles a single lavender for an even calmer rail? (Reversible with one token.)
4. **Logo:** the PNG is used on the white rail. A mark-only SVG for the collapsed rail and favicon is still missing.

## Ready for GATE 2 (design)?

The Sunrise token set is complete for the frontend (palette with AA checks, tones, pastel tiles, status mapping for every set, type, shape, shadows, component overrides, shell, hero, KPI tiles, floating bars, density, tests). **Ready for Albert to approve the refreshed design** (D35); next, `design-system.md` and `components.md` need a revision pass to these values (separate item). Component behaviour specs remain valid.
