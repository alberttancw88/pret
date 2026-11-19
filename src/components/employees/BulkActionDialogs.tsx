'use client';

// E15 · S-EM-15 · bulk actions on the employee list (US-EMP-022, US-MIG-011).
// Change manager: {n} employees listed · New reporting manager * · Effective date * · Remarks ·
//   loop check per row (server) → result table ✓ / ✕ message. APPLY.
// Send invites: {n} eligible (others listed as skipped with the reason) · (•) Send now
//   (•) Schedule on dd/mm/yyyy · SEND INVITES → N-50.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { BulkRowResult, EmployeeRow } from '@/server/contracts/employees';
import { PORTAL_ACCOUNT_STATE_LABELS } from '@/server/contracts/employees';
import { bulkChangeManager, bulkSendInvites } from '@/server/actions/employees';
import ResponsiveDialog from '../dialogs/ResponsiveDialog';
import ErrorSummary from '../forms/ErrorSummary';
import { DateInput, RadioInput, TextInput } from '../forms/fields';
import { useToast } from '../ToastProvider';
import EmployeePicker, { type PickedEmployee } from './EmployeePicker';
import { MiniTable } from './ui';
import { formatDate, todayMyt } from '@/lib/format';

function PeopleList({ rows }: { rows: { id: string; employeeNo: string; fullName: string; note?: string }[] }) {
  return (
    <List dense sx={{ maxHeight: 200, overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 2 }}>
      {rows.map((r) => (
        <ListItem key={r.id}>
          <ListItemText primary={`${r.fullName} (${r.employeeNo})`} secondary={r.note} />
        </ListItem>
      ))}
    </List>
  );
}

