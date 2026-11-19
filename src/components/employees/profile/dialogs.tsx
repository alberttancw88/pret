'use client';

// Profile action dialogs (E3 ACTIONS menu):
// E6 Confirm / Extend probation · E8 Withdraw resignation · Withdraw offer (Pending Join →
// Withdrawn, §5.6) · Send / re-send invite (F-ADM-02) · E16 HR note · Change photo (A16) ·
// Change employee no. (A1, SA, logged) · E5 Add / edit job change · Delete future job change.
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  JOB_CHANGE_TYPE_LABELS,
  MANUAL_JOB_CHANGE_TYPES,
  MY_STATE_LABELS,
  PROBATION_RECOMMENDATION_LABELS,
  type EmployeeDocumentRow,
  type EmployeeProfile,
  type HrNote,
  type JobChangeContext,
  type JobHistoryRow,
} from '@/server/contracts/employees';
import type { OrgOptions } from '@/server/contracts/org';
import {
  addJobChange,
  changeEmployeeNo,
  confirmEmployee,
  createHrNote,
  extendProbation,
  fetchJobChangeContext,
  inviteEmployee,
  setEmployeePhoto,
  updateHrNote,
  updateJobChange,
  withdrawOffer,
  withdrawResignation,
} from '@/server/actions/employees';
import FormDialog from '../../forms/FormDialog';
import { DateInput, FormGrid, FullRow, KeyValue, RadioInput, SelectInput, TextInput } from '../../forms/fields';
import { useActionRunner } from '../../forms/useActionRunner';
import { orgOptions } from '../../org/common';
import EmployeePicker, { type PickedEmployee } from '../EmployeePicker';
import { FileField } from '../fieldGroups';
import { PHOTO_ACCEPT, uploadEmployeeFile } from '../upload';
import { addDays, formatDate, todayMyt } from '@/lib/format';

type Base = { open: boolean; onClose: () => void };

// ---------------------------------------------------------------------------
// Send / re-send invite
// ---------------------------------------------------------------------------
export function InviteDialog({ open, onClose, profile }: Base & { profile: EmployeeProfile }) {
  const r = useActionRunner();
  const [mode, setMode] = React.useState<'now' | 'scheduled'>('now');
  const [date, setDate] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setMode('now');
      setDate(profile.portal.inviteScheduledFor ?? '');
      r.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const resend = profile.portal.state === 'pending_activation';
  return (
    <FormDialog
      open={open}
      title={resend ? `Re-send invite to ${profile.personal.employeeNo}` : `Send invite to ${profile.personal.employeeNo}`}
      onClose={onClose}
      submitLabel={mode === 'now' ? (resend ? 'Re-send invite' : 'Send invite') : 'Schedule invite'}
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      onSubmit={async () => {
        const res = await r.run(() => inviteEmployee({ employeeId: profile.id, mode, scheduledSendDate: mode === 'scheduled' ? date : null }), {
          success: (x) => String((x as { message?: string }).message || 'Invite sent.'),
        });
        if (res?.ok) onClose();
      }}
    >
      <Stack spacing={2}>
        <KeyValue label="Sign-in email (work email)" value={profile.contact.workEmail} />
        {profile.portal.inviteScheduledFor && <Alert severity="info">An invite is scheduled for {formatDate(profile.portal.inviteScheduledFor)}.</Alert>}
        <RadioInput
          label="When"
          value={mode}
          onChange={(v) => setMode(v as 'now' | 'scheduled')}
          options={[
            { value: 'now', label: 'Send now' },
            { value: 'scheduled', label: 'Schedule on a date' },
          ]}
        />
        {mode === 'scheduled' && <DateInput label="Send on" required value={date} onChange={setDate} minDate={todayMyt()} error={r.fieldErrors.scheduledSendDate} />}
      </Stack>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// E6 Confirm / Extend probation
// ---------------------------------------------------------------------------
function currentProbationEnd(p: EmployeeProfile) {
  return p.employment.extendedProbationEndDate ?? p.employment.probationEndDate;
}
function Recommendation({ p }: { p: EmployeeProfile }) {
  const latest = p.probationRecommendations[0];
  if (!latest) return <KeyValue label="Manager recommendation" value="None recorded" />;
  return (
    <KeyValue
      label="Manager recommendation"
      value={`${PROBATION_RECOMMENDATION_LABELS[latest.recommendation]}${latest.suggestedExtensionMonths ? ` (${latest.suggestedExtensionMonths} months)` : ''} — ${latest.recommendedByName ?? ''}, ${formatDate(latest.recommendedAt)}${latest.remarks ? ` · “${latest.remarks}”` : ''}`}
    />
  );
}

export function ConfirmDialog({ open, onClose, profile }: Base & { profile: EmployeeProfile }) {
  const r = useActionRunner();
  const end = currentProbationEnd(profile);
  const [date, setDate] = React.useState('');
  const [remarks, setRemarks] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setDate(end ? addDays(end, 1) : todayMyt());
      setRemarks('');
      r.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <FormDialog
      open={open}
      title={`Confirm ${profile.personal.fullName}`}
      onClose={onClose}
      submitLabel="Confirm employee"
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty={remarks !== ''}
      onSubmit={async () => {
        const res = await r.run(() => confirmEmployee({ employeeId: profile.id, confirmationDate: date, remarks }), { success: `${profile.personal.employeeNo} confirmed.` });
        if (res?.ok) onClose();
      }}
    >
      <Stack spacing={2}>
        <KeyValue label="Probation end" value={formatDate(end)} />
        <Recommendation p={profile} />
        <DateInput label="Confirmation date" required value={date} onChange={setDate} minDate={profile.employment.joinDate} error={r.fieldErrors.confirmationDate} helper="Default: the day after probation ends." />
        <TextInput label="Remarks" value={remarks} onChange={setRemarks} maxLength={500} multiline minRows={2} error={r.fieldErrors.remarks} />
        <Typography variant="body2" color="text.secondary">
          Status becomes Confirmed, a “Confirmation” job-history row is added and the employee is notified.
        </Typography>
      </Stack>
    </FormDialog>
  );
}

/** Whole months from the join date to (end + 1 day) — total probation (BR-EMP-12). */
function monthsBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = addDays(to, 1).split('-').map(Number) as [number, number, number];
  const m = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  return Math.max(0, m);
}

