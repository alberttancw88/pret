'use client';

// PRET MUI theme — Direction B "Sunrise" (W2-009, D34/D35): docs/design/ui/refresh/theme-tokens.md.
// Light theme only. Single company: one theme, no per-tenant branding. Colours come from
// palette.ts; component overrides follow §7, shell §8, density §10.
import { createTheme, type Shadows } from '@mui/material/styles';
import type {} from '@mui/x-date-pickers/themeAugmentation';
import './augment';
import { palette, surface, tone } from './palette';
import { FONT_NUMERIC, typography } from './typography';

const PHONE = '@media (max-width:599.95px)';

const C = {
  primary: '#6D28D9',
  primaryDark: '#5B21B6',
  lavender: '#EDE9FE',
  lavenderHover: surface.lavenderHover,
  text: '#1F1B3B',
  text2: '#5B5675',
  control: '#857FA3',
  disabledText: '#A9A3C2',
  border: surface.border,
  canvas: surface.canvas,
  rowDivider: surface.rowDivider,
  rowHover: surface.rowHover,
  subtle: surface.subtle,
  error: '#B91C1C',
  errorDark: '#991B1B',
  errorBg: '#FEE2E2',
  successDark: '#065F46',
  warningDark: '#92400E',
};

// Shadows (§6): admin surfaces are flat; tinted shadows only on floating or lifted things.
const lv = {
  0: 'none',
  1: '0 1px 2px rgba(31,27,59,0.06)',
  4: '0 12px 32px -8px rgba(31,27,59,0.22), 0 0 0 1px rgba(109,40,217,0.06)',
  8: '0 28px 56px -16px rgba(31,27,59,0.35)',
  12: '0 28px 56px -16px rgba(31,27,59,0.40)',
};
export const shadows = Array.from({ length: 25 }, (_, i) =>
  i === 0 ? lv[0] : i < 4 ? lv[1] : i < 8 ? lv[4] : i < 12 ? lv[8] : lv[12],
) as Shadows;

export const radius = { xs: 8, input: 14, menu: 16, card: 20, dialog: 24, hero: 26, sheet: 28, floating: 28, pill: 999, avatar: 12 };

export const pretLayout = {
  minViewport: 360,
  drawerWidth: 264,
  drawerCollapsed: 80,
  appBarHeight: { xs: 56, md: 64 },
  bottomBarHeight: 64,
  bottomBarInset: 12,
  contentMaxWidth: 1440,
  portalMaxWidth: 1100,
  touchTarget: 44,
  pageGutter: { xs: 16, md: 32 },
  cardPadding: { xs: 16, md: 24 },
  rowHeight: { comfortable: 60, compact: 48 },
  inputHeight: { md: 44, mdCompact: 40, xs: 48 },
  focusRing: { width: 2, offset: 2, color: C.primary, onDark: '#FFFFFF' },
  radius,
  shadow: {
    card: '0 8px 24px -10px rgba(109,40,217,0.28)',
    cardHover: '0 12px 28px -10px rgba(109,40,217,0.34)',
    floating: '0 12px 28px -8px rgba(31,27,59,0.35)',
    hero: '0 14px 28px -14px rgba(79,70,229,0.70)',
    cta: '0 6px 16px -6px rgba(109,40,217,0.55)',
    adminHover: lv[1],
  },
};

