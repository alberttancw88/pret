'use client';

// Confirm dialog — components.md §7.1. Title names the object/effect; confirm label names
// the effect ("DELETE", "MARK DISBURSED"). Destructive: danger contained confirm, initial
// focus on the safe action (Cancel), Escape/backdrop do not close.
import * as React from 'react';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import ResponsiveDialog from './ResponsiveDialog';

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Positive/finish confirms (e.g. MARK DISBURSED) use the success colour. */
  tone?: 'primary' | 'success' | 'error' | 'warning';
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  tone,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = React.useState(false);
  const color = tone ?? (destructive ? 'error' : 'primary');

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onClose={() => !busy && onClose()}
      title={title}
      disableClose={destructive || busy}
      actions={
        <>
          <Button variant="outlined" color="inherit" onClick={onClose} disabled={busy} autoFocus={destructive}>
            {cancelLabel}
          </Button>
          <Button variant="contained" color={color} onClick={confirm} loading={busy} autoFocus={!destructive}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {typeof body === 'string' ? <Typography variant="body1">{body}</Typography> : body}
    </ResponsiveDialog>
  );
}
