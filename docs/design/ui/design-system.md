# PRET — Design System (MUI theme spec)

**Work item:** W1-005 · **Author:** UI Designer · **Status:** Draft for GATE 2 (Design)
**Last updated:** 15/11/2026
**Reads:** `docs/design/reference-interact-ui.md`, `docs/design/ux/*` (wireframes, IA, interaction notes), `docs/01-decisions.md` (D11, D12), PRD status models.
**Companions:** [`components.md`](components.md) (component specs, chip mapping) · [`dashboard-visuals.md`](dashboard-visuals.md).
**Format reference:** Direct Order `design-system.md` (read-only). PRET keeps its brand tokens; it differs where WCAG AA demands (§1.2).

> This is the token layer handed to `createTheme({...})`. Every value is a direct match to
> Interact's measured app (`#666CFF`), a clean-room derivation from the sampled Interact
> logo, or a documented MUI default. No commercial template source is used. **Single company:
> no per-tenant branding, one theme.** **Light theme only** — Direct Order is light-only and
> the Interact reference is light; dark mode is out of Phase 1 scope (the token shape below is
> dark-ready if ever asked). Styles the UX wireframes only — no new screens or features.

---

## 1. Brand source and the AA decisions

### 1.1 Brand colours

| Element | Value | Role in PRET |
|---|---|---|
| App indigo | `#666CFF` (measured in Interact's live app) | **Brand indigo.** Used for non-text brand accents: focus-fill tints, chart series 1, avatar background, login brand panel, logo-adjacent decoration. Exposed as `palette.primary.brand` |
| Logo mark green | sampled `#00E881` (approx `#28C76F`) | Brand family for `palette.success`, darkened to pass AA (below) |
| Logo wordmark blue | sampled `#1F8CFF` (approx `#2E7DF1`) | Brand family for `palette.info` and links, darkened for AA |
| Tagline grey | sampled `#BFBFBF` (approx `#9AA0A6`) | Decorative / disabled only, never text |
| Logo file | `assets/brand/interact-logo.png` | Login split-panel and top of the shell. SVG and mark-only file requested (Open UI question 3) |

### 1.2 Deliberate deviation from Direct Order: an AA-compliant primary

`#666CFF` with white text is **4.07 : 1** (fails WCAG AA 4.5 : 1 for 13 px button labels and 14 px nav labels). Direct Order accepted this for brand parity. PRET's brief requires AA on every button and chip pair, and the nav and every action button are indigo, so PRET splits the token:

| Token | Hex | White on it | Use |
|---|---|---|---|
| `primary.brand` | `#666CFF` | 4.07 | Decorative / non-text only (never carries text) |
| **`primary.main`** | **`#5A5FF2`** | **4.82** | Contained buttons, active nav fill, selected tab indicator, focus-border, checkboxes. Visually the same indigo to the eye (same hue 238 deg, about 6% darker) |
| `primary.dark` | `#4548C9` | 6.95 | Hover/pressed, **links** (6.95 on white, 6.38 on canvas), focus ring |
| `primary.light` | `#8B90FF` | 3.0 | Decorative only |

Result: PRET looks like Interact's app, and every text pair passes AA. This is Open UI question 1 (recommended default already applied).

All other brand-derived colours follow the same rule: nothing that carries text sits below 4.5 : 1 (3 : 1 for non-text UI parts and large text).

---

## 2. Palette (`palette.ts`)

```ts
// theme/palette.ts
import type { PaletteOptions } from '@mui/material/styles';

declare module '@mui/material/styles' {
  interface PaletteColor { brand?: string }
  interface SimplePaletteColorOptions { brand?: string }
  interface Palette { tone: Record<ToneName, Tone>; leaveType: string[]; link: string }
  interface PaletteOptions { tone?: Record<ToneName, Tone>; leaveType?: string[]; link?: string }
}
export type ToneName = 'grey' | 'indigo' | 'success' | 'info' | 'warning' | 'error' | 'purple';
export type Tone = { bg: string; fg: string; border: string; solid: string; solidFg: string };

export const palette: PaletteOptions = {
  mode: 'light',

  primary:   { main: '#5A5FF2', light: '#8B90FF', dark: '#4548C9', contrastText: '#FFFFFF', brand: '#666CFF' },
  secondary: { main: '#5B6578', light: '#8A94A6', dark: '#3E4757', contrastText: '#FFFFFF' }, // 5.87:1 white — "quiet" slate
  success:   { main: '#198754', light: '#4CD08A', dark: '#0F6B40', contrastText: '#FFFFFF' }, // 4.53:1 white (brand green, AA)
  info:      { main: '#1A6FE0', light: '#5B9BFF', dark: '#0F4FAE', contrastText: '#FFFFFF' }, // 4.78:1 white (brand blue, AA)
  warning:   { main: '#B45309', light: '#F59E0B', dark: '#92400E', contrastText: '#FFFFFF' }, // 5.02:1 white (darker than MUI default #ED6C02 = 3.1:1)
  error:     { main: '#D32F2F', light: '#EF5350', dark: '#B42318', contrastText: '#FFFFFF' }, // 4.98:1 white

  grey: {
    50: '#F7F7F9', 100: '#F0F1F5', 200: '#E4E6EC', 300: '#D3D6DE', 400: '#BFBFBF',
    500: '#8F95A3', // 3.0:1 on white — input outlines, unchecked checkbox borders, icons (non-text 3:1)
    600: '#5F6673', 700: '#4B5563', 800: '#374151', 900: '#1F2937',
  },

  text: {
    primary:   '#1A1D28', // 16.8:1 white · 15.4:1 canvas
    secondary: '#5F6673', //  5.78:1 white ·  5.3:1 canvas (Direct Order's #6B7280 is 4.44:1 on the grey canvas — fails)
    disabled:  '#8F95A3', // exempt from contrast (WCAG 1.4.3 disabled exception) — never for live content
  },
  background: { default: '#F4F5F9', paper: '#FFFFFF' },
  divider: '#E4E6EC', // decorative separators only
  action: {
    hover: 'rgba(26, 29, 40, 0.04)', selected: 'rgba(90, 95, 242, 0.08)',
    focus: 'rgba(90, 95, 242, 0.12)', disabledBackground: '#ECEEF3', disabled: '#8F95A3',
  },

  link: '#4548C9', // = primary.dark; 6.95:1 white, 6.38:1 canvas

  // Status "tones" — chips, banners, KPI accents. All text pairs verified (components.md §3.3).
  tone: {
    grey:    { bg: '#ECEEF3', fg: '#374151', border: '#8F95A3', solid: '#4B5563', solidFg: '#FFFFFF' },
    indigo:  { bg: '#EDEDFE', fg: '#3A3FBF', border: '#5A5FF2', solid: '#5A5FF2', solidFg: '#FFFFFF' },
    success: { bg: '#E6F4EC', fg: '#0F6B40', border: '#198754', solid: '#198754', solidFg: '#FFFFFF' },
    info:    { bg: '#E3EEFD', fg: '#0F4FAE', border: '#1A6FE0', solid: '#1A6FE0', solidFg: '#FFFFFF' },
    warning: { bg: '#FFF1DB', fg: '#7A4100', border: '#B45309', solid: '#B45309', solidFg: '#FFFFFF' },
    error:   { bg: '#FCE8E8', fg: '#9B1C1C', border: '#D32F2F', solid: '#B42318', solidFg: '#FFFFFF' },
    purple:  { bg: '#F0E9FB', fg: '#4C2E94', border: '#7B4FC9', solid: '#7B4FC9', solidFg: '#FFFFFF' },
  },

  // Leave-type legend colours (LT32). Dots/bars only — text never sits on these. All >= 3:1 on white.
  leaveType: ['#5A5FF2', '#198754', '#1A6FE0', '#C2410C', '#7B4FC9', '#0E7C7B', '#BE185D', '#8A5A00'],
};
```

**Colour rules**
1. Status is never colour-only: every chip carries its text label (interaction-notes §13).
2. Tone `fg` on tone `bg` and on white is always >= 4.5 : 1 (table in `components.md` §3.3).
3. Charts use `leaveType` / tone `solid` colours plus direct labels; they need a list/table alternative (`dashboard-visuals.md`).
4. Never use `primary.brand` (`#666CFF`) for text or as a text-bearing fill.

---

## 3. Typography (`typography.ts`)

Font **Inter**, self-hosted via `next/font/google` (no runtime request to Google), weights 400/500/600/700, `display: swap`. Numeric columns, money, KPIs and dates use `font-variant-numeric: tabular-nums`.

```ts
// theme/typography.ts
import { Inter } from 'next/font/google';
export const inter = Inter({ subsets: ['latin'], display: 'swap', weight: ['400','500','600','700'], variable: '--font-inter' });

export const typography = {
  fontFamily: 'var(--font-inter), Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
  fontWeightRegular: 400, fontWeightMedium: 500, fontWeightBold: 700,

  h1: { fontWeight: 700, fontSize: '2rem',      lineHeight: 1.25  }, // 32/40 — login brand headline only
  h2: { fontWeight: 700, fontSize: '1.75rem',   lineHeight: 1.286 }, // 28/36 — KPI hero number, rare
  h3: { fontWeight: 600, fontSize: '1.5rem',    lineHeight: 1.333 }, // 24/32 — PAGE TITLE (rendered as <h1>); phone 20/28
  h4: { fontWeight: 600, fontSize: '1.25rem',   lineHeight: 1.4   }, // 20/28 — dialog title, card section heading; phone 18/26
  h5: { fontWeight: 600, fontSize: '1.125rem',  lineHeight: 1.444 }, // 18/26 — sub-section heading
  h6: { fontWeight: 600, fontSize: '1rem',      lineHeight: 1.5   }, // 16/24 — card title, KPI card label
  subtitle1: { fontWeight: 500, fontSize: '1rem',     lineHeight: 1.5   }, // 16/24 — employee name in headers
  subtitle2: { fontWeight: 500, fontSize: '0.875rem', lineHeight: 1.429 }, // 14/20 — nav item label
  body1: { fontWeight: 400, fontSize: '1rem',     lineHeight: 1.5   },  // 16/24 — form text, detail values; phone inputs
  body2: { fontWeight: 400, fontSize: '0.875rem', lineHeight: 1.429 },  // 14/20 — DEFAULT table cell, helper, secondary
  button: { fontWeight: 600, fontSize: '0.8125rem', lineHeight: 1.538, textTransform: 'uppercase' as const, letterSpacing: '0.03em' }, // 13/20 UPPERCASE
  caption: { fontWeight: 400, fontSize: '0.75rem', lineHeight: 1.5 },   // 12/18 — timestamps, footers, chip text base
  overline: { fontWeight: 600, fontSize: '0.6875rem', lineHeight: 1.455, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }, // 11/16 — nav section labels, table group headers
};
```

| Variant | Size / line | Weight | Used for |
|---|---|---|---|
| h1 | 32 / 40 | 700 | Login brand panel headline ("PRET") |
| h2 | 28 / 36 | 700 | Leave-balance "Available" number (tabular) |
| h3 | 24 / 32 (xs 20 / 28) | 600 | **Page title** — `<Typography variant="h3" component="h1">`; one per page (UX shell) |
| h4 | 20 / 28 (xs 18 / 26) | 600 | Dialog titles, detail header reference ("LV-2027-00012") |
| h5 | 18 / 26 | 600 | Section headings inside a page |
| h6 | 16 / 24 | 600 | Card titles, KPI tile labels |
| subtitle1 | 16 / 24 | 500 | Person name in cards and headers |
| subtitle2 | 14 / 20 | 500 | Nav labels, tab labels |
| body1 | 16 / 24 | 400 | Form values, detail values, **all phone inputs (16 px stops iOS zoom)** |
| body2 | 14 / 20 | 400 | Table cells, helper/error text, secondary copy |
| button | 13 / 20 | 600 caps | Every button (`EXPORT .CSV`, `SEARCH` ...) |
| caption | 12 / 18 | 400 | Timestamps, record footer, counters |
| overline | 11 / 16 | 600 caps | Nav section labels, KPI group labels |
| (custom) `kpi` | 28 / 36 | 700 | KPI numbers — `h2` with `tabular-nums` |
| (custom) `chip` | 12 / 16 | 600 | Status chip label |

Phone overrides (`@media (max-width:599.95px)`): h3 -> 20/28, h4 -> 18/26, h2 -> 24/32 ; body2 table cards use 14/20 (never below 14 for content; caption 12 only for non-essential metadata).

Rules: no italics for data (money, dates, references); empty-state hints may be `text.secondary`. Reference numbers use `font-feature-settings: "tnum"` and are copyable.

---

## 4. Spacing, layout and density

MUI 8 px base, `theme.spacing(n)`; no hard-coded pixels in components.

| Token | px | Use |
|---|---|---|
| `spacing(0.5)` | 4 | Icon-to-label gap, chip padding |
| `spacing(1)` | 8 | Dense gaps, chip row gap |
| `spacing(1.5)` | 12 | Table cell vertical padding |
| `spacing(2)` | 16 | Card padding (phone), filter field gap, page gutter on phone (**16 px**) |
| `spacing(3)` | 24 | Card padding (desktop), gap between stacked cards, page padding (desktop) |
| `spacing(4)` | 32 | Dashboard section gap |
| `spacing(6)` | 48 | Login panel padding |

Layout constants (exported as `theme.pret`):

```ts
pret: {
  minViewport: 360,          // design floor; CssBaseline sets body{min-width:360px}
  drawerWidth: 264, drawerCollapsed: 72,
  appBarHeight: { xs: 56, md: 64 },
  bottomBarHeight: 56,       // + env(safe-area-inset-bottom)
  contentMaxWidth: 1440,     // content centred beyond this
  touchTarget: 44,           // phone minimum (WCAG 2.5.5 / UX FR-G-14)
  focusRing: { width: 2, offset: 2, color: '#4548C9' },
}
```

---

## 5. Shape, borders, elevation

```ts
export const shape = { borderRadius: 8 };
```

| Element | Radius |
|---|---|
| Card, Paper, Dialog, Popover, table container | 8 (`shape.borderRadius`) |
| Button, input, select | 8 |
| Chip | 6 (tonal) — pill (16) only for count badges |
| Bottom sheet (top corners) | 16 |
| Avatar | 50% |
| Skeleton | 4 |

**Cards are flat and bordered**, matching the Interact screenshot: `border: 1px solid #E4E6EC; box-shadow: 0 1px 2px rgba(16,24,40,.04)`. Real elevation only for things that float.

| Level | `boxShadow` | Use |
|---|---|---|
| 0 | none | Page, AppBar (bottom border instead), drawer (right border) |
| 1 | `0 1px 2px rgba(16,24,40,.04)` | Cards |
| 4 | `0 4px 12px rgba(16,24,40,.10)` | Menus, popovers, date picker popper, select |
| 8 | `0 12px 24px rgba(16,24,40,.14)` | Dialogs, bottom sheets |
| 12 | `0 8px 16px rgba(16,24,40,.12)` | Snackbars, tooltips |

```ts
const lv = { 0: 'none', 1: '0 1px 2px rgba(16,24,40,.04)', 4: '0 4px 12px rgba(16,24,40,.10)',
             8: '0 12px 24px rgba(16,24,40,.14)', 12: '0 8px 16px rgba(16,24,40,.12)' };
// MUI needs 25 slots: each unused index mirrors the nearest defined level below it.
const shadows = Array.from({ length: 25 }, (_, i) =>
  i === 0 ? lv[0] : i < 4 ? lv[1] : i < 8 ? lv[4] : i < 12 ? lv[8] : lv[12]) as Shadows;
```

Z-index: default MUI (`appBar` 1100, `drawer` 1200, `modal` 1300, `snackbar` 1400, `tooltip` 1500). App bar sits above the drawer on desktop only if the drawer is `temporary`.

---

## 6. Breakpoints and responsive behaviour

Aligned to the UX shell (permanent sidebar at >= 1024 px, phone < 600 px).

```ts
export const breakpoints = { values: { xs: 0, sm: 600, md: 1024, lg: 1280, xl: 1600 } };
```

| Range | Name | Shell | Lists | Forms / dashboards |
|---|---|---|---|---|
| **360 - 599** | Phone (design floor 360) | `temporary` Drawer via hamburger; **bottom bar** (UXQ-07: Home, Leave, Claims, Approvals, More); app bar 56; gutters 16 | Table -> **cards**; filter card -> `Filters (n)` bottom sheet; no bulk select | 1 column; primary action sticky bottom, full width; dialogs -> bottom sheets; date picker full screen; KPI tiles horizontal scroll-snap or 2-up grid |
| 600 - 1023 | Tablet | Temporary Drawer, no bottom bar, gutters 24 | Table (DataGrid) with column hiding by priority; filter card wraps to 2 rows | 2 columns forms; dashboards 2-up |
| 1024 - 1279 | Desktop | Permanent Drawer 264 (collapsible to 72); app bar 64 | Full table | Detail pages 2-column (body + side trail) |
| >= 1280 | Wide desktop | Same; content max 1440 centred | Full table | KPI strips up to 6 across |

Rules: no horizontal page scroll at 360 px (tables convert to cards or the DataGrid scrolls inside its own card only on tablet); min touch target 44 px on phone; safe-area padding for the bottom bar and sticky buttons (`padding-bottom: env(safe-area-inset-bottom)`); `viewport-fit=cover`.

---

## 7. Focus, motion, states (global)

- **Focus ring** (all focusable controls, `:focus-visible` only): `outline: 2px solid #4548C9; outline-offset: 2px`. Contrast 6.95 : 1 on white, 6.38 : 1 on canvas. On an indigo fill (active nav item, contained primary button) the ring still sits outside the element so it stays on white/canvas. Text inputs: 2 px `primary.main` border (4.82 : 1 white) plus the 3 px `action.focus` glow.
- **Input outline** default `#8F95A3` (3.0 : 1, WCAG 1.4.11); hover `#5F6673`; error `#D32F2F`.
- **Disabled**: `text.disabled` on `#ECEEF3`; never used for live content; always accompanied by a tooltip reason where the UX says so.
- **Motion**: 150 ms standard easing for hover/expand; 225 ms for drawers and sheets; `prefers-reduced-motion: reduce` -> durations 0, skeleton shimmer stops (static grey).
- **Selection / hover rows**: `action.hover` fill, never a shadow.
- **Print**: out of scope (payslips/EA are PDF-generated server-side, R1.1).

---

## 8. `createTheme()` assembled

```ts
// theme/index.ts
import { createTheme } from '@mui/material/styles';
import { palette } from './palette';
import { typography } from './typography';
import { shadows } from './shadows';
import { components } from './components'; // overrides listed in components.md; core ones below

export const theme = createTheme({
  palette, typography, shadows,
  shape: { borderRadius: 8 },
  breakpoints: { values: { xs: 0, sm: 600, md: 1024, lg: 1280, xl: 1600 } },
  spacing: 8,
  transitions: { duration: { shortest: 100, shorter: 150, short: 200, standard: 225, complex: 300 } },
  pret: { minViewport: 360, drawerWidth: 264, drawerCollapsed: 72, appBarHeight: { xs: 56, md: 64 },
          bottomBarHeight: 56, contentMaxWidth: 1440, touchTarget: 44,
          focusRing: { width: 2, offset: 2, color: '#4548C9' } },
  components: {
    MuiCssBaseline: { styleOverrides: {
      body: { minWidth: 360, backgroundColor: '#F4F5F9', fontVariantNumeric: 'normal' },
      '*:focus-visible': { outline: '2px solid #4548C9', outlineOffset: 2 },
      '@media (prefers-reduced-motion: reduce)': { '*': { animationDuration: '0.01ms !important', transitionDuration: '0.01ms !important' } },
    } },
    MuiButtonBase: { defaultProps: { disableRipple: false } },
    MuiButton: { defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 8, minHeight: 40, '@media (max-width:599.95px)': { minHeight: 44 } } } },
    MuiIconButton: { styleOverrides: { root: { '@media (max-width:599.95px)': { width: 44, height: 44 } } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiCard: { defaultProps: { elevation: 0 }, styleOverrides: { root: { border: '1px solid #E4E6EC', borderRadius: 8, boxShadow: '0 1px 2px rgba(16,24,40,.04)' } } },
    MuiTextField: { defaultProps: { variant: 'outlined', size: 'small', fullWidth: true } },
    MuiOutlinedInput: { styleOverrides: { notchedOutline: { borderColor: '#8F95A3' },
      input: { '@media (max-width:599.95px)': { fontSize: '1rem', minHeight: 24, paddingBlock: 10 } } } },
    MuiLink: { defaultProps: { underline: 'hover' }, styleOverrides: { root: { color: '#4548C9', fontWeight: 600 } } },
    MuiChip: { styleOverrides: { root: { fontWeight: 600, borderRadius: 6, height: 24 } } },
    MuiTooltip: { defaultProps: { arrow: true, enterTouchDelay: 0 } },
  },
});
```

Full chip, button, input, table and shell overrides are in [`components.md`](components.md).

---

## 9. Accessibility summary (tokens)

WCAG 2.1 AA for EMP/MGR screens (NFR-07), applied to admin screens too.

| Token pair | Ratio | Verdict |
|---|---|---|
| `text.primary` #1A1D28 on white / canvas | 16.8 / 15.4 | AAA |
| `text.secondary` #5F6673 on white / canvas | 5.78 / 5.3 | AA |
| Link #4548C9 on white / canvas | 6.95 / 6.38 | AA |
| White on `primary.main` #5A5FF2 | 4.82 | AA (button, active nav) |
| White on `primary.brand` #666CFF | 4.07 | Fails AA text — **never used with text** |
| White on `success.main` #198754 | 4.53 | AA |
| White on `info.main` #1A6FE0 | 4.78 | AA |
| White on `warning.main` #B45309 | 5.02 | AA |
| White on `error.main` #D32F2F / `error.dark` #B42318 | 4.98 / 6.57 | AA |
| White on `secondary.main` #5B6578 | 5.87 | AA |
| Input outline #8F95A3 on white | 3.0 | Non-text AA (1.4.11) |
| Focus ring #4548C9 on white / canvas / #F4F5F9 | 6.95 / 6.38 | Non-text AA |
| `text.secondary` on canvas, `success.main` on canvas, `primary.main` on canvas | 5.3 / 4.16 / 4.43 | `success.main` and `primary.main` **never used as text on the grey canvas** (only on white cards); use `success.dark` #0F6B40 or `primary.dark` for text-on-canvas |
| Chips and buttons (all tones) | see `components.md` §3.3, §4.2 | All >= 4.5 |

---

## Open UI questions for Albert

1. **Primary indigo and AA.** Brand `#666CFF` with white text is 4.07 : 1 (below AA). I split the token: `#5A5FF2` (4.82 : 1, visually near-identical) on buttons and the active nav, with `#666CFF` kept for non-text brand accents. Direct Order accepted 4.07 : 1; is the AA version fine for PRET? (Recommended: yes.)
2. **Warning colour** is darkened to `#B45309` (amber-brown) from MUI's `#ED6C02` so warning buttons/banners pass AA. Chips use the lighter tonal amber. Confirm.
3. **Logo files.** Only `interact-logo.png` exists. Please supply `interact-logo.svg` and a green "i" mark (`interact-mark.svg`) for the collapsed sidebar and favicon. Until then the collapsed rail shows a cropped PNG mark.
4. **Dark mode** is not designed (matches Direct Order and the Interact reference). Confirm it stays out of Phase 1.
5. **Secondary slate** `#5B6578` has no source in the Interact reference; it is used for quiet actions only. Confirm.

## Ready for GATE 2 (design)?

Tokens (palette with AA fixes, type scale with size/line/weight for every variant, spacing, radius, shadows, breakpoints incl. 360 px phone, `createTheme` assembly) are specified. **Yes — ready for GATE 2 review**, subject to Albert's answers to the open UI questions (defaults applied).