export function ChangeManagerDialog({ open, rows, onClose, onDone }: { open: boolean; rows: EmployeeRow[]; onClose: () => void; onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [manager, setManager] = React.useState<PickedEmployee | null>(null);
  const [effectiveDate, setEffectiveDate] = React.useState(todayMyt());
  const [remarks, setRemarks] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [result, setResult] = React.useState<BulkRowResult[] | null>(null);

  React.useEffect(() => {
    if (open) {
      setManager(null);
      setEffectiveDate(todayMyt());
      setRemarks('');
      setError(null);
      setFieldErrors({});
      setResult(null);
    }
  }, [open]);

  const apply = async () => {
    const fe: Record<string, string> = {};
    if (!manager) fe.managerId = 'Select the new reporting manager.';
    if (!effectiveDate) fe.effectiveDate = 'Enter the effective date.';
    setFieldErrors(fe);
    if (Object.keys(fe).length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await bulkChangeManager({ employeeIds: rows.map((r) => r.id), managerId: manager!.id, effectiveDate, remarks });
      if (res.ok) {
        setResult(res.rows);
        toast.success(`${res.applied} manager change${res.applied === 1 ? '' : 's'} recorded${res.skipped ? ` · ${res.skipped} skipped` : ''}.`);
        router.refresh();
      } else {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
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
      title={result ? 'Change manager — result' : `Change manager for ${rows.length} employee${rows.length === 1 ? '' : 's'}`}
      maxWidth="sm"
      disableClose={busy}
      actions={
        result ? (
          <Button
            variant="contained"
            onClick={() => {
              onDone();
              onClose();
            }}
          >
            Done
          </Button>
        ) : (
          <>
            <Button variant="outlined" color="inherit" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="contained" onClick={apply} loading={busy}>
              Apply
            </Button>
          </>
        )
      }
    >
      {result ? (
        <MiniTable
          caption="Result"
          rows={result}
          getRowId={(r) => r.employeeId}
          columns={[
            { key: 'no', header: 'Employee no.', render: (r) => r.employeeNo },
            { key: 'res', header: 'Result', render: (r) => (r.ok ? '✓ Changed' : '✕ Skipped') },
            { key: 'msg', header: 'Note', render: (r) => r.message ?? '' },
          ]}
        />
      ) : (
        <Box>
          <ErrorSummary error={error} fieldErrors={fieldErrors} labels={{ managerId: 'New reporting manager', effectiveDate: 'Effective date' }} />
          <PeopleList rows={rows} />
          <Stack spacing={2}>
            <EmployeePicker label="New reporting manager" required value={manager} onChange={setManager} error={fieldErrors.managerId} helper="Each row is checked for reporting-line loops." />
            <DateInput label="Effective date" required value={effectiveDate} onChange={setEffectiveDate} error={fieldErrors.effectiveDate} helper="A future date is scheduled; job-history rows “Manager change” are created." />
            <TextInput label="Remarks" value={remarks} onChange={setRemarks} maxLength={500} multiline minRows={2} />
          </Stack>
        </Box>
      )}
    </ResponsiveDialog>
  );
}

const INVITABLE = ['not_invited', 'pending_activation'];

export function SendInvitesDialog({ open, rows, onClose, onDone }: { open: boolean; rows: EmployeeRow[]; onClose: () => void; onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = React.useState<'now' | 'scheduled'>('now');
  const [date, setDate] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dateError, setDateError] = React.useState<string | undefined>();
  const [skippedServer, setSkippedServer] = React.useState<{ employeeNo: string; reason: string }[] | null>(null);

  React.useEffect(() => {
    if (open) {
      setMode('now');
      setDate('');
      setError(null);
      setDateError(undefined);
      setSkippedServer(null);
    }
  }, [open]);

  const skipReason = (r: EmployeeRow): string | null => {
    if (r.status === 'separated' || r.status === 'withdrawn') return 'Separated';
    if (!INVITABLE.includes(r.portalAccount)) return `Already ${PORTAL_ACCOUNT_STATE_LABELS[r.portalAccount].toLowerCase()}`;
    if (!r.workEmail) return 'No work email';
    return null;
  };
  const eligible = rows.filter((r) => !skipReason(r));
  const skipped = rows.filter((r) => skipReason(r));

  const send = async () => {
    if (mode === 'scheduled' && !date) {
      setDateError('Choose the send date.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await bulkSendInvites({ employeeIds: eligible.map((r) => r.id), mode, scheduledSendDate: mode === 'scheduled' ? date : null });
      if (res.ok) {
        const parts = [res.sent ? `${res.sent} sent` : '', res.scheduled ? `${res.scheduled} scheduled` : '', res.emailNotSent ? `${res.emailNotSent} created but email not sent` : ''].filter(Boolean);
        toast.success(`Invites: ${parts.join(' · ') || 'none'}.`);
        router.refresh();
        if (res.skipped.length) setSkippedServer(res.skipped);
        else {
          onDone();
          onClose();
        }
      } else {
        setError(res.error);
        setDateError(res.fieldErrors?.scheduledSendDate);
      }
    } catch {
      setError('Something went wrong. No invites were sent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onClose={() => !busy && onClose()}
      title={`Send invites — ${eligible.length} eligible`}
      maxWidth="sm"
      disableClose={busy}
      actions={
        skippedServer ? (
          <Button
            variant="contained"
            onClick={() => {
              onDone();
              onClose();
            }}
          >
            Done
          </Button>
        ) : (
          <>
            <Button variant="outlined" color="inherit" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="contained" onClick={send} loading={busy} disabled={eligible.length === 0}>
              Send invites
            </Button>
          </>
        )
      }
    >
      {skippedServer ? (
        <Alert severity="warning" variant="outlined">
          Skipped by the server: {skippedServer.map((s) => `${s.employeeNo} (${s.reason})`).join(', ')}
        </Alert>
      ) : (
        <Box>
          <ErrorSummary error={error} />
          {eligible.length > 0 ? (
            <PeopleList rows={eligible.map((r) => ({ ...r, note: r.workEmail }))} />
          ) : (
            <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
              None of the selected employees can be invited.
            </Alert>
          )}
          {skipped.length > 0 && (
            <>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Skipped ({skipped.length})
              </Typography>
              <PeopleList rows={skipped.map((r) => ({ ...r, note: skipReason(r) ?? '' }))} />
            </>
          )}
          <RadioInput
            label="When"
            value={mode}
            onChange={(v) => setMode(v as 'now' | 'scheduled')}
            options={[
              { value: 'now', label: 'Send now' },
              { value: 'scheduled', label: 'Schedule on a date' },
            ]}
          />
          {mode === 'scheduled' && (
            <Box sx={{ mt: 2 }}>
              <DateInput label="Send on" required value={date} onChange={setDate} minDate={todayMyt()} error={dateError} helper={date ? `Invitations go out on ${formatDate(date)}.` : undefined} />
            </Box>
          )}
        </Box>
      )}
    </ResponsiveDialog>
  );
}
