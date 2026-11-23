'use client';

// Reason-required dialog — components.md §7.2 (reject, cancel, undo disbursement, override).
// The confirm button names the effect and stays disabled until a non-blank reason is typed;
// tapping it while blocked shows "Add a reason." under the field.
import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ResponsiveDialog from './ResponsiveDialog';

export type ReasonDialogProps = {
  open: boolean;
  title: string;
  /** e.g. "REJECT CLAIM", "CANCEL CLAIM", "UNDO DISBURSEMENT". */
  confirmLabel: string;
  /** Field label without the asterisk — "Reason" (default) or "Comment" (leave reject). */
  fieldLabel?: string;
  /** Message when blocked — "Add a reason." or "Add a comment to reject." */
  requiredMessage?: string;
  intro?: React.ReactNode;
  maxLength?: number;
  tone?: 'error' | 'warning' | 'primary';
  onConfirm: (reason: string) => void | Promise<void>;
  onClose: () => void;
};

export default function ReasonDialog({
  open,
  title,
  confirmLabel,
  fieldLabel = 'Reason',
  requiredMessage = 'Add a reason.',
  intro,
  maxLength = 500,
  tone = 'error',
  onConfirm,
  onClose,
}: ReasonDialogProps) {
  const [reason, setReason] = React.useState('');
  const [showError, setShowError] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const fieldId = React.useId();
  const blank = reason.trim().length === 0;

  React.useEffect(() => {
    if (!open) {
      setReason('');
      setShowError(false);
    }
  }, [open]);

  const confirm = async () => {
    if (blank) {
      setShowError(true);
      return;
    }
    setBusy(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setBusy(false);
    }
  };

  const atLimit = reason.length >= maxLength;

  return (
    <ResponsiveDialog
      open={open}
      onClose={() => !busy && onClose()}
      title={title}
      disableClose
      actions={
        <>
          <Button variant="outlined" color="inherit" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {/* Disabled buttons swallow clicks; the wrapper catches the blocked tap. */}
          <Box component="span" onClick={() => blank && setShowError(true)} sx={{ display: 'inline-flex', '& > button': { width: '100%' } }}>
            <Button variant="contained" color={tone} onClick={confirm} disabled={blank} loading={busy}>
              {confirmLabel}
            </Button>
          </Box>
        </>
      }
    >
      {intro && <Box sx={{ mb: 2 }}>{typeof intro === 'string' ? <Typography>{intro}</Typography> : intro}</Box>}
      <TextField
        id={fieldId}
        label={fieldLabel}
        required
        autoFocus
        multiline
        minRows={3}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value.slice(0, maxLength));
          if (showError) setShowError(false);
        }}
        error={showError && blank}
        helperText={showError && blank ? requiredMessage : ' '}
        slotProps={{ htmlInput: { maxLength } }}
        sx={{ mt: 1 }}
      />
      <Typography
        variant="caption"
        component="p"
        aria-live="polite"
        sx={{ textAlign: 'right', color: atLimit ? 'error.main' : 'text.secondary', mt: -2 }}
      >
        {reason.length}/{maxLength}
      </Typography>
    </ResponsiveDialog>
  );
}
