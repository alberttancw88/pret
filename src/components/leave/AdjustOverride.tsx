'use client';

// L4 · Balance adjustments — S-LV-04 · /leave/adjustments · F-LV-18 · US-LEAVE-025, 043
//   Search employee · Filters Employee · Type · Year · Date from–to · Reason contains · Columns Date · Employee › · Type ·
//   Year · Days (±) · Reason · 📎 · By · ADJUST BALANCE (→ L5) · EXPORT .CSV. Migration rows read "Statutory correction (D13)".
// L5 · Adjust balance — S-LV-05 · dialog · F-LV-18 · US-LEAVE-025
//   Employee * (not self) · Leave type * · Leave year * (current / next) · Days * (½ steps, ≠ 0: [−] 1.5 [+] with Add / Deduct) ·
//   Reason * (≥ 10, 0/500) · Attachment · preview "Balance before 8.5 → after 10.0" · ADJUST BALANCE (ledger entry, N-10).
// L6 · Entitlement overrides — S-LV-06 · /leave/overrides · F-LV-31 · US-LEAVE-036
//   Filters Employee · Type · Year · Columns Employee › · Type · Year · Days (override) · Band value it replaces · Reason ·
//   Entered by/at · ⋮ Edit / Remove · ADD OVERRIDE · EXPORT .CSV. Form: Employee * · Leave type * (banded) · Year * ·
//   Days per year * (below statutory → BR-LV-02 block; SA override with reason) · Reason * · SAVE OVERRIDE (before/after).
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import {
  STATUTORY_FLOOR_FIELD,
  type AdjustmentListParams,
  type AdjustmentPreview,
  type AdjustmentRow,
  type LeaveTypeRef,
  type EntitlementMethod,
  type OverrideListParams,
  type OverrideRow,
} from '@/server/contracts/leave';
import { adjustBalance, exportAdjustmentsCsv, exportOverridesCsv, getAdjustmentAttachmentUrl, previewAdjustment, removeOverride, saveOverride } from '@/server/actions/leave';
import ListPage, { type ListColumn } from '../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import FormDialog from '../forms/FormDialog';
import { FormGrid, NumberInput, RadioInput, SelectInput, TextInput } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import { useToast } from '../ToastProvider';
import DateText from '../DateText';
import EmployeePicker from '../employees/EmployeePicker';
import { formatDate, formatDateTime } from '@/lib/format';
import { DaysCell, formatDays, formatSignedDays, openUrl, useIdempotencyKey, yearOptions } from './common';
import { LeaveEmployeePicker, type PickedPerson } from './pickers';
import { AttachmentPicker, uploadAdjustmentFile, type UploadedFile } from './upload';
import { ADJUSTMENT_FILTERS, OVERRIDE_FILTERS } from './filters';

export type SetupType = LeaveTypeRef & { entitlementMethod: EntitlementMethod; isActive: boolean };

