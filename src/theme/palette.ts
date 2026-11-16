// PRET palette — design-system.md §2 (GATE 2 approved, D24).
// primary.main #5A5FF2 is the AA-compliant indigo for text-bearing fills; the measured
// Interact brand indigo #666CFF is kept as primary.brand for non-text accents only.
import type { PaletteOptions } from '@mui/material/styles';
import type { Tone, ToneName } from './augment';

export const tone: Record<ToneName, Tone> = {
  grey: { bg: '#ECEEF3', fg: '#374151', border: '#8F95A3', solid: '#4B5563', solidFg: '#FFFFFF' },
  indigo: { bg: '#EDEDFE', fg: '#3A3FBF', border: '#5A5FF2', solid: '#5A5FF2', solidFg: '#FFFFFF' },
  success: { bg: '#E6F4EC', fg: '#0F6B40', border: '#198754', solid: '#198754', solidFg: '#FFFFFF' },
  info: { bg: '#E3EEFD', fg: '#0F4FAE', border: '#1A6FE0', solid: '#1A6FE0', solidFg: '#FFFFFF' },
  warning: { bg: '#FFF1DB', fg: '#7A4100', border: '#B45309', solid: '#B45309', solidFg: '#FFFFFF' },
  error: { bg: '#FCE8E8', fg: '#9B1C1C', border: '#D32F2F', solid: '#B42318', solidFg: '#FFFFFF' },
  purple: { bg: '#F0E9FB', fg: '#4C2E94', border: '#7B4FC9', solid: '#7B4FC9', solidFg: '#FFFFFF' },
};

// Leave-type legend colours (LT32). Dots/bars only — text never sits on these.
export const leaveType = ['#5A5FF2', '#198754', '#1A6FE0', '#C2410C', '#7B4FC9', '#0E7C7B', '#BE185D', '#8A5A00'];

export const palette: PaletteOptions = {
  mode: 'light',
  primary: { main: '#5A5FF2', light: '#8B90FF', dark: '#4548C9', contrastText: '#FFFFFF', brand: '#666CFF' },
  secondary: { main: '#5B6578', light: '#8A94A6', dark: '#3E4757', contrastText: '#FFFFFF' },
  success: { main: '#198754', light: '#4CD08A', dark: '#0F6B40', contrastText: '#FFFFFF' },
  info: { main: '#1A6FE0', light: '#5B9BFF', dark: '#0F4FAE', contrastText: '#FFFFFF' },
  warning: { main: '#B45309', light: '#F59E0B', dark: '#92400E', contrastText: '#FFFFFF' },
  error: { main: '#D32F2F', light: '#EF5350', dark: '#B42318', contrastText: '#FFFFFF' },
  grey: {
    50: '#F7F7F9',
    100: '#F0F1F5',
    200: '#E4E6EC',
    300: '#D3D6DE',
    400: '#BFBFBF',
    500: '#8F95A3',
    600: '#5F6673',
    700: '#4B5563',
    800: '#374151',
    900: '#1F2937',
  },
  text: { primary: '#1A1D28', secondary: '#5F6673', disabled: '#8F95A3' },
  background: { default: '#F4F5F9', paper: '#FFFFFF' },
  divider: '#E4E6EC',
  action: {
    hover: 'rgba(26, 29, 40, 0.04)',
    selected: 'rgba(90, 95, 242, 0.08)',
    focus: 'rgba(90, 95, 242, 0.12)',
    disabledBackground: '#ECEEF3',
    disabled: '#8F95A3',
  },
  link: '#4548C9',
  tone,
  leaveType,
};
