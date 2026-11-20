'use client';

// P8 · Request replacement credit — S-PT-08 · /my/leave/credits/new · F-LV-15 · US-LEAVE-022
//   RC3 Date worked * (≤ today; day-type chip "Rest day"/"Off day"/"Public holiday: …"; working day / duplicate → error)
//   RC4 Duration * (Full / Half → "Credit: 1.0 / 0.5 day") · RC5 Reason / work done * (0/500) · RC6 Attachment ·
//   RC8 "If approved, expires dd/mm/yyyy" · SUBMIT REQUEST → S-PT-09.
// P9 · My replacement credits — S-PT-09 · /my/leave/credits · F-LV-15/20 · US-LEAVE-022, 023
//   Search credit no. · Filters Year · Status · Expiring within (30/60/90) · Columns Credit no. › · Date worked · Day type ·
//   Days · Status ● · Expiry · Used · Remaining · Decided by / at · ⋮ WITHDRAW (Pending) · REQUEST CREDIT · EXPORT .CSV.
// L7 · Replacement credits — S-LV-07 · /leave/credits (ADM/SA all) · F-LV-15 · US-LEAVE-022 — BATCH APPLY.
// Credit detail (P9 detail / P28 decision view) — CreditView.
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import {
  CREDIT_DURATION_LABELS,
  CREDIT_STATUSES,
  CREDIT_STATUS_LABELS,
  addDaysIso,
  type BatchCreditPreview,
  type BatchCreditResult,
  type CreditDetail,
  type CreditDuration,
  type CreditListParams,
  type CreditRow,
  type DayKindResult,
} from '@/server/contracts/leave';
import {
  batchApplyCredits,
  exportCreditsCsv,
  exportMyCreditsCsv,
  fetchCreditApproverHint,
  fetchDayKind,
  getCreditAttachmentUrl,
  previewBatchCredits,
  requestReplacementCredit,
  setCompensateByPay,
  withdrawCredit,
} from '@/server/actions/leave';
import ListPage, { type ListColumn } from '../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import { NumberInput, RadioInput, SwitchInput, TextInput } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import ErrorSummary from '../forms/ErrorSummary';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import FormDialog from '../forms/FormDialog';
import { useToast } from '../ToastProvider';
import DateText from '../DateText';
import { KVGrid } from '../employees/ui';
import { formatDate, formatDateTime, todayMyt } from '@/lib/format';
import type { Option } from '../forms/fields';
import { DecisionDialog, type DecisionKind } from '../approvals/DecisionDialog';
import { CreditStatusChip, PanelRow, daysText, formatDays, openUrl, useIdempotencyKey, yearOptions } from './common';
import LeaveDateField, { useCalendarMarks } from './LeaveDateField';
import { AttachmentPicker, formatBytes, uploadCreditFile, type UploadedFile } from './upload';
import { ApprovalTrail, CopyRef } from './LeaveApplicationView';
import { LeaveEmployeePicker, type PickedPerson } from './pickers';
import { MyLeaveTabs } from './MyLeave';
import { CREDIT_FILTERS, MY_CREDIT_FILTERS } from './filters';

const EXPIRING: Option[] = [
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
];
const isExpired = (r: CreditRow) => r.status === 'approved' && Number(r.expired) > 0 && Number(r.remaining) === 0;

/** RC3 day-kind chip from fetchDayKind (registered action, called while picking). */
function useDayKind(date: string, employeeId?: string | null) {
  const [res, setRes] = React.useState<DayKindResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setRes(null);
      return;
    }
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const r = await fetchDayKind({ date, employeeId: employeeId || undefined });
        if (alive) setRes(r.ok ? r : null);
      } catch {
        if (alive) setRes(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [date, employeeId]);
  return { res, loading };
}

