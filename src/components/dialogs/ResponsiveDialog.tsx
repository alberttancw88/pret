'use client';

// Dialog on desktop/tablet; bottom sheet on phone (< 600 px) — components.md §7.
// Both are modal: focus is trapped and returned to the trigger on close.
import * as React from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Drawer from '@mui/material/Drawer';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';

export type ResponsiveDialogProps = {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  /** Escape / backdrop close is disabled for destructive dialogs and while busy. */
  disableClose?: boolean;
  maxWidth?: 'xs' | 'sm' | 'md';
  /** Element id used for aria-labelledby; generated when omitted. */
  titleId?: string;
};

export default function ResponsiveDialog({
  open,
  onClose,
  title,
  children,
  actions,
  disableClose,
  maxWidth = 'sm',
  titleId,
}: ResponsiveDialogProps) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const autoId = React.useId();
  const id = titleId ?? `dlg-${autoId}`;

  const handleClose = (_e: unknown, reason?: 'backdropClick' | 'escapeKeyDown') => {
    if (disableClose && (reason === 'backdropClick' || reason === 'escapeKeyDown')) return;
    onClose();
  };

  if (phone) {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={handleClose}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-modal': true,
            'aria-labelledby': id,
            sx: {
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              maxHeight: '90dvh',
              boxShadow: 8,
              borderRight: 0,
            },
          } as object,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1 }} aria-hidden>
          <Box sx={{ width: 32, height: 4, borderRadius: 2, bgcolor: '#D3D6DE' }} />
        </Box>
        <Typography id={id} variant="h4" component="h2" sx={{ px: 2, pt: 1.5, pb: 1 }}>
          {title}
        </Typography>
        <Box sx={{ px: 2, pb: 2, overflowY: 'auto' }}>{children}</Box>
        {actions && (
          <Box
            sx={{
              position: 'sticky',
              bottom: 0,
              display: 'flex',
              gap: 1,
              flexDirection: 'column-reverse',
              px: 2,
              pt: 1.5,
              pb: 'calc(12px + env(safe-area-inset-bottom))',
              bgcolor: 'background.paper',
              borderTop: '1px solid',
              borderColor: 'divider',
              '& > .MuiButton-root': { width: '100%', minHeight: 48 },
            }}
          >
            {actions}
          </Box>
        )}
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth={maxWidth} fullWidth aria-labelledby={id}>
      <DialogTitle id={id} component="h2">
        {title}
      </DialogTitle>
      {children && <DialogContent>{children}</DialogContent>}
      {actions && <DialogActions>{actions}</DialogActions>}
    </Dialog>
  );
}
