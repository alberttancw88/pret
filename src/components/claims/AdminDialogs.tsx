'use client';

// C15 · AutoCount claims postings export — S-CL-15 · dialog · F-CLM-27 · US-CLAIM-024 (D10, layout Q37)
//   Source * (•) Disbursement batch [PB-… ▾] (•) Date range [from] [to] · Include statuses * [x] Approved [x] Disbursed ·
//   Document date (from setting, shown) · preview row count · blocked list "Category without GL account: {name} [FIX]" ·
//   columns (template order per Q37) · EXPORT .XLSX (logged).
// C16 · Download attachment bundle — S-CL-16 · dialog · F-CLM-26 · US-CLAIM-018
//   "Download {n} receipts from {m} claims as one .zip? Files are named <claim no.>-<line>-<n>.<ext>. The download is logged."
import * as React from 'react';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { AttachmentBundleInput, AttachmentBundlePreview, AutocountPreview } from '@/server/contracts/claims';
import { downloadAttachmentBundle, exportAutocount, previewAttachmentBundle, previewAutocountExport } from '@/server/actions/claims';
import ResponsiveDialog from '../dialogs/ResponsiveDialog';
import { CheckboxInput, DateInput, RadioInput, SelectInput } from '../forms/fields';
import { useToast } from '../ToastProvider';
import { formatMoney } from '@/lib/format';
import { formatBytes } from '../leave/upload';

