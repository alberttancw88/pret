// PRET type scale — design-system.md §3. Every variant sets explicit size/line-height:
// MUI's defaults are much larger (default h3 = 48px) and must never leak through.
import type { TypographyVariantsOptions } from '@mui/material/styles';

export const FONT_FAMILY =
  'var(--font-inter), Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

const PHONE = '@media (max-width:599.95px)';

export const typography: TypographyVariantsOptions = {
  fontFamily: FONT_FAMILY,
  fontWeightRegular: 400,
  fontWeightMedium: 500,
  fontWeightBold: 700,

  h1: { fontWeight: 700, fontSize: '2rem', lineHeight: 1.25 }, // 32/40 — login brand headline
  h2: {
    fontWeight: 700,
    fontSize: '1.75rem',
    lineHeight: 1.286,
    fontVariantNumeric: 'tabular-nums',
    [PHONE]: { fontSize: '1.5rem', lineHeight: 1.333 }, // 24/32
  },
  h3: {
    fontWeight: 600,
    fontSize: '1.5rem',
    lineHeight: 1.333, // 24/32 — page title (rendered as <h1>)
    [PHONE]: { fontSize: '1.25rem', lineHeight: 1.4 }, // 20/28
  },
  h4: {
    fontWeight: 600,
    fontSize: '1.25rem',
    lineHeight: 1.4, // 20/28 — dialog title
    [PHONE]: { fontSize: '1.125rem', lineHeight: 1.444 }, // 18/26
  },
  h5: { fontWeight: 600, fontSize: '1.125rem', lineHeight: 1.444 }, // 18/26
  h6: { fontWeight: 600, fontSize: '1rem', lineHeight: 1.5 }, // 16/24 — card title
  subtitle1: { fontWeight: 500, fontSize: '1rem', lineHeight: 1.5 }, // 16/24
  subtitle2: { fontWeight: 500, fontSize: '0.875rem', lineHeight: 1.429 }, // 14/20 — nav label
  body1: { fontWeight: 400, fontSize: '1rem', lineHeight: 1.5 }, // 16/24
  body2: { fontWeight: 400, fontSize: '0.875rem', lineHeight: 1.429 }, // 14/20 — table cells
  button: {
    fontWeight: 600,
    fontSize: '0.8125rem',
    lineHeight: 1.538,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  }, // 13/20 UPPERCASE
  caption: { fontWeight: 400, fontSize: '0.75rem', lineHeight: 1.5 }, // 12/18
  overline: {
    fontWeight: 600,
    fontSize: '0.6875rem',
    lineHeight: 1.455,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  }, // 11/16
  kpi: {
    fontFamily: FONT_FAMILY,
    fontWeight: 700,
    fontSize: '1.75rem',
    lineHeight: 1.286,
    fontVariantNumeric: 'tabular-nums',
    [PHONE]: { fontSize: '1.5rem', lineHeight: 1.333 },
  }, // 28/36
  chip: { fontFamily: FONT_FAMILY, fontWeight: 600, fontSize: '0.75rem', lineHeight: 1.333 }, // 12/16
};