// ===========================================================================
// L5 dialog (also from the E3 Leave tab: ADJUST BALANCE)
// ===========================================================================
export function AdjustBalanceDialog({
  open,
  onClose,
  types,
  currentYear,
  employee,
}: {
  open: boolean;
  onClose: () => void;
  types: SetupType[];
  currentYear: number;
  /** pre-filled (and locked) employee — E3 Leave tab */
  employee?: PickedPerson | null;
}) {
  const r = useActionRunner();
  const [emp, setEmp] = React.useState<PickedPerson | null>(employee ?? null);
  const [typeId, setTypeId] = React.useState('');
  const [year, setYear] = React.useState(String(currentYear));
  const [direction, setDirection] = React.useState<'add' | 'deduct'>('add');
  const [days, setDays] = React.useState(1);
  const [reason, setReason] = React.useState('');
  const [files, setFiles] = React.useState<UploadedFile[]>([]);
  const [pv, setPv] = React.useState<AdjustmentPreview | null>(null);
  const [key, renew] = useIdempotencyKey();
  React.useEffect(() => {
    if (!open) {
      setEmp(employee ?? null);
      setTypeId('');
      setYear(String(currentYear));
      setDirection('add');
      setDays(1);
      setReason('');
      setFiles([]);
      setPv(null);
      renew();
      r.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  React.useEffect(() => {
    if (!open || !emp || !typeId) {
      setPv(null);
      return;
    }
    let alive = true;
    const t = window.setTimeout(async () => {
      try {
        const res = await previewAdjustment({ employeeId: emp.id, leaveTypeId: typeId, year: Number(year), direction, days });
        if (alive) setPv(res.ok ? res : null);
      } catch {
        if (alive) setPv(null);
      }
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [open, emp, typeId, year, direction, days]);

  const step = (delta: number) => setDays((x) => Math.max(0.5, Math.min(365, Math.round((x + delta) * 2) / 2)));
  return (
    <FormDialog
      open={open}
      title="Adjust balance"
      onClose={onClose}
      saving={r.saving}
      submitLabel="Adjust balance"
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty={Boolean(typeId || reason)}
      onSubmit={async () => {
        if (!emp) {
          r.setFieldErrors({ employeeId: 'Choose the employee.' });
          return;
        }
        const res = await r.run(
          () =>
            adjustBalance({
              employeeId: emp.id,
              leaveTypeId: typeId,
              year: Number(year),
              direction,
              days,
              reason: reason.trim(),
              attachmentFileId: files[0]?.fileId ?? null,
              idempotencyKey: key,
            }),
          { success: (x) => `Balance adjusted — now ${formatDays(String((x as unknown as { after: string }).after))} days. The employee has been notified.` },
        );
        if (res?.ok) onClose();
      }}
    >
      <Stack spacing={2}>
        {employee ? (
          <Typography>
            Employee: <strong>{employee.name}</strong>
            {employee.employeeNo ? ` (${employee.employeeNo})` : ''}
          </Typography>
        ) : (
          <LeaveEmployeePicker label="Employee" required value={emp} onChange={setEmp} error={r.fieldErrors.employeeId} helper="Your own record is excluded." />
        )}
        <FormGrid>
          <SelectInput label="Leave type" required value={typeId} onChange={setTypeId} options={types.filter((t) => t.isActive).map((t) => ({ value: t.id, label: t.name }))} error={r.fieldErrors.leaveTypeId} />
          <SelectInput
            label="Leave year"
            required
            value={year}
            onChange={setYear}
            options={[
              { value: String(currentYear), label: `${currentYear} (current)` },
              { value: String(currentYear + 1), label: `${currentYear + 1} (next)` },
            ]}
            error={r.fieldErrors.year}
          />
        </FormGrid>
        <RadioInput
          label="Adjustment"
          row
          value={direction}
          onChange={(v) => setDirection(v as 'add' | 'deduct')}
          options={[
            { value: 'add', label: 'Add' },
            { value: 'deduct', label: 'Deduct' },
          ]}
        />
        <Box>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
            Days *
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <IconButton aria-label="Decrease by half a day" onClick={() => step(-0.5)} sx={{ width: 44, height: 44, border: '1px solid', borderColor: 'divider' }}>
              <RemoveIcon />
            </IconButton>
            <TextField
              value={formatDays(days)}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n > 0) setDays(Math.round(n * 2) / 2);
              }}
              slotProps={{ htmlInput: { inputMode: 'decimal', 'aria-label': 'Days', className: 'pret-tnum', style: { textAlign: 'center', width: 64 } } }}
              error={Boolean(r.fieldErrors.days)}
            />
            <IconButton aria-label="Increase by half a day" onClick={() => step(0.5)} sx={{ width: 44, height: 44, border: '1px solid', borderColor: 'divider' }}>
              <AddIcon />
            </IconButton>
          </Stack>
          {r.fieldErrors.days && (
            <Typography variant="caption" color="error">
              {r.fieldErrors.days}
            </Typography>
          )}
        </Box>
        <TextInput label="Reason" required value={reason} onChange={setReason} maxLength={500} multiline minRows={2} error={r.fieldErrors.reason} helper="At least 10 characters. Shown in the employee's ledger." />
        {emp && <AttachmentPicker label="Attachment (optional)" max={1} camera={false} files={files} onChange={setFiles} upload={(f) => uploadAdjustmentFile(f, emp.id)} />}
        {pv && (
          <Alert severity="info" variant="outlined">
            Balance before <strong>{formatDays(pv.before)}</strong> → after <strong>{formatDays(pv.after)}</strong>
          </Alert>
        )}
      </Stack>
    </FormDialog>
  );
}

// ===========================================================================
// L4 list
// ===========================================================================
export function AdjustmentsList({
  rows,
  total,
  params,
  types,
  currentYear,
}: {
  rows: AdjustmentRow[];
  total: number;
  params: AdjustmentListParams;
  types: SetupType[];
  currentYear: number;
}) {
  const list = useServerList({ filters: ADJUSTMENT_FILTERS, sort: { key: 'date', direction: 'desc' } });
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const d = list.draft;
  const set = list.setDraftField;
  const columns: ListColumn<AdjustmentRow>[] = [
    { key: 'date', header: 'Date', kind: 'date', value: (r) => formatDate(r.date), render: (r) => <DateText value={r.date} /> },
    { key: 'employee', header: 'Employee', value: (r) => `${r.employee.name}${r.employee.employeeNo ? ` (${r.employee.employeeNo})` : ''}` },
    { key: 'type', header: 'Type', sortable: false, value: (r) => r.leaveType.name },
    { key: 'year', header: 'Year', sortable: false, align: 'right', value: (r) => r.year },
    { key: 'days', header: 'Days', align: 'right', sortable: false, value: (r) => formatSignedDays(r.days), render: (r) => <DaysCell value={r.days} signed /> },
    { key: 'reason', header: 'Reason', sortable: false, value: (r) => `${r.isOpening ? 'Opening balance · ' : ''}${r.reason}` },
    {
      key: 'att',
      header: '📎',
      sortable: false,
      priority: 'low',
      value: (r) => r.attachment?.fileName ?? '',
      render: (r) =>
        r.attachment ? (
          <Link
            component="button"
            type="button"
            variant="body2"
            onClick={() => openUrl(() => getAdjustmentAttachmentUrl({ adjustmentId: r.id }), (m) => toast.info(m))}
            aria-label={`Open attachment ${r.attachment.fileName} (access is logged)`}
          >
            {r.attachment.fileName}
          </Link>
        ) : (
          '—'
        ),
    },
    { key: 'by', header: 'By', sortable: false, priority: 'low', value: (r) => `${r.byName} · ${formatDateTime(r.createdAt)}` },
  ];
  return (
    <>
      <ListPage<AdjustmentRow>
        itemName={{ singular: 'adjustment', plural: 'adjustments' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Employee no. or name." />,
          <EmployeePicker
            key="e"
            label="Employee"
            activeOnly={false}
            value={d.employeeId ? { id: d.employeeId, employeeNo: '', name: d.employeeName || 'Selected employee' } : null}
            onChange={(v) => {
              set('employeeId', v?.id ?? '');
              set('employeeName', v ? `${v.name}${v.employeeNo ? ` (${v.employeeNo})` : ''}` : '');
            }}
          />,
          <MultiSelectFilter key="t" label="Type" value={d.leaveTypeIds} onChange={(v) => set('leaveTypeIds', v)} options={types.map((t) => ({ value: t.id, label: t.name }))} />,
          <SelectFilter key="y" label="Leave year" value={d.year} onChange={(v) => set('year', v)} options={yearOptions(currentYear, 3, 1)} />,
          <DateFilter key="f" label="Date from" value={d.from} onChange={(v) => set('from', v)} />,
          <DateFilter key="to" label="Date to" value={d.to} onChange={(v) => set('to', v)} />,
          <KeywordField key="rc" label="Reason contains" value={d.reasonContains} onChange={(v) => set('reasonContains', v)} />,
        ]}
        {...list.listProps}
        addNew={{ label: 'Adjust balance', onClick: () => setOpen(true) }}
        onExport={async () => {
          try {
            const res = await exportAdjustmentsCsv(params);
            if (res.ok) downloadServerCsv(res.filename || 'leave-adjustments', res.content);
            else toast.info(res.error);
          } catch {
            toast.info('Export failed. Please try again.');
          }
        }}
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/leave/ledger?employee=${encodeURIComponent(r.employee.id)}&type=${encodeURIComponent(r.leaveType.id)}&year=${r.year}`}
        getRowRef={(r) => `${r.employee.name} ${formatDate(r.date)}`}
        empty={{ title: 'No balance adjustments yet.' }}
      />
      <AdjustBalanceDialog open={open} onClose={() => setOpen(false)} types={types} currentYear={currentYear} />
    </>
  );
}

// ===========================================================================
// L6 override form (also from the E3 Leave tab: ADD OVERRIDE)
// ===========================================================================
export function OverrideDialog({
  open,
  onClose,
  types,
  currentYear,
  isSuperAdmin,
  editing,
  employee,
}: {
  open: boolean;
  onClose: () => void;
  types: SetupType[];
  currentYear: number;
  isSuperAdmin: boolean;
  editing?: OverrideRow | null;
  employee?: PickedPerson | null;
}) {
  const r = useActionRunner();
  const [emp, setEmp] = React.useState<PickedPerson | null>(null);
  const [typeId, setTypeId] = React.useState('');
  const [year, setYear] = React.useState(String(currentYear));
  const [days, setDays] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [floorReason, setFloorReason] = React.useState('');
  const [floorBlocked, setFloorBlocked] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setEmp(editing ? { id: editing.employee.id, employeeNo: editing.employee.employeeNo, name: editing.employee.name } : employee ?? null);
      setTypeId(editing?.leaveType.id ?? '');
      setYear(String(editing?.year ?? currentYear));
      setDays(editing?.days ?? '');
      setReason(editing?.reason ?? '');
      setFloorReason('');
      setFloorBlocked(null);
      r.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const banded = types.filter((t) => t.entitlementMethod === 'annual_banded' && t.isActive);
  const save = async (withOverride: boolean) => {
    if (!emp) {
      r.setFieldErrors({ employeeId: 'Choose the employee.' });
      return;
    }
    const res = await r.run(
      () =>
        saveOverride({
          id: editing?.id ?? null,
          employeeId: emp.id,
          leaveTypeId: typeId,
          year: Number(year),
          days,
          reason: reason.trim(),
          floorOverrideReason: withOverride ? floorReason.trim() : null,
        }),
      { success: (x) => `Override saved — entitlement ${formatDays(String((x as unknown as { before: string }).before))} → ${formatDays(String((x as unknown as { after: string }).after))}.` },
    );
    if (res?.ok) onClose();
    else if (res && res.fieldErrors?.[STATUTORY_FLOOR_FIELD]) setFloorBlocked(res.fieldErrors[STATUTORY_FLOOR_FIELD]);
  };
  return (
    <>
      <FormDialog
        open={open}
        title={editing ? 'Edit entitlement override' : 'Add entitlement override'}
        onClose={onClose}
        saving={r.saving}
        submitLabel="Save override"
        error={r.error}
        fieldErrors={r.fieldErrors}
        dirty={Boolean(days || reason)}
        onSubmit={() => save(false)}
      >
        <Stack spacing={2}>
          {editing || employee ? (
            <Typography>
              Employee: <strong>{emp?.name}</strong>
              {emp?.employeeNo ? ` (${emp.employeeNo})` : ''}
            </Typography>
          ) : (
            <LeaveEmployeePicker label="Employee" required value={emp} onChange={setEmp} error={r.fieldErrors.employeeId} helper="Your own record is excluded." />
          )}
          <FormGrid>
            <SelectInput label="Leave type" required value={typeId} onChange={setTypeId} options={banded.map((t) => ({ value: t.id, label: t.name }))} error={r.fieldErrors.leaveTypeId} helper="Banded types only." locked={editing ? 'Fixed for this override.' : false} />
            <SelectInput label="Year" required value={year} onChange={setYear} options={yearOptions(currentYear, 1, 1)} error={r.fieldErrors.year} locked={editing ? 'Fixed for this override.' : false} />
            <NumberInput label="Days per year" required value={days} onChange={setDays} min={0} max={365} step={0.5} error={r.fieldErrors.days} helper="Replaces the band value for this employee and year." />
          </FormGrid>
          <TextInput label="Reason" required value={reason} onChange={setReason} maxLength={500} multiline minRows={2} error={r.fieldErrors.reason} helper="At least 10 characters (e.g. contractual 18 days AL)." />
        </Stack>
      </FormDialog>
      <StatutoryFloorDialog
        message={floorBlocked}
        isSuperAdmin={isSuperAdmin}
        reason={floorReason}
        onReason={setFloorReason}
        saving={r.saving}
        onClose={() => setFloorBlocked(null)}
        onOverride={async () => {
          setFloorBlocked(null);
          await save(true);
        }}
      />
    </>
  );
}

/** BR-LV-02 blocking dialog: ADM [BACK] only; SA Override reason * → SAVE WITH OVERRIDE (logged). */
export function StatutoryFloorDialog({
  message,
  isSuperAdmin,
  reason,
  onReason,
  saving,
  onClose,
  onOverride,
}: {
  message: string | null;
  isSuperAdmin: boolean;
  reason: string;
  onReason: (v: string) => void;
  saving?: boolean;
  onClose: () => void;
  onOverride: () => void;
}) {
  return (
    <FormDialog
      open={Boolean(message)}
      title="Below Employment Act minimum (s60E/s60F/s37/s60FA)"
      onClose={onClose}
      onSubmit={() => (reason.trim().length >= 10 ? onOverride() : undefined)}
      readOnly={!isSuperAdmin}
      saving={saving}
      submitLabel="Save with override"
    >
      <Alert severity="error" sx={{ mb: 2 }}>
        {message}
      </Alert>
      {isSuperAdmin ? (
        <TextInput label="Override reason" required value={reason} onChange={onReason} maxLength={500} multiline minRows={2} helper="At least 10 characters. Logged." error={reason && reason.trim().length < 10 ? 'At least 10 characters.' : undefined} />
      ) : (
        <Typography>Only a Super Admin can save a value below the statutory minimum. Go back and correct the value.</Typography>
      )}
    </FormDialog>
  );
}

// ===========================================================================
// L6 list
// ===========================================================================
export function OverridesList({
  rows,
  total,
  params,
  types,
  currentYear,
  isSuperAdmin,
}: {
  rows: OverrideRow[];
  total: number;
  params: OverrideListParams;
  types: SetupType[];
  currentYear: number;
  isSuperAdmin: boolean;
}) {
  const list = useServerList({ filters: OVERRIDE_FILTERS, sort: { key: 'employee', direction: 'asc' } });
  const toast = useToast();
  const r = useActionRunner();
  const [form, setForm] = React.useState<{ editing: OverrideRow | null } | null>(null);
  const [remove, setRemove] = React.useState<OverrideRow | null>(null);
  const d = list.draft;
  const set = list.setDraftField;
  const columns: ListColumn<OverrideRow>[] = [
    { key: 'employee', header: 'Employee', value: (r) => `${r.employee.name}${r.employee.employeeNo ? ` (${r.employee.employeeNo})` : ''}` },
    { key: 'type', header: 'Type', sortable: false, value: (r) => r.leaveType.name },
    { key: 'year', header: 'Year', align: 'right', value: (r) => r.year },
    { key: 'days', header: 'Days (override)', align: 'right', sortable: false, value: (r) => formatDays(r.days) },
    { key: 'band', header: 'Band value it replaces', align: 'right', sortable: false, value: (r) => formatDays(r.bandValue) },
    { key: 'reason', header: 'Reason', sortable: false, value: (r) => r.reason },
    { key: 'by', header: 'Entered by / at', sortable: false, priority: 'low', value: (r) => `${r.enteredByName} · ${formatDateTime(r.enteredAt)}` },
  ];
  return (
    <>
      <ListPage<OverrideRow>
        itemName={{ singular: 'override', plural: 'entitlement overrides' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Employee no. or name." />,
          <EmployeePicker
            key="e"
            label="Employee"
            activeOnly={false}
            value={d.employeeId ? { id: d.employeeId, employeeNo: '', name: d.employeeName || 'Selected employee' } : null}
            onChange={(v) => {
              set('employeeId', v?.id ?? '');
              set('employeeName', v ? `${v.name}${v.employeeNo ? ` (${v.employeeNo})` : ''}` : '');
            }}
          />,
          <MultiSelectFilter key="t" label="Type" value={d.leaveTypeIds} onChange={(v) => set('leaveTypeIds', v)} options={types.filter((t) => t.entitlementMethod === 'annual_banded').map((t) => ({ value: t.id, label: t.name }))} />,
          <SelectFilter key="y" label="Year" value={d.year} onChange={(v) => set('year', v)} options={yearOptions(currentYear, 3, 1)} />,
        ]}
        {...list.listProps}
        addNew={{ label: 'Add override', onClick: () => setForm({ editing: null }) }}
        onExport={async () => {
          try {
            const res = await exportOverridesCsv(params);
            if (res.ok) downloadServerCsv(res.filename || 'entitlement-overrides', res.content);
            else toast.info(res.error);
          } catch {
            toast.info('Export failed. Please try again.');
          }
        }}
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(x) => x.id}
        getRowRef={(x) => `${x.employee.name} ${x.leaveType.code} ${x.year}`}
        rowActions={(x) => [
          { label: 'Edit', onClick: () => setForm({ editing: x }) },
          { label: 'Remove', danger: true, onClick: () => setRemove(x) },
        ]}
        empty={{ title: 'No entitlement overrides yet.' }}
      />
      <OverrideDialog open={form !== null} onClose={() => setForm(null)} types={types} currentYear={currentYear} isSuperAdmin={isSuperAdmin} editing={form?.editing ?? null} />
      <ConfirmDialog
        open={Boolean(remove)}
        title={`Remove the override for ${remove?.employee.name ?? ''}?`}
        body={`${remove?.leaveType.name ?? ''} ${remove?.year ?? ''} returns to the band value${remove?.bandValue ? ` (${formatDays(remove.bandValue)} days)` : ''}; the entitlement is recomputed.`}
        confirmLabel="Remove"
        destructive
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          if (!remove) return;
          const res = await r.run(() => removeOverride({ id: remove.id }), { success: 'Override removed. Entitlement recomputed.' });
          if (res && !res.ok) toast.info(res.error);
          setRemove(null);
        }}
      />
    </>
  );
}
