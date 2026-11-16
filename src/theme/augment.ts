// MUI module augmentation for PRET's custom theme tokens (design-system.md §2–§4).
import type { TypographyStyle } from '@mui/material/styles';

export type ToneName = 'grey' | 'indigo' | 'success' | 'info' | 'warning' | 'error' | 'purple';
export type Tone = { bg: string; fg: string; border: string; solid: string; solidFg: string };

export type PretLayout = {
  minViewport: number;
  drawerWidth: number;
  drawerCollapsed: number;
  appBarHeight: { xs: number; md: number };
  bottomBarHeight: number;
  contentMaxWidth: number;
  touchTarget: number;
  focusRing: { width: number; offset: number; color: string };
};

declare module '@mui/material/styles' {
  interface PaletteColor {
    brand?: string;
  }
  interface SimplePaletteColorOptions {
    brand?: string;
  }
  interface Palette {
    tone: Record<ToneName, Tone>;
    leaveType: string[];
    link: string;
  }
  interface PaletteOptions {
    tone?: Record<ToneName, Tone>;
    leaveType?: string[];
    link?: string;
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
  }
  interface TypographyVariantsOptions {
    kpi?: TypographyStyle;
    chip?: TypographyStyle;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    kpi: true;
    chip: true;
  }
}

export {};
