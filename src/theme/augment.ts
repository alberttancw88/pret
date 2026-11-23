// MUI module augmentation for PRET's custom theme tokens — Sunrise (theme-tokens.md §3.4).
import type { TypographyStyle } from '@mui/material/styles';

export type ToneName = 'grey' | 'violet' | 'success' | 'info' | 'warning' | 'error' | 'pink';
export type Tone = { bg: string; fg: string; border: string; solid: string; solidFg: string };

export type TileName = 'lavender' | 'mint' | 'sky' | 'peach' | 'rose';
export type Tile = { bg: string; ink: string; accent: string };

export type Hero = {
  gradient: string;
  /** The two gradient stops (for contrast checks and solid fallbacks). */
  stops: [string, string];
  decor: string;
  subtext: string;
  shadow: string;
};

export type Density = 'comfortable' | 'compact';

export type PretLayout = {
  minViewport: number;
  drawerWidth: number;
  drawerCollapsed: number;
  appBarHeight: { xs: number; md: number };
  bottomBarHeight: number;
  bottomBarInset: number;
  contentMaxWidth: number;
  portalMaxWidth: number;
  touchTarget: number;
  pageGutter: { xs: number; md: number };
  cardPadding: { xs: number; md: number };
  rowHeight: Record<Density, number>;
  inputHeight: { md: number; mdCompact: number; xs: number };
  focusRing: { width: number; offset: number; color: string; onDark: string };
  radius: {
    xs: number;
    input: number;
    menu: number;
    card: number;
    dialog: number;
    hero: number;
    sheet: number;
    floating: number;
    pill: number;
    avatar: number;
  };
  shadow: { card: string; cardHover: string; floating: string; hero: string; cta: string; adminHover: string };
};

declare module '@mui/material/styles' {
  interface Palette {
    tone: Record<ToneName, Tone>;
    tile: Record<TileName, Tile>;
    hero: Hero;
    leaveType: string[];
    link: string;
    controlBorder: string;
    rowDivider: string;
  }
  interface PaletteOptions {
    tone?: Record<ToneName, Tone>;
    tile?: Record<TileName, Tile>;
    hero?: Hero;
    leaveType?: string[];
    link?: string;
    controlBorder?: string;
    rowDivider?: string;
  }
  interface Theme {
    pret: PretLayout;
  }
  interface ThemeOptions {
    pret?: PretLayout;
  }
  interface TypographyVariants {
    kpi: TypographyStyle;
    chip: TypographyStyle;
    fontFamilyNumeric: string;
  }
  interface TypographyVariantsOptions {
    kpi?: TypographyStyle;
    chip?: TypographyStyle;
    fontFamilyNumeric?: string;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    kpi: true;
    chip: true;
  }
}

declare module '@mui/material/Paper' {
  interface PaperPropsVariantOverrides {
    /** Portal card: white, no border, soft violet shadow (theme-tokens.md §7). */
    portal: true;
  }
}

export {};
