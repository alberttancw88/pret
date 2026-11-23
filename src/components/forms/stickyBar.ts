// Phone sticky action bar — Sunrise theme-tokens.md §8.6. On phone (< 600 px) the page's
// action row floats as a white pill container 12 px from the screen edges, lifted above the
// floating bottom bar (AppShell sets --pret-bottom-bar). From `sm` up it is an ordinary inline,
// right-aligned row. Sticky (not fixed), so the bar never covers the last field of the form.
import type { SystemStyleObject } from '@mui/system';
import type { Theme } from '@mui/material/styles';

const PHONE = '@media (max-width:599.95px)';

export const stickyBarSx = (t: Theme): SystemStyleObject<Theme> => ({
  [PHONE]: {
    position: 'sticky',
    bottom: 'calc(var(--pret-bottom-bar, env(safe-area-inset-bottom)) + 12px)',
    zIndex: 3,
    mx: -0.5,
    mt: 2,
    p: 1.25,
    borderRadius: `${t.pret.radius.floating}px`,
    bgcolor: 'background.paper',
    boxShadow: t.pret.shadow.floating,
    // 48 px pill buttons that share the row (Save draft 40 % · Submit 60 % pattern).
    '& .MuiButton-root': { minHeight: 48, flex: '1 1 auto' },
    '& .MuiButton-contained': { flexGrow: 1.5 },
  },
});