export const theme = createTheme({
  palette,
  typography,
  shadows,
  shape: { borderRadius: 14 },
  breakpoints: { values: { xs: 0, sm: 600, md: 1024, lg: 1280, xl: 1600 } },
  spacing: 8,
  transitions: { duration: { shortest: 100, shorter: 150, short: 200, standard: 225, complex: 300 } },
  pret: pretLayout,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { WebkitTextSizeAdjust: '100%' },
        body: { minWidth: 360, backgroundColor: C.canvas, color: C.text, fontVariantNumeric: 'normal' },
        '*:focus-visible': { outline: `2px solid ${C.primary}`, outlineOffset: 2 },
        '.pret-on-dark *:focus-visible, .pret-on-dark:focus-visible': { outline: '2px solid #FFFFFF', outlineOffset: 2 },
        '.pret-tnum': { fontFamily: FONT_NUMERIC, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum"' },
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

    // ---- Buttons: pill, sentence case (§7) ----
    MuiButtonBase: { defaultProps: { disableRipple: false } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: radius.pill,
          textTransform: 'none',
          fontWeight: 700,
          minHeight: 40,
          padding: '0 20px',
          [PHONE]: { minHeight: 44 },
          '&.Mui-disabled': {
            cursor: 'not-allowed',
            pointerEvents: 'auto',
            backgroundColor: C.subtle,
            color: C.disabledText,
            borderColor: 'transparent',
          },
          variants: [
            { props: { size: 'small' }, style: { minHeight: 32, padding: '0 14px', [PHONE]: { minHeight: 44 } } },
            { props: { size: 'large' }, style: { minHeight: 48, padding: '0 24px' } },
            { props: { variant: 'text' }, style: { padding: '0 12px' } },
            { props: { variant: 'text', size: 'small' }, style: { padding: '0 10px' } },
            { props: { variant: 'contained', color: 'primary' }, style: { '&:hover': { backgroundColor: C.primaryDark } } },
            // CTA glow: phone and size="large" only (§0 rule 6).
            {
              props: { variant: 'contained', color: 'primary' },
              style: { [PHONE]: { boxShadow: pretLayout.shadow.cta, '&.Mui-disabled': { boxShadow: 'none' } } },
            },
            {
              props: { variant: 'contained', color: 'primary', size: 'large' },
              style: { boxShadow: pretLayout.shadow.cta, '&.Mui-disabled': { boxShadow: 'none' } },
            },
            { props: { variant: 'contained', color: 'success' }, style: { '&:hover': { backgroundColor: C.successDark } } },
            { props: { variant: 'contained', color: 'error' }, style: { '&:hover': { backgroundColor: C.errorDark } } },
            { props: { variant: 'contained', color: 'warning' }, style: { '&:hover': { backgroundColor: C.warningDark } } },
            // Secondary / neutral: lavender fill, no border (#5B21B6 on #EDE9FE = 7.56).
            {
              props: { variant: 'outlined', color: 'inherit' },
              style: {
                backgroundColor: C.lavender,
                color: C.primaryDark,
                borderColor: 'transparent',
                '&:hover': { backgroundColor: C.lavenderHover, borderColor: 'transparent' },
              },
            },
            // Outlined primary (camera / choose file, Save draft).
            {
              props: { variant: 'outlined', color: 'primary' },
              style: { color: C.primaryDark, borderColor: C.primary, '&:hover': { backgroundColor: C.lavender, borderColor: C.primary } },
            },
            // Danger trigger.
            {
              props: { variant: 'outlined', color: 'error' },
              style: { color: C.error, borderColor: C.error, '&:hover': { backgroundColor: C.errorBg, borderColor: C.error } },
            },
            { props: { variant: 'text', color: 'primary' }, style: { color: C.primaryDark, '&:hover': { backgroundColor: C.lavender } } },
            { props: { variant: 'text', color: 'error' }, style: { color: C.error, '&:hover': { backgroundColor: C.errorBg } } },
            { props: { variant: 'text', color: 'inherit' }, style: { '&:hover': { backgroundColor: C.subtle } } },
          ],
        },
        startIcon: { '& > *:nth-of-type(1)': { fontSize: 18 } },
        endIcon: { '& > *:nth-of-type(1)': { fontSize: 18 } },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { borderRadius: 14, [PHONE]: { width: 44, height: 44 } },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          color: C.text2,
          borderColor: surface.handle,
          borderRadius: radius.pill,
          padding: '6px 14px',
          [PHONE]: { minHeight: 44 },
          '&.Mui-selected': { backgroundColor: C.lavender, color: C.primaryDark, '&:hover': { backgroundColor: C.lavenderHover } },
        },
        sizeSmall: { padding: '4px 12px', fontSize: 13 },
      },
    },
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: { borderRadius: radius.pill },
        grouped: {
          '&:not(:first-of-type)': { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
          '&:not(:last-of-type)': { borderTopRightRadius: 0, borderBottomRightRadius: 0 },
        },
      },
    },

    // ---- Surfaces ----
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none' }, rounded: { borderRadius: radius.card } },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: `1px solid ${C.border}`,
          borderRadius: radius.card,
          boxShadow: 'none',
          variants: [
            { props: { variant: 'portal' }, style: { border: 'none', boxShadow: pretLayout.shadow.card } },
          ],
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: { padding: 24, '&:last-child': { paddingBottom: 24 }, [PHONE]: { padding: 16, '&:last-child': { paddingBottom: 16 } } },
      },
    },
    MuiCardActionArea: {
      styleOverrides: { root: { borderRadius: 'inherit' } },
    },
    MuiAccordion: {
      styleOverrides: {
        root: {
          border: `1px solid ${C.border}`,
          boxShadow: 'none',
          '&:before': { display: 'none' },
          '&:first-of-type': { borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
          '&:last-of-type': { borderBottomLeftRadius: radius.card, borderBottomRightRadius: radius.card },
        },
      },
    },

    // ---- Inputs: label ABOVE the field, 44 px (phone 48, small 40), radius 14 ----
    MuiTextField: { defaultProps: { variant: 'outlined', size: 'medium', fullWidth: true } },
    MuiFormControl: { defaultProps: { variant: 'outlined' } },
    MuiInputLabel: {
      defaultProps: { shrink: true },
      styleOverrides: {
        root: {
          position: 'static',
          transform: 'none',
          maxWidth: '100%',
          whiteSpace: 'normal',
          overflow: 'visible',
          pointerEvents: 'auto',
          marginBottom: 6,
          fontSize: 13,
          lineHeight: '18px',
          fontWeight: 600,
          color: C.text2,
          '&.Mui-focused': { color: C.primaryDark },
          '&.Mui-error': { color: C.error },
          '&.Mui-disabled': { color: C.control },
        },
        asterisk: { color: 'inherit' },
      },
    },
    MuiFormLabel: {
      styleOverrides: {
        root: {
          fontSize: 13,
          lineHeight: '18px',
          fontWeight: 600,
          color: C.text2,
          '&.Mui-focused': { color: C.primaryDark },
          '&.Mui-error': { color: C.error },
        },
      },
    },
    MuiOutlinedInput: {
      defaultProps: { notched: false },
      styleOverrides: {
        root: {
          borderRadius: radius.input,
          backgroundColor: '#FFFFFF',
          minHeight: 44,
          '&.MuiInputBase-sizeSmall': { minHeight: 40 },
          [PHONE]: { minHeight: 48, '&.MuiInputBase-sizeSmall': { minHeight: 44 } },
          '& legend': { display: 'none' },
          '& fieldset': { top: 0 },
          '&:hover:not(.Mui-disabled):not(.Mui-focused):not(.Mui-error) .MuiOutlinedInput-notchedOutline': { borderColor: C.text2 },
          '&.Mui-focused': { boxShadow: '0 0 0 3px rgba(109,40,217,0.18)' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: C.primary, borderWidth: 2 },
          '&.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: C.error, borderWidth: 2 },
          '&.Mui-disabled': { backgroundColor: C.subtle },
          '&.Mui-disabled .MuiOutlinedInput-notchedOutline': { borderColor: C.border },
          '&.Mui-readOnly': { backgroundColor: C.canvas },
          // The focus ring is the glow + border; don't double it with the global outline.
          '& input:focus-visible, & textarea:focus-visible': { outline: 'none' },
        },
        notchedOutline: { borderColor: C.control },
        input: {
          fontSize: 15,
          fontWeight: 500,
          padding: '11px 14px',
          [PHONE]: { fontSize: 16, paddingBlock: 12 },
        },
        inputSizeSmall: { padding: '8.5px 14px', [PHONE]: { paddingBlock: 10 } },
        multiline: { padding: '11px 14px', [PHONE]: { paddingBlock: 12 } },
      },
    },
    MuiInputBase: {
      styleOverrides: {
        input: { '&::placeholder': { color: C.text2, opacity: 1 } },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root:not(.MuiInputBase-sizeSmall)': { paddingTop: 3, paddingBottom: 3 },
          [PHONE]: { '& .MuiOutlinedInput-root:not(.MuiInputBase-sizeSmall)': { paddingTop: 5, paddingBottom: 5 } },
        },
        paper: { borderRadius: radius.menu, boxShadow: lv[4], marginTop: 4 },
        option: { borderRadius: 10, margin: '0 6px', [PHONE]: { minHeight: 44 } },
        tag: { borderRadius: radius.pill },
      },
    },
    MuiFormHelperText: {
      styleOverrides: {
        root: { marginLeft: 2, fontSize: 12.5, lineHeight: '17px', fontWeight: 500, color: C.text2, '&.Mui-error': { color: C.error } },
      },
    },
    MuiCheckbox: {
      styleOverrides: { root: { color: C.control, '&.Mui-checked, &.MuiCheckbox-indeterminate': { color: C.primary }, [PHONE]: { padding: 10 } } },
    },
    MuiRadio: {
      styleOverrides: { root: { color: C.control, '&.Mui-checked': { color: C.primary }, [PHONE]: { padding: 10 } } },
    },
    MuiSwitch: {
      // Phone pass (W2-006): 44 × 44 touch area (PRD §8.4) with the same 34 × 14 track.
      styleOverrides: {
        root: { [PHONE]: { width: 64, height: 44, padding: 15 } },
        switchBase: {
          [PHONE]: { padding: 12 },
          '&.Mui-checked': { color: '#FFFFFF', '& + .MuiSwitch-track': { backgroundColor: C.primary, opacity: 1 } },
        },
        track: { backgroundColor: C.control, opacity: 1, borderRadius: radius.pill },
      },
    },
    MuiLink: {
      defaultProps: { underline: 'hover' },
      styleOverrides: { root: { color: C.primaryDark, fontWeight: 700, '&:focus-visible': { textDecoration: 'underline' } } },
    },

    // ---- Date pickers (§7.1): field matches the outlined input; days are pills ----
    MuiPickersOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: radius.input,
          backgroundColor: '#FFFFFF',
          '&:hover:not(.Mui-disabled):not(.Mui-focused):not(.Mui-error) .MuiPickersOutlinedInput-notchedOutline': { borderColor: C.text2 },
          '&.Mui-focused': { boxShadow: '0 0 0 3px rgba(109,40,217,0.18)' },
          '&.Mui-focused:not(.Mui-error) .MuiPickersOutlinedInput-notchedOutline': { borderColor: C.primary, borderWidth: 2 },
          '&.Mui-error .MuiPickersOutlinedInput-notchedOutline': { borderColor: C.error, borderWidth: 2 },
          '&.Mui-disabled': { backgroundColor: C.subtle },
          '&.Mui-disabled .MuiPickersOutlinedInput-notchedOutline': { borderColor: C.border },
          '&.Mui-readOnly': { backgroundColor: C.canvas },
          '& legend': { display: 'none' },
          minHeight: 44,
          [PHONE]: { minHeight: 48 },
          variants: [{ props: { inputSize: 'small' }, style: { minHeight: 40, [PHONE]: { minHeight: 44 } } }],
        },
        notchedOutline: { borderColor: C.control, top: 0 },
        sectionsContainer: {
          fontSize: 15,
          padding: '11px 0',
          [PHONE]: { fontSize: 16, padding: '12px 0' },
          variants: [{ props: { inputSize: 'small' }, style: { padding: '8.5px 0', [PHONE]: { padding: '10px 0' } } }],
        },
      },
    },
    MuiPickerPopper: {
      styleOverrides: { paper: { borderRadius: radius.menu, boxShadow: lv[4] } },
    },
    MuiPickerDay: {
      styleOverrides: {
        root: {
          '&.Mui-selected': { backgroundColor: C.primary, color: '#FFFFFF' },
          '&.Mui-selected:hover, &.Mui-selected:focus': { backgroundColor: C.primaryDark },
          '&:not(.Mui-selected).MuiPickerDay-today': { borderColor: C.primary },
          [PHONE]: { width: 44, height: 44 },
        },
      },
    },

    // ---- Chips (StatusChip builds on this) ----
    MuiChip: {
      styleOverrides: {
        root: { height: 24, borderRadius: radius.pill, fontWeight: 700, fontSize: 12.5 },
        label: { paddingLeft: 10, paddingRight: 10 },
        icon: { fontSize: 14, marginLeft: 6, marginRight: -4 },
      },
    },

    MuiTooltip: {
      defaultProps: { arrow: true, enterTouchDelay: 0 },
      styleOverrides: {
        tooltip: { backgroundColor: C.text, color: '#FFFFFF', fontSize: 12.5, lineHeight: '18px', fontWeight: 500, borderRadius: 10, padding: '6px 12px' },
        arrow: { color: C.text },
      },
    },
    MuiMenu: {
      styleOverrides: { paper: { borderRadius: radius.menu, boxShadow: lv[4], marginTop: 4 } },
    },
    MuiPopover: {
      styleOverrides: { paper: { borderRadius: radius.menu, boxShadow: lv[4] } },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: 14.5,
          fontWeight: 500,
          borderRadius: 10,
          margin: '0 6px',
          '&.Mui-selected': { backgroundColor: C.lavender, color: C.primaryDark, fontWeight: 700 },
          '&.Mui-selected:hover': { backgroundColor: C.lavenderHover },
          [PHONE]: { minHeight: 44 },
        },
      },
    },
    MuiSelect: {
      defaultProps: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 320 } } } } },
    },

    // ---- Dialogs and sheets ----
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: radius.dialog, boxShadow: lv[8] } },
    },
    MuiDialogTitle: {
      defaultProps: { variant: 'h4' },
      styleOverrides: { root: { padding: '28px 28px 8px' } },
    },
    MuiDialogContent: { styleOverrides: { root: { padding: '8px 28px' } } },
    MuiDialogActions: { styleOverrides: { root: { padding: 28, gap: 8, '& > :not(style) ~ :not(style)': { marginLeft: 0 } } } },
    MuiBackdrop: {
      styleOverrides: {
        root: { '&:not(.MuiBackdrop-invisible)': { backgroundColor: 'rgba(31,27,59,0.5)' } },
      },
    },

    // ---- Shell (§8) ----
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: {
          backgroundColor: C.canvas,
          borderBottom: '1px solid transparent',
          transition: 'background-color 150ms, border-color 150ms',
          '&.pret-scrolled': { backgroundColor: '#FFFFFF', borderBottomColor: C.border },
        },
      },
    },
    MuiDrawer: {
      styleOverrides: { paper: { backgroundColor: '#FFFFFF', borderRight: `1px solid ${C.border}`, borderRadius: 0 } },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          '&:hover': { backgroundColor: C.canvas },
          '&.Mui-selected': { backgroundColor: C.lavender, color: C.primaryDark },
        },
      },
    },
    MuiListItemIcon: { styleOverrides: { root: { minWidth: 0, color: 'inherit' } } },
    MuiBottomNavigation: {
      styleOverrides: { root: { height: 64, backgroundColor: 'transparent' } },
    },
    MuiBottomNavigationAction: {
      styleOverrides: {
        root: {
          minWidth: 56,
          maxWidth: 'none',
          padding: '6px 0 4px',
          color: C.text2,
          '&.Mui-selected': { color: C.primaryDark, paddingTop: 6 },
        },
        label: { fontSize: 12.5, lineHeight: '16px', fontWeight: 600, marginTop: 2, '&.Mui-selected': { fontSize: 12.5, fontWeight: 700 } },
      },
    },
    MuiBreadcrumbs: {
      styleOverrides: { root: { fontSize: 12.5, color: C.text2 }, separator: { margin: '0 6px' } },
    },
    MuiAvatar: {
      styleOverrides: {
        root: { fontSize: 12, fontWeight: 800 },
        rounded: { borderRadius: radius.avatar },
        colorDefault: { backgroundColor: C.lavender, color: C.primaryDark },
      },
    },

    // ---- Tables: plain white card, lavender-white header, comfortable rows (§7, §10) ----
    MuiTableCell: {
      styleOverrides: {
        root: { fontSize: 14.5, lineHeight: '21px', fontWeight: 500, padding: '16px 16px', borderBottom: `1px solid ${C.rowDivider}` },
        head: {
          fontSize: 13,
          lineHeight: '18px',
          fontWeight: 700,
          color: C.text2,
          backgroundColor: C.canvas,
          whiteSpace: 'nowrap',
          paddingTop: 16,
          paddingBottom: 16,
          borderBottom: `1px solid ${C.border}`,
        },
        sizeSmall: { padding: '10px 16px', '&.MuiTableCell-head': { paddingTop: 12, paddingBottom: 12 } },
        paddingCheckbox: { padding: '0 0 0 8px' },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&.MuiTableRow-hover:hover': { backgroundColor: C.rowHover },
          '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: C.lavender },
          '&:last-of-type > .MuiTableCell-body': { borderBottom: 0 },
        },
      },
    },
    MuiTableSortLabel: {
      styleOverrides: { root: { '&.Mui-active': { color: C.text } } },
    },
    MuiTablePagination: {
      styleOverrides: {
        root: { borderTop: `1px solid ${C.border}`, color: C.text2 },
        toolbar: { minHeight: 56 },
        selectLabel: { fontSize: 13.5 },
        displayedRows: { fontSize: 13.5, fontFamily: FONT_NUMERIC, fontVariantNumeric: 'tabular-nums' },
        actions: { '& .MuiIconButton-root': { borderRadius: '50%', [PHONE]: { width: 44, height: 44 } } },
      },
    },

    // ---- Feedback ----
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          fontSize: 14.5,
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
              props: { variant: 'outlined' as const },
              style: { backgroundColor: '#FFFFFF' },
            },
            {
              props: { variant: 'filled' as const },
              style: { border: 'none' },
            },
          ],
        },
        message: { fontWeight: 500 },
      },
    },
    MuiAlertTitle: {
      styleOverrides: { root: { fontWeight: 700, fontSize: 14.5, marginBottom: 4 } },
    },
    MuiSnackbarContent: {
      styleOverrides: { root: { backgroundColor: C.text, color: '#FFFFFF', borderRadius: 16 } },
    },
    MuiBadge: {
      styleOverrides: {
        badge: { fontSize: 12.5, lineHeight: '16px', fontWeight: 700, minWidth: 20, height: 20, borderRadius: radius.pill, padding: '0 6px' },
        dot: { minWidth: 8, height: 8, padding: 0 },
      },
    },
    MuiSkeleton: {
      defaultProps: { animation: 'wave' },
      styleOverrides: { root: { backgroundColor: surface.skeleton, borderRadius: 14 } },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { height: 6, borderRadius: 6, backgroundColor: C.border }, bar: { borderRadius: 6 } },
    },
    MuiDivider: {
      styleOverrides: { root: { borderColor: C.border } },
    },

    // ---- Tabs: pill segments (calm on admin) ----
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 40 },
        indicator: { display: 'none' },
        list: { gap: 8 },
        scroller: { padding: '2px 0' },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 40,
          minWidth: 0,
          padding: '0 16px',
          borderRadius: radius.pill,
          textTransform: 'none',
          fontSize: 14.5,
          fontWeight: 600,
          color: C.text2,
          '&:hover': { backgroundColor: C.subtle },
          '&.Mui-selected': { backgroundColor: C.lavender, color: C.primaryDark, fontWeight: 700 },
          [PHONE]: { minHeight: 44 },
        },
      },
    },
  },
});

export default theme;
