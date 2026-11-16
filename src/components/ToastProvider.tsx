'use client';

// Toasts — components.md §11. Success (#0F6B40) or neutral (#1A1D28), 4 s, dismissible,
// one at a time (queued), optional VIEW action. Desktop bottom-left; phone bottom-centre
// above the bottom bar. Never used for blocking errors (interaction-notes §10).
import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Snackbar from '@mui/material/Snackbar';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloseIcon from '@mui/icons-material/Close';

type ToastKind = 'success' | 'info';
type ToastAction = { label: string; href?: string; onClick?: () => void };
type Toast = { id: number; kind: ToastKind; message: string; action?: ToastAction };

type ToastApi = {
  success: (message: string, action?: ToastAction) => void;
  info: (message: string, action?: ToastAction) => void;
};

const ToastContext = React.createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const [queue, setQueue] = React.useState<Toast[]>([]);
  const [current, setCurrent] = React.useState<Toast | null>(null);
  const [open, setOpen] = React.useState(false);
  const nextId = React.useRef(1);

  const push = React.useCallback((kind: ToastKind, message: string, action?: ToastAction) => {
    setQueue((q) => [...q, { id: nextId.current++, kind, message, action }]);
  }, []);

  const api = React.useMemo<ToastApi>(
    () => ({ success: (m, a) => push('success', m, a), info: (m, a) => push('info', m, a) }),
    [push],
  );

  React.useEffect(() => {
    if (!current && queue.length > 0) {
      setCurrent(queue[0]);
      setQueue((q) => q.slice(1));
      setOpen(true);
    }
  }, [queue, current]);

  const close = (_e?: unknown, reason?: string) => {
    if (reason === 'clickaway') return;
    setOpen(false);
  };

  const bg = current?.kind === 'success' ? '#0F6B40' : '#1A1D28';

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Snackbar
        key={current?.id}
        open={open}
        autoHideDuration={4000}
        onClose={close}
        slotProps={{ transition: { onExited: () => setCurrent(null) } }}
        anchorOrigin={phone ? { vertical: 'bottom', horizontal: 'center' } : { vertical: 'bottom', horizontal: 'left' }}
        sx={{
          bottom: { xs: 'calc(56px + 12px + env(safe-area-inset-bottom)) !important', sm: '24px !important' },
          left: { sm: '24px !important' },
        }}
      >
        <Box
          role="status"
          aria-live="polite"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            bgcolor: bg,
            color: '#FFFFFF',
            borderRadius: 2,
            boxShadow: 12,
            pl: 2,
            pr: 0.5,
            py: 0.5,
            minWidth: { sm: 320 },
            maxWidth: 560,
          }}
        >
          {current?.kind === 'success' && <CheckCircleOutlineIcon aria-hidden fontSize="small" />}
          <Typography variant="body2" sx={{ flex: 1, py: 1 }}>
            {current?.message}
          </Typography>
          {current?.action && (
            <Button
              size="small"
              variant="text"
              {...(current.action.href ? { component: NextLink, href: current.action.href } : {})}
              onClick={() => {
                current.action?.onClick?.();
                close();
              }}
              sx={{ color: '#FFFFFF', textDecoration: 'underline', '&:hover': { bgcolor: 'rgba(255,255,255,.12)' } }}
            >
              {current.action.label}
            </Button>
          )}
          <IconButton aria-label="Dismiss" onClick={() => close()} sx={{ color: '#FFFFFF', width: 44, height: 44 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Snackbar>
    </ToastContext.Provider>
  );
}
