// PRET type scale — Sunrise (theme-tokens.md §4). Every variant sets explicit size/line-height:
// MUI's defaults are much larger (default h3 = 48px) and must never leak through.
//
// Numerals (§1): Plus Jakarta Sans ships tabular figures (`tnum`), verified in the browser for
// W2-009 (digits measure equal width with tabular-nums), so FONT_NUMERIC uses the same face and
// the optional Inter request is dropped. Money, counts and dates use `.pret-tnum`.
import type { TypographyVariantsOptions } from '@mui/material/styles';

export const FONT_FAMILY =
  'var(--font-jakarta), "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
export const FONT_NUMERIC = FONT_FAMILY;

const PHONE = '@media (max-width:599.95px)';

const px = (n: number) => `${n / 16}rem`;

export const typography: TypographyVariantsOptions = {
  fontFamily: FONT_FAMILY,
  fontFamilyNumeric: FONT_NUMERIC,
  fontWeightRegular: 400,
  fontWeightMedium: 600,
  fontWeightBold: 700,

  // Sign-in headline
  h1: { fontWeight: 800, fontSize: px(32), lineHeight: px(40), letterSpacing: '-0.02em', [PHONE]: { fontSize: px(28), lineHeight: px(36) } },
  // Large figures
  h2: {
    fontWeight: 800,
    fontSize: px(28),
    lineHeight: px(36),
    letterSpacing: '-0.02em',
    fontVariantNumeric: 'tabular-nums',
    [PHONE]: { fontSize: px(24), lineHeight: px(32) },
  },
  // Page title (rendered as <h1>)
  h3: { fontWeight: 800, fontSize: px(26), lineHeight: px(34), letterSpacing: '-0.02em', [PHONE]: { fontSize: px(22), lineHeight: px(30) } },
  // Dialog title, detail header
  h4: { fontWeight: 700, fontSize: px(20), lineHeight: px(28), letterSpacing: '-0.01em', [PHONE]: { fontSize: px(18), lineHeight: px(26) } },
  // Card section title
  h5: { fontWeight: 700, fontSize: px(18), lineHeight: px(26), letterSpacing: '-0.005em', [PHONE]: { fontSize: px(17), lineHeight: px(24) } },
  // Card title, hero section title
  h6: { fontWeight: 700, fontSize: px(16), lineHeight: px(24), letterSpacing: 0 },
  subtitle1: { fontWeight: 600, fontSize: px(16), lineHeight: px(24) },
  subtitle2: { fontWeight: 600, fontSize: px(14), lineHeight: px(20) }, // nav label, row title
  body1: { fontWeight: 400, fontSize: px(15), lineHeight: px(22), [PHONE]: { fontSize: px(16), lineHeight: px(24) } },
  body2: { fontWeight: 400, fontSize: px(14), lineHeight: px(20) }, // table cells, helper copy
  button: {
    fontWeight: 700,
    fontSize: px(14),
    lineHeight: px(20),
    textTransform: 'none', // sentence case (D35)
    letterSpacing: 0,
    [PHONE]: { fontSize: px(15) },
  },
  caption: { fontWeight: 500, fontSize: px(12), lineHeight: px(18) },
  overline: {
    fontWeight: 700,
    fontSize: px(12),
    lineHeight: px(16),
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  kpi: {
    fontFamily: FONT_NUMERIC,
    fontWeight: 800,
    fontSize: px(32),
    lineHeight: px(38),
    letterSpacing: '-0.02em',
    fontVariantNumeric: 'tabular-nums',
    [PHONE]: { fontSize: px(28), lineHeight: px(34) },
  },
  chip: { fontFamily: FONT_FAMILY, fontWeight: 700, fontSize: px(12), lineHeight: px(16) },
};