export function ExtendProbationDialog({ open, onClose, profile, maxMonths }: Base & { profile: EmployeeProfile; maxMonths: number }) {
  const r = useActionRunner();
  const end = currentProbationEnd(profile) ?? '';
  const [date, setDate] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [local, setLocal] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (open) {
      setDate('');
      setReason('');
      setLocal({});
      r.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const total = date ? monthsBetween(profile.employment.joinDate, date) : null;
  const errors = { ...r.fieldErrors, ...local };
  return (
    <FormDialog
      open={open}
      title={`Extend probation — ${profile.personal.employeeNo}`}
      onClose={onClose}
      submitLabel="Extend probation"
      saving={r.saving}
      error={r.error}
      fieldErrors={errors}
      dirty={date !== '' || reason !== ''}
      onSubmit={async () => {
        const e: Record<string, string> = {};
        if (!date) e.newEndDate = 'Enter the new probation end.';
        else if (end && date <= end) e.newEndDate = `New probation end must be after ${formatDate(end)}.`;
        else if (total !== null && total > maxMonths) e.newEndDate = `Total probation can't exceed ${maxMonths} months.`;
        if (!reason.trim()) e.reason = 'Enter the reason.';
        setLocal(e);
        if (Object.keys(e).length) return;
        const res = await r.run(() => extendProbation({ employeeId: profile.id, newEndDate: date, reason }), { success: `Probation extended to ${formatDate(date)}.` });
        if (res?.ok) onClose();
      }}
    >
      <Stack spacing={2}>
        <TextInput label="Current probation end" value={formatDate(end)} onChange={() => undefined} locked="Current value." />
        <Recommendation p={profile} />
        <DateInput label="New probation end" required value={date} onChange={setDate} minDate={end ? addDays(end, 1) : undefined} error={errors.newEndDate} helper={total !== null ? `Total probation: about ${total} months (max ${maxMonths}).` : undefined} />
        <TextInput label="Reason" required value={reason} onChange={setReason} maxLength={500} multiline minRows={3} error={errors.reason} />
      </Stack>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// E8 Withdraw resignation · Withdraw offer
// ---------------------------------------------------------------------------
export function WithdrawResignationDialog({ open, onClose, profile }: Base & { profile: EmployeeProfile }) {
  const r = useActionRunner();
  const [remarks, setRemarks] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setRemarks('');
      r.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const back = profile.employment.confirmationDate ? 'Confirmed' : 'On Probation';
  return (
    <FormDialog
      open={open}
      title="Withdraw resignation"
      onClose={onClose}
      submitLabel="Withdraw resignation"
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty={remarks !== ''}
      onSubmit={async () => {
        if (!remarks.trim()) {
          r.setFieldErrors({ remarks: 'Enter the remarks.' });
          return;
        }
        const res = await r.run(() => withdrawResignation({ employeeId: profile.id, remarks }), {
          success: (x) => `Resignation withdrawn · status ${EMPLOYMENT_STATUS_LABELS[(x as unknown as { status: 'confirmed' }).status] ?? back}.`,
        });
        if (res?.ok) onClose();
      }}
    >
      <Typography sx={{ mb: 2 }}>
        Withdraw the separation of {profile.personal.employeeNo}? Status returns to {back}. The separation details move to history.
      </Typography>
      <TextInput label="Remarks" required value={remarks} onChange={setRemarks} maxLength={500} multiline minRows={3} error={r.fieldErrors.remarks} />
    </FormDialog>
  );
}

export function WithdrawOfferDialog({ open, onClose, profile }: Base & { profile: EmployeeProfile }) {
  const r = useActionRunner();
  const [remarks, setRemarks] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setRemarks('');
      r.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <FormDialog
      open={open}
      title="Withdraw offer"
      onClose={onClose}
      submitLabel="Withdraw offer"
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty={remarks !== ''}
      onSubmit={async () => {
        if (!remarks.trim()) {
          r.setFieldErrors({ remarks: 'Enter the remarks.' });
          return;
        }
        const res = await r.run(() => withdrawOffer({ employeeId: profile.id, remarks }), { success: `${profile.personal.employeeNo} marked Withdrawn.` });
        if (res?.ok) onClose();
      }}
    >
      <Typography sx={{ mb: 2 }}>
        Mark {profile.personal.employeeNo} as Withdrawn (offer withdrawn or no-show)? The person never joined; any pending invite is cancelled.
      </Typography>
      <TextInput label="Remarks" required value={remarks} onChange={setRemarks} maxLength={500} multiline minRows={3} error={r.fieldErrors.remarks} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// E16 HR note
// ---------------------------------------------------------------------------
export function HrNoteDialog({ open, onClose, employeeId, note }: Base & { employeeId: string; note: HrNote | null }) {
  const r = useActionRunner();
  const [date, setDate] = React.useState(todayMyt());
  const [body, setBody] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setDate(note?.noteDate ?? todayMyt());
      setBody(note?.body ?? '');
      r.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <FormDialog
      open={open}
      title={note ? 'Edit HR note' : 'Add HR note'}
      onClose={onClose}
      submitLabel="Save note"
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty={body !== (note?.body ?? '')}
      onSubmit={async () => {
        const res = await r.run(
          () => (note ? updateHrNote({ id: note.id, version: note.version, noteDate: date, body }) : createHrNote({ employeeId, noteDate: date, body })),
          { success: 'Note saved.' },
        );
        if (res?.ok) onClose();
      }}
    >
      <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
        HR-only — never shown to the employee or manager.{note ? ' Editing keeps the previous text in the history.' : ''}
      </Alert>
      <Stack spacing={2}>
        <DateInput label="Note date" required value={date} onChange={setDate} error={r.fieldErrors.noteDate} />
        <TextInput label="Note" required value={body} onChange={setBody} maxLength={2000} multiline minRows={5} error={r.fieldErrors.body} />
      </Stack>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// A16 Photo
// ---------------------------------------------------------------------------
export function PhotoDialog({ open, onClose, employeeId, hasPhoto }: Base & { employeeId: string; hasPhoto: boolean }) {
  const r = useActionRunner();
  const [file, setFile] = React.useState<File | null>(null);
  React.useEffect(() => {
    if (open) {
      setFile(null);
      r.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <FormDialog
      open={open}
      title="Change photo"
      onClose={onClose}
      submitLabel={file ? 'Upload photo' : hasPhoto ? 'Remove photo' : 'Save'}
      saving={r.saving}
      error={r.error}
      dirty={Boolean(file)}
      onSubmit={async () => {
        const res = await r.run(async () => {
          if (!file) return setEmployeePhoto({ employeeId, fileId: null });
          const up = await uploadEmployeeFile(employeeId, 'photo', file);
          if (!up.ok) return { ok: false as const, error: up.error };
          return setEmployeePhoto({ employeeId, fileId: up.fileId });
        }, { success: file ? 'Photo updated.' : 'Photo removed.' });
        if (res?.ok) onClose();
      }}
    >
      <FileField label="Photo" file={file} onChange={setFile} accept={PHOTO_ACCEPT} helper={hasPhoto ? 'JPG or PNG, up to 5 MB. Leave empty and save to remove the current photo.' : 'JPG or PNG, up to 5 MB.'} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// A1 Employee no. (SA only, logged)
// ---------------------------------------------------------------------------
export function ChangeEmployeeNoDialog({ open, onClose, profile }: Base & { profile: EmployeeProfile }) {
  const r = useActionRunner();
  const [no, setNo] = React.useState('');
  const [reason, setReason] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setNo(profile.personal.employeeNo);
      setReason('');
      r.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <FormDialog
      open={open}
      title="Change employee no."
      onClose={onClose}
      submitLabel="Change employee no."
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty={no !== profile.personal.employeeNo || reason !== ''}
      onSubmit={async () => {
        const res = await r.run(() => changeEmployeeNo({ employeeId: profile.id, employeeNo: no, reason }), { success: `Employee no. changed to ${no}.`, refresh: false });
        if (res?.ok) window.location.assign(`/employees/${encodeURIComponent(no)}`);
      }}
    >
      <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
        The employee no. is normally fixed after the first save. This change is logged with your reason.
      </Alert>
      <Stack spacing={2}>
        <TextInput label="Employee no." required value={no} onChange={(v) => setNo(v.toUpperCase())} maxLength={20} error={r.fieldErrors.employeeNo} />
        <TextInput label="Reason" required value={reason} onChange={setReason} maxLength={500} multiline minRows={2} error={r.fieldErrors.reason} />
      </Stack>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// E5 Add / edit job change
// ---------------------------------------------------------------------------
type JobForm = {
  effectiveDate: string;
  changeType: string;
  departmentId: string;
  positionId: string;
  gradeId: string;
  manager: PickedEmployee | null;
  workLocationId: string;
  workingPatternId: string;
  remarks: string;
  referenceDocumentId: string;
};

function rowInForceOn(history: JobHistoryRow[], date: string): JobHistoryRow | null {
  return [...history].filter((h) => h.effectiveDate <= date).sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1))[0] ?? null;
}
const fromRow = (row: Pick<JobHistoryRow, 'department' | 'position' | 'grade' | 'manager' | 'workLocation' | 'workingPattern'> | null) => ({
  departmentId: row?.department.id ?? '',
  positionId: row?.position.id ?? '',
  gradeId: row?.grade.id ?? '',
  manager: row?.manager ? { id: row.manager.id, employeeNo: row.manager.employeeNo, name: row.manager.name } : null,
  workLocationId: row?.workLocation.id ?? '',
  workingPatternId: row?.workingPattern.id ?? '',
});

export function JobChangeDialog({
  open,
  onClose,
  profile,
  org,
  editRow,
  documents,
}: Base & { profile: EmployeeProfile; org: OrgOptions; editRow: JobHistoryRow | null; documents: EmployeeDocumentRow[] }) {
  const r = useActionRunner();
  const today = todayMyt();
  const isPastEdit = Boolean(editRow && !editRow.isScheduled);
  const [f, setF] = React.useState<JobForm>(() => ({ effectiveDate: today, changeType: '', remarks: '', referenceDocumentId: '', ...fromRow(null) }));
  const [base, setBase] = React.useState<ReturnType<typeof fromRow> | null>(null);
  const [ctx, setCtx] = React.useState<JobChangeContext | null>(null);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    r.reset();
    setTouched(false);
    if (editRow) {
      const v = fromRow(editRow);
      setF({ effectiveDate: editRow.effectiveDate, changeType: isPastEdit ? 'data_correction' : editRow.changeType, remarks: editRow.remarks ?? '', referenceDocumentId: editRow.referenceDocumentId ?? '', ...v });
      setBase(v);
    } else {
      const v = fromRow(rowInForceOn(profile.jobHistory, today));
      setF({ effectiveDate: today, changeType: '', remarks: '', referenceDocumentId: '', ...v });
      setBase(v);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Pre-fill from the row in force on JH1 + impact panel (server).
  React.useEffect(() => {
    if (!open || !/^\d{4}-\d{2}-\d{2}$/.test(f.effectiveDate)) return;
    let alive = true;
    const t = window.setTimeout(async () => {
      let c: JobChangeContext | null = null;
      try {
        const res = await fetchJobChangeContext({ employeeId: profile.id, effectiveDate: f.effectiveDate });
        c = res.ok ? res.context : null;
      } catch {
        c = null;
      }
      if (!alive) return;
      setCtx(c);
      if (!editRow && c?.rowInForce) {
        const v = fromRow(c.rowInForce);
        setBase(v);
        if (!touched) setF((x) => ({ ...x, ...v }));
      }
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, f.effectiveDate]);

  const set = (p: Partial<JobForm>) => {
    setTouched(true);
    setF((x) => ({ ...x, ...p }));
  };
  const changed = (k: keyof ReturnType<typeof fromRow>) => {
    if (!base) return false;
    if (k === 'manager') return (base.manager?.id ?? '') !== (f.manager?.id ?? '');
    return base[k] !== f[k];
  };
  const hl = (k: keyof ReturnType<typeof fromRow>) => (changed(k) ? { '& .MuiOutlinedInput-notchedOutline': { borderColor: '#5A5FF2', borderWidth: 2 } } : undefined);
  const loc = org.locations.find((l) => l.id === f.workLocationId);
  const typeOptions = (isPastEdit ? (['data_correction'] as const) : MANUAL_JOB_CHANGE_TYPES).map((t) => ({ value: t, label: JOB_CHANGE_TYPE_LABELS[t] }));
  const future = f.effectiveDate > today;
  const impacts = [
    ...(ctx?.impacts ?? []),
    ...(changed('manager') && f.manager ? [`Pending approvals of this employee will re-route to ${f.manager.name}.`] : []),
    ...(changed('workLocationId') && loc ? [`PH calendar changes to ${MY_STATE_LABELS[loc.state]} from ${formatDate(f.effectiveDate)}.`] : []),
    ...(changed('gradeId') || changed('workLocationId') || changed('workingPatternId') ? ['Leave entitlements will be recomputed.'] : []),
  ].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <FormDialog
      open={open}
      title={editRow ? (isPastEdit ? 'Correct job-history row' : 'Edit scheduled job change') : 'Add job change'}
      onClose={onClose}
      submitLabel="Save job change"
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty={touched}
      maxWidth="md"
      onSubmit={async () => {
        const payload = {
          effectiveDate: f.effectiveDate,
          changeType: f.changeType as (typeof MANUAL_JOB_CHANGE_TYPES)[number],
          departmentId: f.departmentId,
          positionId: f.positionId,
          gradeId: f.gradeId,
          managerId: f.manager?.id ?? null,
          workLocationId: f.workLocationId,
          workingPatternId: f.workingPatternId,
          remarks: f.remarks,
          referenceDocumentId: f.referenceDocumentId,
        };
        if (!f.changeType) {
          r.setFieldErrors({ changeType: 'Select the change type.' });
          return;
        }
        if (f.changeType === 'data_correction' && !f.remarks.trim()) {
          r.setFieldErrors({ remarks: 'Remarks are required for a data correction.' });
          return;
        }
        const res = await r.run(
          () => (editRow ? updateJobChange({ id: editRow.id, version: editRow.version, ...payload }) : addJobChange({ employeeId: profile.id, ...payload })),
          { success: future ? `Job change scheduled for ${formatDate(f.effectiveDate)}.` : 'Job change saved.' },
        );
        if (res?.ok) onClose();
      }}
    >
      {isPastEdit && (
        <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
          This row is already in effect: it can only be corrected (change type “Data correction”, remarks required). The correction is logged.
        </Alert>
      )}
      <FormGrid>
        <DateInput label="Effective date" required value={f.effectiveDate} onChange={(v) => set({ effectiveDate: v })} minDate={profile.employment.joinDate} error={r.fieldErrors.effectiveDate} helper={future ? 'Future date — the change is Scheduled and applies at 00:00 on that day.' : 'On or after the join date.'} />
        <SelectInput label="Change type" required value={f.changeType} onChange={(v) => set({ changeType: v })} options={typeOptions} error={r.fieldErrors.changeType} />
        <Box sx={hl('departmentId')}>
          <SelectInput label="Department" required value={f.departmentId} onChange={(v) => set({ departmentId: v })} options={orgOptions(org.departments, [f.departmentId])} error={r.fieldErrors.departmentId} helper={changed('departmentId') ? 'Changed' : undefined} />
        </Box>
        <Box sx={hl('positionId')}>
          <SelectInput label="Position" required value={f.positionId} onChange={(v) => set({ positionId: v })} options={orgOptions(org.positions, [f.positionId])} error={r.fieldErrors.positionId} helper={changed('positionId') ? 'Changed' : undefined} />
        </Box>
        <Box sx={hl('gradeId')}>
          <SelectInput label="Grade" required value={f.gradeId} onChange={(v) => set({ gradeId: v })} options={orgOptions(org.grades, [f.gradeId])} error={r.fieldErrors.gradeId} helper={changed('gradeId') ? 'Changed' : undefined} />
        </Box>
        <Box sx={hl('manager')}>
          <EmployeePicker label="Reporting manager" required={!profile.employmentHr.isTopOfOrg} value={f.manager} onChange={(v) => set({ manager: v })} excludeEmployeeId={profile.id} error={r.fieldErrors.managerId} helper={changed('manager') ? 'Changed — checked for reporting-line loops.' : undefined} />
        </Box>
        <Box sx={hl('workLocationId')}>
          <SelectInput
            label="Work location"
            required
            value={f.workLocationId}
            onChange={(v) => set({ workLocationId: v })}
            options={org.locations.filter((l) => l.isActive || l.id === f.workLocationId).map((l) => ({ value: l.id, label: `${l.label} (${MY_STATE_LABELS[l.state]})` }))}
            error={r.fieldErrors.workLocationId}
            helper={changed('workLocationId') ? 'Changed' : undefined}
          />
        </Box>
        <Box sx={hl('workingPatternId')}>
          <SelectInput label="Working-week pattern" required value={f.workingPatternId} onChange={(v) => set({ workingPatternId: v })} options={orgOptions(org.workingPatterns, [f.workingPatternId])} error={r.fieldErrors.workingPatternId} helper={changed('workingPatternId') ? 'Changed' : undefined} />
        </Box>
        <TextInput label="Employment type" value={EMPLOYMENT_TYPE_LABELS.permanent_full_time} onChange={() => undefined} locked="Fixed in Phase 1." />
        <SelectInput
          label="Reference document (optional)"
          value={f.referenceDocumentId}
          onChange={(v) => set({ referenceDocumentId: v })}
          options={documents.filter((d) => d.isActive).map((d) => ({ value: d.id, label: `${d.title} (${formatDate(d.documentDate ?? d.uploadedAt)})` }))}
          emptyLabel="— None —"
        />
        <TextInput full label="Remarks / reference letter" required={f.changeType === 'data_correction'} value={f.remarks} onChange={(v) => set({ remarks: v })} maxLength={500} multiline minRows={2} error={r.fieldErrors.remarks} />
        <FullRow>
          {impacts.length > 0 && (
            <Alert severity="info" variant="outlined">
              <Typography variant="subtitle2" component="p">
                Impact
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                {impacts.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </Box>
            </Alert>
          )}
        </FullRow>
      </FormGrid>
    </FormDialog>
  );
}
