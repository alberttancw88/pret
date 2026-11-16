'use client';

// PRET MUI theme — implements docs/design/ui/design-system.md §2–§8 and the component
// overrides in docs/design/ui/components.md. Light theme only (D24). Single company:
// one theme, no per-tenant branding.
import { createTheme, type Shadows } from '@mui/material/styles';
import './augment';
import { palette, tone } from './palette';
import { typography } from './typography';

const PHONE = '@media (max-width:599.95px)';
const BORDER = '#E4E6EC';
const FOCUS = '#4548C9';

// Shadow levels 0/1/4/8/12 (design-system.md §5); MUI needs 25 slots, each unused
// index mirrors the nearest defined level below it.
const lv = {
  0: 'none',
  1: '0 1px 2px rgba(16,24,40,.04)',
  4: '0 4px 12px rgba(16,24,40,.10)',
  8: '0 12px 24px rgba(16,24,40,.14)',
  12: '0 8px 16px rgba(16,24,40,.12)',
};
export const shadows = Array.from({ length: 25 }, (_, i) =>
  i === 0 ? lv[0] : i < 4 ? lv[1] : i < 8 ? lv[4] : i < 12 ? lv[8] : lv[12],
) as Shadows;

export const pretLayout = {
  minViewport: 360,
  drawerWidth: 264,
  drawerCollapsed: 72,
  appBarHeight: { xs: 56, md: 64 },
  bottomBarHeight: 56,
  contentMaxWidth: 1440,
  touchTarget: 44,
  focusRing: { width: 2, offset: 2, color: FOCUS },
};