export function AttachmentBundleDialog({ open, onClose, input, scopeLabel }: { open: boolean; onClose: () => void; input: AttachmentBundleInput; scopeLabel: string }) {
  const toast = useToast();
  const [preview, setPreview] = React.useState<AttachmentBundlePreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const key = JSON.stringify(input);
  React.useEffect(() => {
    if (!open) {
      setPreview(null);
      setError(null);
      return;
    }
    let alive = true;
    previewAttachmentBundle(JSON.parse(key) as AttachmentBundleInput)
      .then((r) => alive && (r.ok ? setPreview(r) : setError(r.error)))
      .catch(() => alive && setError('Could not count the receipts.'));
    return () => {
      alive = false;
    };
  }, [open, key]);
  const run = async () => {
    setBusy(true);
    try {
      const r = await downloadAttachmentBundle(input);
      if (r.ok) {
        window.open(r.url, '_blank', 'noopener');
        toast.success(`${r.files} receipts from ${r.claims} claims — download started.`);
        onClose();
      } else setError(r.error);
    } catch {
      setError('The download failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <ResponsiveDialog
      open={open}
      onClose={() => !busy && onClose()}
      title="Download attachments"
      actions={
        <>
          <Button variant="outlined" color="inherit" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={run} loading={busy} disabled={!preview || preview.files === 0 || preview.tooLarge}>
            Download .zip
          </Button>
        </>
      }
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Scope: {scopeLabel}
      </Typography>
      {!preview && !error && <Typography>Counting receipts…</Typography>}
      {preview && preview.files === 0 && <Typography>There are no receipts in this scope.</Typography>}
      {preview && preview.files > 0 && (
        <Typography>
          Download {preview.files} receipts ({formatBytes(preview.totalBytes)}) from {preview.claims} claims as one .zip? Files are named{' '}
          <code>&lt;claim no.&gt;-&lt;line&gt;-&lt;n&gt;.&lt;ext&gt;</code>. The download is logged.
        </Typography>
      )}
      {preview?.tooLarge && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {preview.limitNote || 'This set is too large for one download — narrow the filter (for example by batch or date range).'}
        </Alert>
      )}
    </ResponsiveDialog>
  );
}

export function AutocountDialog({
  open,
  onClose,
  batches,
  initialBatchId,
}: {
  open: boolean;
  onClose: () => void;
  batches: { id: string; batchNo: string }[];
  initialBatchId?: string;
}) {
  const toast = useToast();
  const [source, setSource] = React.useState<'batch' | 'range'>(initialBatchId || batches.length ? 'batch' : 'range');
  const [batchId, setBatchId] = React.useState(initialBatchId ?? batches[0]?.id ?? '');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [approved, setApproved] = React.useState(true);
  const [disbursed, setDisbursed] = React.useState(true);
  const [preview, setPreview] = React.useState<AutocountPreview | null>(null);
  const [state, setState] = React.useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const statuses = [...(approved ? ['approved' as const] : []), ...(disbursed ? ['disbursed' as const] : [])];
  const input = { source, batchId: source === 'batch' ? batchId || undefined : undefined, from: source === 'range' ? from || undefined : undefined, to: source === 'range' ? to || undefined : undefined, statuses };
  const ready = statuses.length > 0 && (source === 'batch' ? Boolean(batchId) : Boolean(from && to && to >= from));
  const key = JSON.stringify(input);

  React.useEffect(() => {
    if (!open || !ready) {
      setPreview(null);
      return;
    }
    let alive = true;
    setState('loading');
    const t = window.setTimeout(() => {
      previewAutocountExport(JSON.parse(key))
        .then((r) => {
          if (!alive) return;
          if (r.ok) {
            setPreview(r);
            setState('idle');
          } else {
            setError(r.error);
            setState('error');
          }
        })
        .catch(() => alive && setState('error'));
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [open, ready, key]);

  const run = async () => {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const r = await exportAutocount(input);
      if (r.ok) {
        window.open(r.url, '_blank', 'noopener');
        toast.success(`AutoCount export ready — ${r.rowCount} rows.`);
        onClose();
      } else {
        setError(r.error);
        setFieldErrors(r.fieldErrors ?? {});
      }
    } catch {
      setError('The export failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onClose={() => !busy && onClose()}
      title="AutoCount claims postings export"
      maxWidth="md"
      actions={
        <>
          <Button variant="outlined" color="inherit" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" color="success" onClick={run} loading={busy} disabled={!ready || !preview || preview.blocked.length > 0 || preview.rowCount === 0}>
            Export .xlsx
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        <RadioInput
          label="Source"
          required
          row
          value={source}
          onChange={(v) => setSource(v as 'batch' | 'range')}
          options={[
            { value: 'batch', label: 'Disbursement batch' },
            { value: 'range', label: 'Date range' },
          ]}
        />
        {source === 'batch' ? (
          <SelectInput label="Batch" required value={batchId} onChange={setBatchId} options={batches.map((b) => ({ value: b.id, label: b.batchNo }))} error={fieldErrors.batchId} helper={batches.length === 0 ? 'No batches yet — use a date range.' : undefined} />
        ) : (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <DateInput label="From" required value={from} onChange={setFrom} error={fieldErrors.from} />
            <DateInput label="To" required value={to} onChange={setTo} error={fieldErrors.to} />
          </Stack>
        )}
        <Stack>
          <Typography variant="body2" fontWeight={600}>
            Include statuses *
          </Typography>
          <Stack direction="row" spacing={2}>
            <CheckboxInput label="Approved" checked={approved} onChange={setApproved} />
            <CheckboxInput label="Disbursed" checked={disbursed} onChange={setDisbursed} />
          </Stack>
          {statuses.length === 0 && (
            <Typography variant="caption" color="error">
              Select at least one status.
            </Typography>
          )}
        </Stack>
        {state === 'loading' && <Typography color="text.secondary">…</Typography>}
        {preview && state !== 'loading' && (
          <>
            <Typography>
              Document date: <strong>{preview.documentDateBasis === 'approval' ? 'Approval date' : 'Disbursed date'}</strong> (Claims settings) · Credit account:{' '}
              <strong>{preview.creditAccount ?? 'not set'}</strong>
            </Typography>
            <Typography>
              {preview.rowCount} rows · total {formatMoney(preview.total)}
            </Typography>
            {preview.blocked.length > 0 && (
              <Alert severity="error">
                {preview.blocked.map((b) => (
                  <div key={b.categoryId}>
                    Category without GL account: {b.name}{' '}
                    <Link component={NextLink} href={`/claims/setup/categories/${encodeURIComponent(b.code)}`}>
                      Fix
                    </Link>
                  </div>
                ))}
              </Alert>
            )}
            <Typography variant="caption" color="text.secondary">
              Columns: {preview.columns.join(' · ')}. The column layout follows the proposed AutoCount template until Interact&apos;s template is confirmed (Q37).
            </Typography>
          </>
        )}
      </Stack>
    </ResponsiveDialog>
  );
}
