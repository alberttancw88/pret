'use client';

// Own-claim actions shared by P12 (row ⋮), P13 (form) and P15 (detail):
//   SUBMIT  → submitClaim; blocks listed per line ("Line 3: Exceeds RM 300.00 per transaction"); warnings need
//             "[x] I understand" (re-submit with acknowledgeWarnings) — interaction-notes §3, BR-CLM-10–22.
//   WITHDRAW (Submitted) · DELETE (New) · COPY TO NEW CLAIM (Rejected → P13 with "Copied from CL-…").
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ClaimIssue, SubmitClaimResult } from '@/server/contracts/claims';
import { copyClaim, deleteClaim, submitClaim, withdrawClaim } from '@/server/actions/claims';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import ResponsiveDialog from '../dialogs/ResponsiveDialog';
import { useToast } from '../ToastProvider';
import { useIdempotencyKey } from '../leave/common';

export type OwnClaimTarget = { kind: 'submit' | 'withdraw' | 'delete' | 'copy'; claimId: string; claimNo: string; version?: number; editHref?: string };

/** Summary card listing blocks and warnings per line. */
export function IssueSummary({ issues, title }: { issues: ClaimIssue[]; title?: string }) {
  const blocks = issues.filter((i) => i.severity === 'block');
  const warns = issues.filter((i) => i.severity === 'warn');
  const line = (i: ClaimIssue) => `${i.lineNo ? `Line ${i.lineNo}: ` : ''}${i.message}`;
  return (
    <Stack spacing={1}>
      {blocks.length > 0 && (
        <Alert severity="error" variant="outlined" role="alert">
          <AlertTitle>{title ?? "Can't submit yet"}</AlertTitle>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {blocks.map((i, n) => (
              <li key={`b${n}`}>{line(i)}</li>
            ))}
          </ul>
        </Alert>
      )}
      {warns.length > 0 && (
        <Alert severity="warning" variant="outlined">
          <AlertTitle>Please check</AlertTitle>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {warns.map((i, n) => (
              <li key={`w${n}`}>{line(i)}</li>
            ))}
          </ul>
        </Alert>
      )}
    </Stack>
  );
}

/** Submit flow with the acknowledgement step. onSubmitted gets the server result (message for the toast / success page). */
export function SubmitClaimDialog({
  target,
  onClose,
  onSubmitted,
}: {
  target: { claimId: string; claimNo: string; version?: number; editHref?: string } | null;
  onClose: () => void;
  onSubmitted?: (r: SubmitClaimResult) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<SubmitClaimResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ack, setAck] = React.useState(false);
  React.useEffect(() => {
    if (!target) {
      setResult(null);
      setError(null);
      setAck(false);
    }
  }, [target]);
  if (!target) return null;
  const blocks = result?.issues.filter((i) => i.severity === 'block') ?? [];

  const run = async (acknowledgeWarnings: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await submitClaim({ claimId: target.claimId, expectedVersion: target.version, acknowledgeWarnings });
      if (!res.ok) setError(res.error);
      else if (res.submitted) {
        toast.success(res.message || `${res.claimNo} submitted.`);
        onClose();
        onSubmitted?.(res);
        router.refresh();
      } else {
        setResult(res);
        setAck(false);
      }
    } catch {
      setError('Something went wrong. The claim was not submitted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog
      open
      onClose={() => !busy && onClose()}
      title={`Submit ${target.claimNo}?`}
      disableClose={busy}
      actions={
        <>
          <Button variant="outlined" color="inherit" onClick={onClose} disabled={busy}>
            Back
          </Button>
          {blocks.length > 0 && target.editHref ? (
            <Button variant="contained" component={NextLink} href={target.editHref}>
              Edit claim
            </Button>
          ) : (
            <Button variant="contained" loading={busy} disabled={Boolean(result?.needsAcknowledgement && !ack) || blocks.length > 0} onClick={() => run(Boolean(result?.needsAcknowledgement && ack))}>
              Submit
            </Button>
          )}
        </>
      }
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {!result && <Typography>The claim goes to your manager or an Admin for approval. You can withdraw it until it is decided.</Typography>}
      {result && <IssueSummary issues={result.issues} />}
      {result?.needsAcknowledgement && blocks.length === 0 && (
        <FormControlLabel sx={{ mt: 1 }} control={<Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} />} label="I understand — my approver will see these flags." />
      )}
    </ResponsiveDialog>
  );
}

export default function OwnClaimDialogs({ target, onClose, onDeleted }: { target: OwnClaimTarget | null; onClose: () => void; onDeleted?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [copyKey] = useIdempotencyKey();
  if (!target) return null;
  if (target.kind === 'submit') return <SubmitClaimDialog target={target} onClose={onClose} />;
  if (target.kind === 'withdraw')
    return (
      <ConfirmDialog
        open
        destructive
        title={`Withdraw ${target.claimNo}?`}
        body="It leaves the approval queue and stops counting toward your limits."
        confirmLabel="Withdraw"
        onClose={onClose}
        onConfirm={async () => {
          const res = await withdrawClaim({ claimId: target.claimId });
          if (res.ok) {
            toast.success(`${target.claimNo} withdrawn.`);
            onClose();
            router.refresh();
          } else toast.info(res.error);
        }}
      />
    );
  if (target.kind === 'delete')
    return (
      <ConfirmDialog
        open
        destructive
        title={`Delete ${target.claimNo}?`}
        body="This cannot be undone."
        confirmLabel="Delete claim"
        onClose={onClose}
        onConfirm={async () => {
          const res = await deleteClaim({ claimId: target.claimId });
          if (res.ok) {
            toast.success(`${target.claimNo} deleted.`);
            onClose();
            if (onDeleted) onDeleted();
            else router.refresh();
          } else toast.info(res.error);
        }}
      />
    );
  return (
    <ConfirmDialog
      open
      title={`Copy ${target.claimNo} to a new claim?`}
      body="A new claim (New) is created with the same title, lines and receipts. The rejected claim stays unchanged. Lines are checked again when you submit."
      confirmLabel="Copy to new claim"
      onClose={onClose}
      onConfirm={async () => {
        const res = await copyClaim({ claimId: target.claimId, idempotencyKey: copyKey });
        if (res.ok) {
          toast.success(`Copied to ${res.claimNo}.`);
          onClose();
          router.push(`/my/claims/${encodeURIComponent(res.claimNo)}/edit`);
        } else toast.info(res.error);
      }}
    />
  );
}
