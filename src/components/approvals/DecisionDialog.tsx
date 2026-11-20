'use client';

// P30 · Decision dialog — S-AP-05 · F-LV-09 · US-LEAVE-015 (generic approval engine; claims join in W2-005).
// Single: "Approve LV-…?" / "Reject LV-…?" — Comment (approve: optional 0/500) / (reject: * ≥ 5 chars, 0/500).
//   Admin override (UXQ-10, BR-LV-62): "APPROVE AS ADMIN (OVERRIDE)" — reason * (≥ 5 chars).
// Bulk: "Approve 4 selected" — one comment for all · confirm → result table
//   Reference · Result (✓ Approved / ⤳ Moved to L2 / ✕ Rejected / ✕ Skipped) · Note → [DONE].
// Decisions go through the registered actions decideTask / bulkDecide; the database decides who may act
// (no self-approval, first decision wins).
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { BulkDecisionResult, Decision, DecideTaskResult, DecisionOutcome } from '@/server/contracts/approvals';
import { bulkDecide, decideTask } from '@/server/actions/approvals';
import ResponsiveDialog from '../dialogs/ResponsiveDialog';
import { TextInput } from '../forms/fields';
import { useToast } from '../ToastProvider';

export type DecisionKind = 'approve' | 'reject' | 'override_approve' | 'override_reject';
export type DecisionSubject = 'leave' | 'cancellation' | 'credit';

function titleFor(kind: DecisionKind, subject: DecisionSubject, ref: string) {
  const what = subject === 'cancellation' ? `cancellation of ${ref}` : ref;
  switch (kind) {
    case 'approve':
      return `Approve ${what}?`;
    case 'reject':
      return `Reject ${what}?`;
    case 'override_approve':
      return `Approve ${what} as Admin (override)?`;
    case 'override_reject':
      return `Reject ${what} as Admin (override)?`;
  }
}
function confirmLabel(kind: DecisionKind, subject: DecisionSubject) {
  const c = subject === 'cancellation' ? ' cancellation' : '';
  if (kind === 'approve') return `Approve${c}`;
  if (kind === 'reject') return `Reject${c}`;
  if (kind === 'override_approve') return 'Approve as Admin (override)';
  return 'Reject as Admin (override)';
}