// ===========================================================================
// P8
// ===========================================================================
export function RequestCreditForm({ rlTypeId }: { rlTypeId: string | null }) {
  const router = useRouter();
  const [approverHint, setApproverHint] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetchCreditApproverHint();
        if (alive && res.ok) setApproverHint(res.hint);
      } catch {
        /* hint is informational */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  const r = useActionRunner();
  const today = todayMyt();
  const [dateWorked, setDateWorked] = React.useState('');
  const [duration, setDuration] = React.useState<CreditDuration | ''>('');
  const [reason, setReason] = React.useState('');
  const [files, setFiles] = React.useState<UploadedFile[]>([]);
  const [tried, setTried] = React.useState(false);
  const [key] = useIdempotencyKey();
  const marks = useCalendarMarks(null, addDaysIso(today, -120), today);
  const dk = useDayKind(dateWorked);

  const errs: Record<string, string> = {};
  if (!dateWorked) errs.dateWorked = 'Enter the date worked.';
  else if (dk.res && !dk.res.eligible) errs.dateWorked = dk.res.message ?? 'Replacement credit is only for work on a rest day, off day or public holiday';
  if (!duration) errs.duration = 'Select the duration.';
  if (!reason.trim()) errs.reason = 'Reason / work done is required.';
  const shown = (k: string) => r.fieldErrors[k] ?? (tried ? errs[k] : undefined) ?? (k === 'dateWorked' && dk.res && !dk.res.eligible ? errs.dateWorked : undefined);

  const submit = async () => {
    setTried(true);
    if (Object.keys(errs).length) return;
    const res = await r.run(
      () => requestReplacementCredit({ dateWorked, duration: duration as CreditDuration, reason: reason.trim(), attachmentFileId: files[0]?.fileId ?? null, idempotencyKey: key }),
      { success: (x) => String((x as unknown as { message: string }).message ?? 'Credit requested.') },
    );
    if (res?.ok) router.push('/my/leave/credits');
  };

  return (
    <Card>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <ErrorSummary error={r.error} fieldErrors={r.fieldErrors} title="Can't submit yet" />
        <Stack spacing={2}>
          <Box>
            <LeaveDateField label="Date worked" required value={dateWorked} onChange={setDateWorked} maxDate={today} marks={marks} error={shown('dateWorked')} />
            {dk.loading && <Typography variant="caption">Checking the day…</Typography>}
            {dk.res && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                <Chip size="small" label={dk.res.label} color={dk.res.eligible ? 'default' : 'error'} variant="outlined" />
                {dk.res.duplicateCreditNo && <Typography variant="body2" color="error">You already have a credit for this date ({dk.res.duplicateCreditNo}).</Typography>}
              </Stack>
            )}
          </Box>
          <RadioInput
            label="Duration worked"
            required
            row
            value={duration}
            onChange={(v) => setDuration(v as CreditDuration)}
            options={[
              { value: 'full_day', label: CREDIT_DURATION_LABELS.full_day },
              { value: 'half_day', label: CREDIT_DURATION_LABELS.half_day },
            ]}
            error={shown('duration')}
            helper={duration ? `Credit: ${duration === 'full_day' ? '1.0 day' : '0.5 day'}` : undefined}
          />
          <TextInput label="Reason / work done" required value={reason} onChange={setReason} maxLength={500} multiline minRows={3} error={shown('reason')} />
          {rlTypeId && <AttachmentPicker label="Attachment (optional)" max={1} files={files} onChange={setFiles} upload={(file) => uploadCreditFile(file, rlTypeId)} />}
          {dk.res?.eligible && (
            <Typography variant="body2">
              If approved, expires <strong>{formatDate(dk.res.expiryIfApproved)}</strong>.
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary">
            {approverHint ?? 'Goes to your approver (Replacement Leave workflow).'}
          </Typography>
        </Stack>
        <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1} justifyContent="flex-end" sx={{ mt: 3 }}>
          <Button variant="outlined" color="inherit" component={NextLink} href="/my/leave/credits">
            Cancel
          </Button>
          <Button variant="contained" onClick={submit} loading={r.saving} sx={{ minHeight: 48 }}>
            Submit request
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Shared columns
// ===========================================================================
function creditColumns(withEmployee: boolean): ListColumn<CreditRow>[] {
  return [
    { key: 'creditNo', header: 'Credit no.', value: (r) => r.creditNo },
    ...(withEmployee ? [{ key: 'employee', header: 'Employee', value: (r: CreditRow) => `${r.employee.name}${r.employee.employeeNo ? ` (${r.employee.employeeNo})` : ''}` }] : []),
    { key: 'dateWorked', header: 'Date worked', kind: 'date', value: (r) => formatDate(r.dateWorked), render: (r) => <DateText value={r.dateWorked} /> },
    { key: 'dayType', header: 'Day type', sortable: false, value: (r) => r.dayTypeLabel },
    ...(withEmployee ? [{ key: 'duration', header: 'Duration', sortable: false, priority: 'low' as const, value: (r: CreditRow) => CREDIT_DURATION_LABELS[r.duration] }] : []),
    { key: 'days', header: 'Days', align: 'right', sortable: false, value: (r) => formatDays(r.days) },
    { key: 'status', header: 'Status', kind: 'status', sortable: false, value: (r) => (isExpired(r) ? 'Expired' : CREDIT_STATUS_LABELS[r.status]), render: (r) => <CreditStatusChip status={r.status} expired={isExpired(r)} /> },
    { key: 'expiry', header: 'Expiry', kind: 'date', value: (r) => formatDate(r.expiryDate), render: (r) => <DateText value={r.expiryDate} /> },
    { key: 'used', header: 'Used', align: 'right', sortable: false, priority: 'low', value: (r) => formatDays(r.used) },
    { key: 'remaining', header: 'Remaining', align: 'right', sortable: false, value: (r) => formatDays(r.remaining) },
    ...(withEmployee ? [{ key: 'cbp', header: 'Compensate by pay', sortable: false, priority: 'low' as const, value: (r: CreditRow) => (r.compensateByPay ? `✓${r.compensateHours ? ` ${r.compensateHours} h` : ''}` : '') }] : []),
    { key: 'decided', header: 'Decided by / at', sortable: false, priority: 'low', value: (r) => (r.decidedAt ? `${r.decidedByName ?? ''} · ${formatDateTime(r.decidedAt)}` : '') },
  ];
}

// ===========================================================================
// P9
// ===========================================================================
export function MyCreditsList({ rows, total, params, currentYear }: { rows: CreditRow[]; total: number; params: CreditListParams; currentYear: number }) {
  const list = useServerList({ filters: { ...MY_CREDIT_FILTERS, year: String(currentYear) }, sort: { key: 'dateWorked', direction: 'desc' } });
  const toast = useToast();
  const r = useActionRunner();
  const [withdraw, setWithdraw] = React.useState<CreditRow | null>(null);
  const d = list.draft;
  const set = list.setDraftField;
  return (
    <>
      <MyLeaveTabs />
      <ListPage<CreditRow>
        itemName={{ singular: 'replacement credit', plural: 'replacement credits' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Credit no." />,
          <SelectFilter key="y" label="Year" value={d.year} onChange={(v) => set('year', v)} options={yearOptions(currentYear, 3, 0)} />,
          <MultiSelectFilter key="s" label="Status" value={d.statuses} onChange={(v) => set('statuses', v)} options={CREDIT_STATUSES.map((s) => ({ value: s, label: CREDIT_STATUS_LABELS[s] }))} />,
          <SelectFilter key="e" label="Expiring within" value={d.expiringWithin} onChange={(v) => set('expiringWithin', v)} options={EXPIRING} />,
        ]}
        {...list.listProps}
        addNew={{ label: 'Request credit', href: '/my/leave/credits/new' }}
        onExport={async () => {
          try {
            const res = await exportMyCreditsCsv(params);
            if (res.ok) downloadServerCsv(res.filename || 'my-replacement-credits', res.content);
            else toast.info(res.error);
          } catch {
            toast.info('Export failed. Please try again.');
          }
        }}
        columns={creditColumns(false)}
        rows={rows}
        total={total}
        getRowId={(x) => x.id}
        getRowHref={(x) => `/my/leave/credits/${encodeURIComponent(x.creditNo)}`}
        getRowRef={(x) => x.creditNo}
        rowActions={(x) => (x.can.withdraw ? [{ label: 'Withdraw', danger: true, onClick: () => setWithdraw(x) }] : [])}
        empty={{
          title: 'No replacement credits yet.',
          action: (
            <Button variant="contained" component={NextLink} href="/my/leave/credits/new">
              Request credit
            </Button>
          ),
        }}
      />
      <ConfirmDialog
        open={Boolean(withdraw)}
        title={`Withdraw ${withdraw?.creditNo ?? ''}?`}
        body="Your approver will no longer see this request."
        confirmLabel="Withdraw"
        cancelLabel="Keep"
        destructive
        onClose={() => setWithdraw(null)}
        onConfirm={async () => {
          if (!withdraw) return;
          const res = await r.run(() => withdrawCredit({ creditId: withdraw.id }), { success: `${withdraw.creditNo} withdrawn.` });
          if (res && !res.ok) toast.info(res.error);
          setWithdraw(null);
        }}
      />
    </>
  );
}

// ===========================================================================
// L7 (ADM/SA) — with BATCH APPLY
// ===========================================================================
export function CreditsAdminList({
  rows,
  total,
  params,
  departments,
}: {
  rows: CreditRow[];
  total: number;
  params: CreditListParams;
  departments: { id: string; label: string }[];
}) {
  const list = useServerList({ filters: CREDIT_FILTERS, sort: { key: 'dateWorked', direction: 'desc' } });
  const toast = useToast();
  const [batch, setBatch] = React.useState(false);
  const d = list.draft;
  const set = list.setDraftField;
  return (
    <>
      <ListPage<CreditRow>
        itemName={{ singular: 'replacement credit', plural: 'replacement credits' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Credit no., employee no. or name." />,
          <MultiSelectFilter key="s" label="Status" value={d.statuses} onChange={(v) => set('statuses', v)} options={CREDIT_STATUSES.map((s) => ({ value: s, label: CREDIT_STATUS_LABELS[s] }))} />,
          <DateFilter key="f" label="Date worked from" value={d.from} onChange={(v) => set('from', v)} />,
          <DateFilter key="t" label="Date worked to" value={d.to} onChange={(v) => set('to', v)} />,
          <MultiSelectFilter key="dp" label="Department" value={d.departmentIds} onChange={(v) => set('departmentIds', v)} options={departments.map((x) => ({ value: x.id, label: x.label }))} />,
          <SelectFilter key="e" label="Expiring within" value={d.expiringWithin} onChange={(v) => set('expiringWithin', v)} options={EXPIRING} />,
        ]}
        {...list.listProps}
        extraActions={
          <Button variant="contained" onClick={() => setBatch(true)}>
            Batch apply
          </Button>
        }
        onExport={async () => {
          try {
            const res = await exportCreditsCsv(params);
            if (res.ok) downloadServerCsv(res.filename || 'replacement-credits', res.content);
            else toast.info(res.error);
          } catch {
            toast.info('Export failed. Please try again.');
          }
        }}
        columns={creditColumns(true)}
        rows={rows}
        total={total}
        getRowId={(x) => x.id}
        getRowHref={(x) => `/approvals/credits/${encodeURIComponent(x.creditNo)}?from=credits`}
        getRowRef={(x) => x.creditNo}
        empty={{ title: 'No replacement credits yet.' }}
      />
      <BatchCreditDialog open={batch} onClose={() => setBatch(false)} />
    </>
  );
}

function BatchCreditDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const r = useActionRunner();
  const [people, setPeople] = React.useState<PickedPerson[]>([]);
  const [pick, setPick] = React.useState<PickedPerson | null>(null);
  const [dateWorked, setDateWorked] = React.useState('');
  const [duration, setDuration] = React.useState<CreditDuration>('full_day');
  const [reason, setReason] = React.useState('');
  const [preview, setPreview] = React.useState<BatchCreditPreview | null>(null);
  const [result, setResult] = React.useState<BatchCreditResult | null>(null);
  const [key, renew] = useIdempotencyKey();
  React.useEffect(() => {
    if (!open) {
      setPeople([]);
      setDateWorked('');
      setReason('');
      setPreview(null);
      setResult(null);
      renew();
      r.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  React.useEffect(() => {
    if (!people.length || !/^\d{4}-\d{2}-\d{2}$/.test(dateWorked)) {
      setPreview(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await previewBatchCredits({ employeeIds: people.map((p) => p.id), dateWorked });
        if (alive) setPreview(res.ok ? res : null);
      } catch {
        if (alive) setPreview(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [people, dateWorked]);
  const eligible = preview?.rows.filter((x) => x.eligible).length ?? 0;

  return (
    <FormDialog
      open={open}
      title={result ? 'Batch apply — result' : 'Batch apply replacement credits'}
      onClose={onClose}
      maxWidth="md"
      saving={r.saving}
      readOnly={Boolean(result)}
      submitLabel={`Create ${eligible} request${eligible === 1 ? '' : 's'}`}
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty={!result && (people.length > 0 || reason !== '')}
      onSubmit={async () => {
        const res = await r.run(
          () => batchApplyCredits({ employeeIds: preview ? preview.rows.filter((x) => x.eligible).map((x) => x.employee.id) : people.map((p) => p.id), dateWorked, duration, reason: reason.trim(), idempotencyKey: key }),
          { success: (x) => `${(x as unknown as BatchCreditResult).created.length} credit requests created.` },
        );
        if (res?.ok) setResult(res);
      }}
    >
      {result ? (
        <Stack spacing={1}>
          {result.created.map((c) => (
            <Typography key={c.creditNo} variant="body2">
              ✓ {c.creditNo} — {c.employee.name}
            </Typography>
          ))}
          {result.skipped.map((c) => (
            <Typography key={c.employee.id} variant="body2" color="error">
              ✕ {c.employee.name} — {c.note}
            </Typography>
          ))}
        </Stack>
      ) : (
        <Stack spacing={2}>
          <LeaveEmployeePicker
            label="Add employee"
            value={pick}
            onChange={(v) => {
              if (v && !people.some((p) => p.id === v.id)) setPeople((x) => [...x, v]);
              setPick(null);
            }}
            error={r.fieldErrors.employeeIds}
            helper="Employees * — add one at a time; your own record is excluded."
          />
          {people.length > 0 && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {people.map((p) => (
                <Chip key={p.id} label={`${p.name}${p.employeeNo ? ` (${p.employeeNo})` : ''}`} onDelete={() => setPeople((x) => x.filter((y) => y.id !== p.id))} />
              ))}
            </Stack>
          )}
          <LeaveDateField label="Date worked" required value={dateWorked} onChange={setDateWorked} maxDate={todayMyt()} marks={new Map()} error={r.fieldErrors.dateWorked} />
          <RadioInput
            label="Duration"
            required
            row
            value={duration}
            onChange={(v) => setDuration(v as CreditDuration)}
            options={[
              { value: 'full_day', label: CREDIT_DURATION_LABELS.full_day },
              { value: 'half_day', label: CREDIT_DURATION_LABELS.half_day },
            ]}
          />
          <TextInput label="Reason" required value={reason} onChange={setReason} maxLength={500} multiline minRows={2} error={r.fieldErrors.reason} />
          {preview && (
            <Table size="small" aria-label="Day type per employee">
              <TableHead>
                <TableRow>
                  <TableCell>Employee</TableCell>
                  <TableCell>Day type</TableCell>
                  <TableCell>Note</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {preview.rows.map((x) => (
                  <TableRow key={x.employee.id} sx={x.eligible ? undefined : { bgcolor: '#FDECEC' }}>
                    <TableCell>{x.employee.name}</TableCell>
                    <TableCell>{x.label}</TableCell>
                    <TableCell>{x.eligible ? '—' : x.note ?? 'Working day — excluded'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Typography variant="caption" color="text.secondary">
            Each request is routed per the Replacement Leave workflow. Rows where the date is a working day are flagged and excluded.
          </Typography>
        </Stack>
      )}
    </FormDialog>
  );
}

// ===========================================================================
// Credit detail — P9 detail (own) · P28 decision view (approver / ADM)
// ===========================================================================
export function CreditView({ c, mode, backHref }: { c: CreditDetail; mode: 'own' | 'approver'; backHref?: string }) {
  const router = useRouter();
  const toast = useToast();
  const r = useActionRunner();
  const [dlg, setDlg] = React.useState<DecisionKind | null>(null);
  const [withdraw, setWithdraw] = React.useState(false);
  const [cbp, setCbp] = React.useState(c.compensateByPay);
  const [hours, setHours] = React.useState(c.compensateHours ?? '');
  const t = c.task;
  const decided = c.alreadyDecided;
  const canDecide = mode === 'approver' && t?.canDecide && !decided;
  return (
    <Stack spacing={2} sx={{ pb: canDecide ? { xs: 10, sm: 0 } : 0 }}>
      {decided && (
        <Alert severity="info">
          Already decided by {decided.byName} at {formatDateTime(decided.at)}.
        </Alert>
      )}
      {mode === 'approver' && c.isOwn && <Alert severity="info">You can&apos;t decide your own replacement credit.</Alert>}
      {mode === 'approver' && !c.isOwn && t && !t.canDecide && t.blockedReason && !decided && <Alert severity="info">{t.blockedReason}</Alert>}
      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            <CopyRef value={c.creditNo} />
            <CreditStatusChip status={c.status} expired={isExpired(c)} />
            {c.enteredByAdmin && <Chip size="small" variant="outlined" label="Entered by HR" />}
          </Stack>
          {mode === 'approver' && (
            <Typography sx={{ mb: 1 }}>
              {c.employee.name}
              {c.employee.employeeNo ? ` · ${c.employee.employeeNo}` : ''} · {c.department}
            </Typography>
          )}
          <KVGrid
            items={[
              { label: 'Date worked', value: `${formatDate(c.dateWorked)} · ${c.dayTypeLabel}` },
              { label: 'Duration', value: CREDIT_DURATION_LABELS[c.duration] },
              { label: 'Credit', value: daysText(c.days) },
              { label: 'Reason / work done', value: c.reason, full: true },
              { label: 'Submitted', value: formatDateTime(c.submittedAt) },
              { label: c.status === 'approved' ? 'Expiry' : 'Expiry if approved', value: formatDate(c.expiryDate ?? c.expiryIfApproved) },
              { label: 'Used / remaining', value: `${formatDays(c.used)} / ${formatDays(c.remaining)}`, hidden: c.status !== 'approved' },
              { label: 'Compensate by pay', value: c.compensateByPay ? `Yes${c.compensateHours ? ` · ${c.compensateHours} hours` : ''}` : 'No', hidden: !c.compensateByPay && mode === 'own' },
              { label: 'Decided by / at', value: c.decidedAt ? `${c.decidedByName ?? ''} · ${formatDateTime(c.decidedAt)}` : '', hidden: !c.decidedAt },
            ]}
          />
          {c.attachment && (
            <Button
              sx={{ mt: 2 }}
              variant="outlined"
              startIcon={<AttachFileIcon />}
              onClick={() => openUrl(() => getCreditAttachmentUrl({ creditId: c.id }), (m) => toast.info(m))}
            >
              {c.attachment.fileName} · {formatBytes(c.attachment.sizeBytes)}
            </Button>
          )}
        </CardContent>
      </Card>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Card>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
                Approval trail
              </Typography>
              <ApprovalTrail trail={c.trail} />
            </CardContent>
          </Card>
          {c.consumptions.length > 0 && (
            <Card sx={{ mt: 2 }}>
              <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
                <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
                  Used by
                </Typography>
                {c.consumptions.map((u) => (
                  <Typography key={u.applicationId} variant="body2" sx={{ textDecoration: u.reversed ? 'line-through' : undefined }}>
                    Used by {u.refNo} on {formatDate(u.date)} · {daysText(u.days)}
                    {u.reversed ? ' (reversed)' : ''}
                  </Typography>
                ))}
              </CardContent>
            </Card>
          )}
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Stack spacing={2}>
            {mode === 'approver' && (
              <Card>
                <CardContent sx={{ p: 2 }}>
                  <PanelRow label="Employee's replacement leave available now" value={formatDays(c.rlAvailable)} strong />
                </CardContent>
              </Card>
            )}
            {mode === 'approver' && c.canSetCompensateByPay && c.status === 'pending' && (
              <Card>
                <CardContent sx={{ p: 2 }}>
                  <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
                    Compensate by pay
                  </Typography>
                  <SwitchInput label="Pay instead of credit (BR-LV-84)" checked={cbp} onChange={setCbp} />
                  {cbp && <NumberInput label="Hours worked" required value={hours} onChange={setHours} min={0.5} max={24} step={0.5} error={r.fieldErrors.hours} />}
                  <Button
                    sx={{ mt: 1 }}
                    variant="outlined"
                    loading={r.saving}
                    onClick={() => r.run(() => setCompensateByPay({ creditId: c.id, compensateByPay: cbp, hours: cbp ? hours : null }), { success: 'Saved. Approve the request to pass it to payroll input.' })}
                  >
                    Save
                  </Button>
                  <Typography variant="caption" color="text.secondary" component="p">
                    Passed to payroll as a rest-day work input instead of a leave credit.
                  </Typography>
                </CardContent>
              </Card>
            )}
          </Stack>
        </Grid>
      </Grid>
      {(canDecide || (mode === 'own' && c.can.withdraw) || backHref) && (
        <Box
          sx={{
            position: { xs: 'sticky', sm: 'static' },
            bottom: 0,
            zIndex: 2,
            bgcolor: { xs: 'background.paper', sm: 'transparent' },
            borderTop: { xs: '1px solid', sm: 0 },
            borderColor: 'divider',
            mx: { xs: -2, sm: 0 },
            px: { xs: 2, sm: 0 },
            py: { xs: 1.5, sm: 0 },
          }}
        >
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            {backHref && (
              <Button component={NextLink} href={backHref} sx={{ mr: 'auto' }}>
                Back
              </Button>
            )}
            {mode === 'own' && c.can.withdraw && (
              <Button variant="outlined" color="error" onClick={() => setWithdraw(true)}>
                Withdraw
              </Button>
            )}
            {canDecide && (
              <>
                <Button variant="outlined" color="error" onClick={() => setDlg(t!.overrideOnly ? 'override_reject' : 'reject')}>
                  {t!.overrideOnly ? 'Reject as Admin (override)' : 'Reject'}
                </Button>
                <Button variant="contained" onClick={() => setDlg(t!.overrideOnly ? 'override_approve' : 'approve')}>
                  {t!.overrideOnly ? 'Approve as Admin (override)' : 'Approve'}
                </Button>
              </>
            )}
          </Stack>
        </Box>
      )}
      {dlg && t && (
        <DecisionDialog
          open
          kind={dlg}
          subject="credit"
          reference={c.creditNo}
          taskId={t.taskId}
          taskVersion={t.version}
          onClose={() => setDlg(null)}
          onDone={() => backHref && router.push(backHref)}
        />
      )}
      <ConfirmDialog
        open={withdraw}
        title={`Withdraw ${c.creditNo}?`}
        body="Your approver will no longer see this request."
        confirmLabel="Withdraw"
        cancelLabel="Keep"
        destructive
        onClose={() => setWithdraw(false)}
        onConfirm={async () => {
          const res = await r.run(() => withdrawCredit({ creditId: c.id }), { success: `${c.creditNo} withdrawn.` });
          if (res && !res.ok) toast.info(res.error);
          setWithdraw(false);
        }}
      />
    </Stack>
  );
}
