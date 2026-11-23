// PRET palette — Direction B "Sunrise" (W2-009, D35): docs/design/ui/refresh/theme-tokens.md §3.
// Every colour the app uses lives here (§11: no stray hex in components) so a dark scheme can
// be added later without a redesign. Contrast ratios are asserted in
// tests/unit/w2-009-theme-contrast.test.mjs (§12).
import type { PaletteOptions } from '@mui/material/styles';
import type { Hero, Tile, TileName, Tone, ToneName } from './augment';

/** Status tones (§3.2) — chips, alerts, banners. `indigo` → `violet`, `purple` → `pink`. */
export const tone: Record<ToneName, Tone> = {
  grey: { bg: '#F3F4F6', fg: '#374151', border: '#857FA3', solid: '#4B5563', solidFg: '#FFFFFF' },
  violet: { bg: '#EDE9FE', fg: '#5B21B6', border: '#6D28D9', solid: '#6D28D9', solidFg: '#FFFFFF' },
  success: { bg: '#DCFCE7', fg: '#166534', border: '#047857', solid: '#047857', solidFg: '#FFFFFF' },
  info: { bg: '#DBEAFE', fg: '#1E40AF', border: '#1D4ED8', solid: '#1D4ED8', solidFg: '#FFFFFF' },
  warning: { bg: '#FEF3C7', fg: '#92400E', border: '#B45309', solid: '#B45309', solidFg: '#FFFFFF' },
  error: { bg: '#FEE2E2', fg: '#991B1B', border: '#B91C1C', solid: '#B91C1C', solidFg: '#FFFFFF' },
  pink: { bg: '#FCE7F3', fg: '#9D174D', border: '#BE185D', solid: '#BE185D', solidFg: '#FFFFFF' },
};

/** Pastel tiles (§3.3): one `ink` for all text and icons on the tile; `accent` for bars/dots. */
export const tile: Record<TileName, Tile> = {
  lavender: { bg: '#EDE9FE', ink: '#4C1D95', accent: '#6D28D9' },
  mint: { bg: '#D1FAE5', ink: '#065F46', accent: '#047857' },
  sky: { bg: '#E0F2FE', ink: '#075985', accent: '#0369A1' },
  peach: { bg: '#FFEDD5', ink: '#9A3412', accent: '#C2410C' },
  rose: { bg: '#FCE7F3', ink: '#9D174D', accent: '#BE185D' },
};
export const TILE_ORDER: TileName[] = ['lavender', 'sky', 'peach', 'mint', 'rose'];

/** Portal Home hero and sign-in brand panel only (§0 rule 2, §3.4). */
export const hero: Hero = {
  gradient: 'linear-gradient(135deg, #6D28D9 0%, #4F46E5 100%)',
  stops: ['#6D28D9', '#4F46E5'],
  decor: 'rgba(255,255,255,0.10)',
  // Spec value #EDE9FE fails §12.4 under the decor circle on the end stop (4.31 : 1);
  // #F5F3FF keeps the look and passes everywhere (≥ 4.67 : 1). See W2-009 frontend report.
  subtext: '#F5F3FF',
  shadow: '0 14px 28px -14px rgba(79,70,229,0.70)',
};

// Leave-type legend colours (LT32). Dots/bars only — text never sits on these; each ≥ 3 : 1 on white.
export const leaveType = ['#6D28D9', '#047857', '#1D4ED8', '#C2410C', '#BE185D', '#0F766E', '#B45309', '#4B5563'];

/** Named surface / line colours used by the theme and a few components. */
export const surface = {
  canvas: '#F7F4FF',
  paper: '#FFFFFF',
  border: '#E7E1F7',
  rowDivider: '#F0EBFB',
  rowHover: '#FBF9FF',
  subtle: '#F1EEFB',
  handle: '#D8CFF0',
  skeleton: '#EFEAFB',
  lavenderHover: '#DDD6FE',
  /** Weekend / non-working cells (6.37 : 1 for #5B5675 text). */
  nonWorking: '#F7F4FF',
  /** Public-holiday cells (peach tile bg). */
  holiday: '#FFEDD5',
  /** Receipt viewer chrome (dark, full-screen image viewer). */
  viewer: '#1F1B3B',
  viewerBar: '#2B2748',
} as const;

export const palette: PaletteOptions = {
  mode: 'light',
  primary: { main: '#6D28D9', light: '#8B5CF6', dark: '#5B21B6', contrastText: '#FFFFFF' },
  secondary: { main: '#5B5675', light: '#857FA3', dark: '#3F3B56', contrastText: '#FFFFFF' },
  success: { main: '#047857', light: '#34D399', dark: '#065F46', contrastText: '#FFFFFF' },
  info: { main: '#1D4ED8', light: '#60A5FA', dark: '#1E40AF', contrastText: '#FFFFFF' },
  warning: { main: '#B45309', light: '#F59E0B', dark: '#92400E', contrastText: '#FFFFFF' },
  error: { main: '#B91C1C', light: '#EF4444', dark: '#991B1B', contrastText: '#FFFFFF' },
  grey: {
    50: '#F7F4FF',
    100: '#F1EEFB',
    200: '#E7E1F7',
    300: '#D8CFF0',
    400: '#A9A3C2',
    500: '#857FA3',
    600: '#5B5675',
    700: '#3F3B56',
    800: '#2B2748',
    900: '#1F1B3B',
  },
  text: { primary: '#1F1B3B', secondary: '#5B5675', disabled: '#A9A3C2' },
  background: { default: surface.canvas, paper: surface.paper },
  divider: surface.border,
  action: {
    hover: 'rgba(109,40,217,0.05)',
    selected: '#EDE9FE',
    focus: 'rgba(109,40,217,0.14)',
    disabledBackground: '#F1EEFB',
    disabled: '#A9A3C2',
  },
  link: '#5B21B6',
  controlBorder: '#857FA3',
  rowDivider: surface.rowDivider,
  tone,
  tile,
  hero,
  leaveType,
};

/** Map legacy tone names (pre-W2-009) and contract tone strings to a ToneName. */
export function toToneName(name: string | null | undefined): ToneName {
  if (name === 'indigo') return 'violet';
  if (name === 'purple') return 'pink';
  return name && name in tone ? (name as ToneName) : 'grey';
}

/** Stable pastel hue for a person (hash of employee number / id; §0 rule 10). */
export function tileFor(key: string | null | undefined): TileName {
  const s = key ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TILE_ORDER[h % TILE_ORDER.length];
}