export function DecisionDialog({
  open,
  kind,
  subject,
  reference,
  taskId,
  taskVersion,
  onClose,
  onDone,
}: {
  open: boolean;
  kind: DecisionKind;
  subject: DecisionSubject;
  reference: string;
  taskId: string;
  taskVersion: number;
  onClose: () => void;
  onDone?: (r: DecideTaskResult) => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [comment, setComment] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) {
      setComment('');
      setError(null);
      setFieldError(undefined);
    }
  }, [open]);

  const decision: Decision = kind === 'approve' || kind === 'override_approve' ? 'approve' : 'reject';
  const override = kind === 'override_approve' || kind === 'override_reject';
  const needsComment = decision === 'reject' || override;
  const short = needsComment && comment.trim().length < 5;

  const confirm = async () => {
    if (short) {
      setFieldError(override ? 'Give the reason for the Admin override (at least 5 characters).' : 'Add a comment to reject (at least 5 characters).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await decideTask({ taskId, decision, comment: comment.trim() || null, expectedVersion: taskVersion, asOverride: override });
      if (res.ok) {
        toast.success(res.message || (decision === 'approve' ? `${reference} approved.` : `${reference} rejected.`));
        onClose();
        onDone?.(res);
        router.refresh();
      } else {
        setError(res.error);
        setFieldError(res.fieldErrors?.comment);
        // first decision wins — re-read so the view shows "Already decided by …"
        router.refresh();
      }
    } catch {
      setError('Something went wrong. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onClose={() => !busy && onClose()}
      title={titleFor(kind, subject, reference)}
      disableClose={busy || decision === 'reject'}
      actions={
        <>
          <Button variant="outlined" color="inherit" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button variant="contained" color={decision === 'reject' ? 'error' : 'primary'} onClick={confirm} loading={busy}>
            {confirmLabel(kind, subject)}
          </Button>
        </>
      }
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {override && (
        <Typography variant="body2" sx={{ mb: 2 }}>
          You are acting at a level that is not yours. The trail shows “Admin override by you” with your reason.
        </Typography>
      )}
      <TextInput
        label={override ? 'Reason' : 'Comment'}
        required={needsComment}
        value={comment}
        onChange={(v) => {
          setComment(v);
          if (fieldError) setFieldError(undefined);
        }}
        maxLength={500}
        multiline
        minRows={3}
        error={fieldError}
        helper={needsComment ? 'Required — at least 5 characters. Shown to the employee.' : 'Optional. Shown to the employee.'}
      />
    </ResponsiveDialog>
  );
}

const OUTCOME_TEXT: Record<DecisionOutcome, string> = { approved: '✓ Approved', moved_to_next: '⤳ Moved to next level', rejected: '✕ Rejected', skipped: '✕ Skipped' };

export function BulkDecisionDialog({
  open,
  decision,
  items,
  itemLabel = 'items',
  onClose,
  onDone,
}: {
  open: boolean;
  decision: Decision;
  items: { taskId: string; reference: string }[];
  itemLabel?: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [comment, setComment] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<string | undefined>();
  const [result, setResult] = React.useState<BulkDecisionResult | null>(null);
  React.useEffect(() => {
    if (!open) {
      setComment('');
      setError(null);
      setFieldError(undefined);
      setResult(null);
    }
  }, [open]);
  const reject = decision === 'reject';
  const short = reject && comment.trim().length < 5;

  const run = async () => {
    if (short) {
      setFieldError('Add a comment to decline (at least 5 characters).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await bulkDecide({ taskIds: items.map((i) => i.taskId), decision, comment: comment.trim() || null });
      if (res.ok) {
        setResult(res);
        router.refresh();
      } else {
        setError(res.error);
        setFieldError(res.fieldErrors?.comment);
      }
    } catch {
      setError('Something went wrong. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const title = result
    ? `${reject ? 'Declined' : 'Approved'}: ${result.approved + result.moved + result.rejected} of ${result.rows.length}`
    : `${reject ? 'Decline' : 'Approve'} ${items.length} selected ${itemLabel}`;

  return (
    <ResponsiveDialog
      open={open}
      onClose={() => !busy && (result ? (onDone?.(), onClose()) : onClose())}
      title={title}
      disableClose={busy}
      maxWidth="md"
      actions={
        result ? (
          <Button
            variant="contained"
            onClick={() => {
              onDone?.();
              onClose();
            }}
          >
            Done
          </Button>
        ) : (
          <>
            <Button variant="outlined" color="inherit" onClick={onClose} disabled={busy}>
              Back
            </Button>
            <Button variant="contained" color={reject ? 'error' : 'primary'} onClick={run} loading={busy}>
              {reject ? 'Decline selected' : 'Approve selected'}
            </Button>
          </>
        )
      }
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {result ? (
        <>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {result.approved} approved · {result.moved} moved to the next level · {result.rejected} rejected · {result.skipped} skipped
          </Typography>
          <Table size="small" aria-label="Decision results">
            <TableHead>
              <TableRow>
                <TableCell>Reference</TableCell>
                <TableCell>Employee</TableCell>
                <TableCell>Result</TableCell>
                <TableCell>Note</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {result.rows.map((r) => (
                <TableRow key={r.taskId}>
                  <TableCell className="pret-tnum">{r.reference}</TableCell>
                  <TableCell>{r.employeeName}</TableCell>
                  <TableCell sx={{ color: r.outcome === 'skipped' || r.outcome === 'rejected' ? '#B42318' : r.outcome === 'approved' ? '#198754' : undefined, whiteSpace: 'nowrap' }}>
                    {OUTCOME_TEXT[r.outcome]}
                  </TableCell>
                  <TableCell>{r.note ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      ) : (
        <>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Only items where you are the current approver are actioned; others are reported as skipped. One {reject ? 'comment' : 'comment (optional)'} applies to all.
          </Typography>
          <TextInput
            label="Comment"
            required={reject}
            value={comment}
            onChange={(v) => {
              setComment(v);
              if (fieldError) setFieldError(undefined);
            }}
            maxLength={500}
            multiline
            minRows={3}
            error={fieldError}
            helper={reject ? 'Required — at least 5 characters.' : 'Optional.'}
          />
        </>
      )}
    </ResponsiveDialog>
  );
}
