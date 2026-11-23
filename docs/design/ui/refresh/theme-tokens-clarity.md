# PRET — Theme tokens for Direction A "Clarity" (kept for the record)

> **NOT CHOSEN.** Albert chose **Direction B · Sunrise** at GATE 2 (D35). The implementation spec is [`theme-tokens.md`](theme-tokens.md). This file is a condensed record of the Clarity token set (palette, tones, layout, look summary). The long component-override listing was not retained.

**Work item:** W2-009 · **Author:** UI Designer · **Status:** Archived (Direction A, recommended at the time; see [`directions.md`](directions.md)).
**Replaces (had it been chosen):** the colour, type, radius, shadow and component-override values in `docs/design/ui/design-system.md` and `components.md`. **Does not change:** component behaviour, states, field content, flows, roles, mapping of statuses to tones, dd/mm/yyyy, RM 1,234.56.
**Stack:** MUI 7 + Emotion, MUI X Data Grid + Date Pickers, Next.js App Router. Single theme, light only.

---

## 1. Font

Inter stays (`next/font/google`, variable, `display: swap`, subsets `latin`). Only `"tnum"` is applied where numbers align.

```ts
export const FONT_FAMILY = 'var(--font-inter), Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
```

## 2. Layout

```ts
breakpoints: { values: { xs: 0, sm: 600, md: 1024, lg: 1280, xl: 1600 } }, spacing: 8,
pret: { minViewport: 360, drawerWidth: 256, drawerCollapsed: 72, appBarHeight: { xs: 56, md: 64 }, bottomBarHeight: 64,
  contentMaxWidth: 1440, portalMaxWidth: 1100, touchTarget: 44, pageGutter: { xs: 16, md: 32 }, cardPadding: { xs: 16, md: 24 },
  rowHeight: { comfortable: 56, compact: 44 }, focusRing: { width: 2, offset: 2, color: '#4F46E5' } }
```

## 3. Palette

```ts
primary:   { main: '#4F46E5', light: '#818CF8', dark: '#4338CA', contrastText: '#FFFFFF' }   // white on main 6.29; on dark 7.9
secondary: { main: '#4B5563', contrastText: '#FFFFFF' }                                       // 7.56
success:   { main: '#047857', dark: '#065F46' }   // 5.48
info:      { main: '#1D4ED8', dark: '#1E40AF' }   // 6.70
warning:   { main: '#B45309', dark: '#92400E' }   // 5.02
error:     { main: '#B91C1C', dark: '#991B1B' }   // 6.47
text: { primary: '#111827', secondary: '#4B5563', disabled: '#9CA3AF' }   // 17.7 / 7.56
background: { default: '#F8F9FB', paper: '#FFFFFF' }, divider: '#E6E8EE', link: '#4338CA', controlBorder: '#868E9C' /* 3.30 */, rowDivider: '#EEF0F4'
```

Tones `{ bg, fg, border, solid, solidFg }`: grey `#F3F4F6/#374151/#868E9C/#4B5563` · indigo `#EEF2FF/#3730A3/#4F46E5/#4F46E5` · success `#DCFCE7/#166534/#047857/#047857` · info `#DBEAFE/#1E40AF/#1D4ED8/#1D4ED8` · warning `#FEF3C7/#92400E/#B45309/#B45309` · error `#FEE2E2/#991B1B/#B91C1C/#B91C1C` · purple `#EDE9FE/#5B21B6/#6D28D9/#6D28D9` (solidFg white).

Look in one paragraph: flat white cards with a 1 px `#E6E8EE` border, radius 12, buttons radius 8 (sentence case), 40 px inputs with labels above, pill chips with a leading dot, white nav rail with indigo-tint active pill and 3 px bar, DataGrid with no vertical lines and 56 px rows, shadows only on menus/dialogs, light-only. Full override object, status mapping and shell tables were as in the first issue of this file (superseded by Sunrise); if Clarity is ever revived, reissue from `directions.md` section A and the preview's `.dir-a` CSS.

## Open UI questions for Albert
Resolved by D35: direction = B Sunrise.
