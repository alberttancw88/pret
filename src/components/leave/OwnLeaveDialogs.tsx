'use client';

// Employee actions on own leave (P3 row ⋮ and P4 sticky actions) — wireframes P4:
//   WITHDRAW (Pending) → "Withdraw LV-…? Your 2.0 days will be released." [(KEEP)] [WITHDRAW]
//   CANCEL LEAVE (future Approved, LT30) → Reason (optional, 0/500) [CANCEL LEAVE]
//   REQUEST CANCELLATION (started/past) → Reason * (≥ 10 chars — UXQ-04) [SEND REQUEST]
import * as React from 'react';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { cancelLeave, requestLeaveCancellation, withdrawLeave } from '@/server/actions/leave';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import ResponsiveDialog from '../dialogs/ResponsiveDialog';
import ErrorSummary from '../forms/ErrorSummary';
import { TextInput } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import { daysText } from './common';

export type OwnLeaveTarget = { kind: 'withdraw' | 'cancel' | 'request'; applicationId: string; refNo: string; days: string };

export default function OwnLeaveDialogs({ target, onClose, onDone }: { target: OwnLeaveTarget | null; onClose: () => void; onDone?: () => void }) {
  const r = useActionRunner();
  const [reason, setReason] = React.useState('');
  React.useEffect(() => {
    if (!target) {
      setReason('');
      r.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  if (!target) return null;

  const done = (ok: boolean | undefined) => {
    if (ok) {
      onClose();
      onDone?.();
    }
  };

  if (target.kind === 'withdraw') {
    return (
      <ConfirmDialog
        open
        title={`Withdraw ${target.refNo}?`}
        body={
          <>
            <Typography>Your {daysText(target.days)} will be released.</Typography>
            {r.error && (
              <Typography color="error" sx={{ mt: 1 }}>
                {r.error}
              </Typography>
            )}
          </>
        }
        confirmLabel="Withdraw"
        cancelLabel="Keep"
        destructive
        onClose={onClose}
        onConfirm={async () => {
          const res = await r.run(() => withdrawLeave({ applicationId: target.applicationId }), { success: `${target.refNo} withdrawn. ${daysText(target.days)} released.` });
          done(res?.ok);
        }}
      />
    );
  }

  const request = target.kind === 'request';
  const tooShort = request && reason.trim().length < 10;
  return (
    <ResponsiveDialog
      open
      onClose={() => !r.saving && onClose()}
      title={request ? `Request cancellation of ${target.refNo}?` : `Cancel ${target.refNo}?`}
      disableClose={r.saving}
      actions={
        <>
          <Button variant="outlined" color="inherit" onClick={onClose} disabled={r.saving}>
            Back
          </Button>
          <Button
            variant="contained"
            color="error"
            loading={r.saving}
            disabled={tooShort}
            onClick={async () => {
              const res = await r.run(
                () =>
                  request
                    ? requestLeaveCancellation({ applicationId: target.applicationId, reason: reason.trim() })
                    : cancelLeave({ applicationId: target.applicationId, reason: reason.trim() || null }),
                { success: request ? `Cancellation requested for ${target.refNo}. Your approver has been notified.` : `${target.refNo} cancelled. ${daysText(target.days)} restored.` },
              );
              done(res?.ok);
            }}
          >
            {request ? 'Send request' : 'Cancel leave'}
          </Button>
        </>
      }
    >
      <ErrorSummary error={r.error} fieldErrors={r.fieldErrors} />
      <Typography sx={{ mb: 2 }}>
        {request
          ? 'This leave has started or passed, so your approver must approve the cancellation. The days stay counted until then.'
          : `Your ${daysText(target.days)} will be restored.`}
      </Typography>
      <TextInput
        label="Reason"
        required={request}
        value={reason}
        onChange={setReason}
        maxLength={500}
        multiline
        minRows={3}
        error={r.fieldErrors.reason}
        helper={request ? 'At least 10 characters.' : 'Optional.'}
      />
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
        To change some days, cancel and apply again.
      </Typography>
    </ResponsiveDialog>
  );
}