export const theme = createTheme({
  palette,
  typography,
  shadows,
  shape: { borderRadius: 8 },
  breakpoints: { values: { xs: 0, sm: 600, md: 1024, lg: 1280, xl: 1600 } },
  spacing: 8,
  transitions: { duration: { shortest: 100, shorter: 150, short: 200, standard: 225, complex: 300 } },
  pret: pretLayout,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { WebkitTextSizeAdjust: '100%' },
        body: { minWidth: 360, backgroundColor: '#F4F5F9', fontVariantNumeric: 'normal' },
        '*:focus-visible': { outline: `2px solid ${FOCUS}`, outlineOffset: 2 },
        '.pret-tnum': { fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum"' },
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            transitionDuration: '0.01ms !important',
          },
        },
      },
    },
    MuiTypography: {
      defaultProps: {
        variantMapping: {
          h1: 'h1',
          h2: 'h2',
          h3: 'h3',
          h4: 'h4',
          h5: 'h5',
          h6: 'h6',
          subtitle1: 'p',
          subtitle2: 'p',
          body1: 'p',
          body2: 'p',
          kpi: 'p',
          chip: 'span',
        },
      },
    },
    MuiButtonBase: { defaultProps: { disableRipple: false } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 8,
          minHeight: 40,
          [PHONE]: { minHeight: 44 },
          '&.Mui-disabled': { cursor: 'not-allowed', pointerEvents: 'auto' },
          variants: [
            {
              props: { size: 'small' },
              style: { minHeight: 32, [PHONE]: { minHeight: 44 } },
            },
            {
              // Danger trigger (components.md §1): red border, #B42318 text.
              props: { variant: 'outlined', color: 'error' },
              style: { color: '#B42318', borderColor: '#D32F2F', '&:hover': { backgroundColor: '#FCE8E8', borderColor: '#B42318' } },
            },
            {
              // Secondary / neutral.
              props: { variant: 'outlined', color: 'inherit' },
              style: { color: '#1A1D28', borderColor: '#8F95A3', '&:hover': { backgroundColor: 'rgba(26,29,40,0.04)', borderColor: '#5F6673' } },
            },
            {
              props: { variant: 'text', color: 'primary' },
              style: { color: FOCUS, '&:hover': { backgroundColor: 'rgba(90,95,242,.08)' } },
            },
            {
              props: { variant: 'outlined', color: 'primary' },
              style: { color: FOCUS },
            },
          ],
        },
        startIcon: { '& > *:nth-of-type(1)': { fontSize: 18 } },
        endIcon: { '& > *:nth-of-type(1)': { fontSize: 18 } },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { [PHONE]: { width: 44, height: 44 } },
      },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: lv[1] },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: { padding: 24, '&:last-child': { paddingBottom: 24 }, [PHONE]: { padding: 16, '&:last-child': { paddingBottom: 16 } } },
      },
    },
    MuiTextField: { defaultProps: { variant: 'outlined', size: 'small', fullWidth: true } },
    MuiInputLabel: {
      styleOverrides: { root: { color: '#5F6673', '&.Mui-focused': { color: FOCUS }, '&.Mui-error': { color: '#B42318' } } },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          '&:hover:not(.Mui-disabled):not(.Mui-focused):not(.Mui-error) .MuiOutlinedInput-notchedOutline': { borderColor: '#5F6673' },
          '&.Mui-focused': { boxShadow: '0 0 0 3px rgba(90,95,242,.18)' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#5A5FF2', borderWidth: 2 },
          '&.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: '#D32F2F', borderWidth: 2 },
          '&.Mui-disabled': { backgroundColor: '#F7F7F9' },
          '&.Mui-disabled .MuiOutlinedInput-notchedOutline': { borderColor: BORDER },
          // The focus ring is the glow + border; don't double it with the global outline.
          '& input:focus-visible, & textarea:focus-visible': { outline: 'none' },
        },
        notchedOutline: { borderColor: '#8F95A3' },
        input: { [PHONE]: { fontSize: '1rem', minHeight: 24, paddingBlock: 10 } },
      },
    },
    MuiFormHelperText: {
      styleOverrides: {
        root: { marginLeft: 2, fontSize: '0.75rem', lineHeight: 1.5, color: '#5F6673', '&.Mui-error': { color: '#B42318' } },
      },
    },
    MuiCheckbox: {
      styleOverrides: { root: { color: '#8F95A3', [PHONE]: { padding: 10 } } },
    },
    MuiRadio: {
      styleOverrides: { root: { color: '#8F95A3', [PHONE]: { padding: 10 } } },
    },
    MuiLink: {
      defaultProps: { underline: 'hover' },
      styleOverrides: { root: { color: FOCUS, fontWeight: 600, '&:focus-visible': { textDecoration: 'underline' } } },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, borderRadius: 6, height: 24 },
        label: { paddingLeft: 8, paddingRight: 8 },
      },
    },
    MuiTooltip: {
      defaultProps: { arrow: true, enterTouchDelay: 0 },
      styleOverrides: {
        tooltip: { backgroundColor: '#1A1D28', color: '#FFFFFF', fontSize: '0.75rem', lineHeight: 1.5 },
        arrow: { color: '#1A1D28' },
      },
    },
    MuiMenu: {
      styleOverrides: { paper: { boxShadow: lv[4], border: `1px solid ${BORDER}` } },
    },
    MuiPopover: {
      styleOverrides: { paper: { boxShadow: lv[4] } },
    },
    MuiMenuItem: {
      styleOverrides: { root: { fontSize: '0.875rem', [PHONE]: { minHeight: 44 } } },
    },
    MuiSelect: {
      defaultProps: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 320 } } } } },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: 8, boxShadow: lv[8] } },
    },
    MuiDialogTitle: {
      defaultProps: { variant: 'h4' },
      styleOverrides: { root: { padding: '24px 24px 8px' } },
    },
    MuiDialogContent: { styleOverrides: { root: { padding: '8px 24px' } } },
    MuiDialogActions: { styleOverrides: { root: { padding: 24, gap: 8, '& > :not(style) ~ :not(style)': { marginLeft: 0 } } } },
    MuiBackdrop: {
      styleOverrides: {
        root: { '&:not(.MuiBackdrop-invisible)': { backgroundColor: 'rgba(26,29,40,.5)' } },
      },
    },
    MuiDrawer: {
      styleOverrides: { paper: { borderRight: `1px solid ${BORDER}` } },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: { root: { backgroundColor: '#FFFFFF', borderBottom: `1px solid ${BORDER}` } },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { fontSize: '0.875rem', lineHeight: 1.429, padding: '12px 16px', borderBottom: `1px solid ${BORDER}` },
        head: {
          fontSize: '0.8125rem',
          lineHeight: 1.538,
          fontWeight: 600,
          color: '#5F6673',
          backgroundColor: '#F7F7F9',
          whiteSpace: 'nowrap',
          '&:not(:last-of-type)': { borderRight: `1px solid ${BORDER}` },
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&.MuiTableRow-hover:hover': { backgroundColor: 'rgba(26,29,40,0.04)' },
          '&.Mui-selected': { backgroundColor: 'rgba(90,95,242,0.08)' },
        },
      },
    },
    MuiTablePagination: {
      styleOverrides: {
        root: { borderTop: `1px solid ${BORDER}` },
        toolbar: { minHeight: 52 },
        selectLabel: { fontSize: '0.875rem' },
        displayedRows: { fontSize: '0.875rem', fontVariantNumeric: 'tabular-nums' },
        actions: { '& .MuiIconButton-root': { [PHONE]: { width: 44, height: 44 } } },
      },
    },
    MuiTabs: {
      styleOverrides: { root: { minHeight: 48 }, indicator: { height: 3, backgroundColor: '#5A5FF2' } },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 48,
          textTransform: 'none',
          fontSize: '0.875rem',
          fontWeight: 500,
          color: '#5F6673',
          '&.Mui-selected': { color: FOCUS, fontWeight: 600 },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontSize: '0.875rem',
          variants: [
            ...(['success', 'info', 'warning', 'error'] as const).map((sev) => ({
              props: { severity: sev },
              style: {
                backgroundColor: tone[sev].bg,
                color: tone[sev].fg,
                border: `1px solid ${tone[sev].border}`,
                '& .MuiAlert-icon': { color: tone[sev].fg },
              },
            })),
            {
              props: { variant: 'filled' as const },
              style: { border: 'none' },
            },
          ],
        },
        message: { fontWeight: 400 },
      },
    },
    MuiAlertTitle: {
      styleOverrides: { root: { fontWeight: 600, fontSize: '0.875rem', marginBottom: 4 } },
    },
    MuiBadge: {
      styleOverrides: {
        badge: { fontSize: '0.75rem', lineHeight: 1.333, fontWeight: 600, minWidth: 20, height: 20, borderRadius: 10 },
      },
    },
    MuiSkeleton: {
      defaultProps: { animation: 'wave' },
      styleOverrides: { root: { backgroundColor: '#ECEEF3', borderRadius: 4 } },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { height: 2, backgroundColor: '#EDEDFE' } },
    },
    MuiListItemButton: {
      styleOverrides: { root: { borderRadius: 8 } },
    },
    MuiBottomNavigationAction: {
      styleOverrides: {
        root: {
          minWidth: 64,
          color: '#5F6673',
          '&.Mui-selected': { color: FOCUS },
        },
        label: { fontSize: '0.75rem', lineHeight: 1.333, '&.Mui-selected': { fontSize: '0.75rem' } },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
          color: '#374151',
          borderColor: '#8F95A3',
          [PHONE]: { minHeight: 44 },
          '&.Mui-selected': { backgroundColor: '#EDEDFE', color: '#3A3FBF', '&:hover': { backgroundColor: '#E2E3FD' } },
        },
      },
    },
  },
});

export default theme;
