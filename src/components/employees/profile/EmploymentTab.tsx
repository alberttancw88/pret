'use client';

// E3 tab 5 · Employment & history — group F, probation, job history (§5.5), separation (G),
// prior employment (L2). Department / position / grade / manager / location / pattern change
// only through ADD JOB CHANGE (E5) so effective-dated history is kept (UXQ-13); the card edits
// the non-effective-dated fields (F1, F2, F4, F14 SA, F15, F16, F20–F23, F25, F28).
import * as React from 'react';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  EMPLOYMENT_TYPE_LABELS,
  JOB_CHANGE_TYPE_LABELS,
  MY_STATE_LABELS,
  NOTICE_OUTCOME_LABELS,
  NOTICE_UNIT_LABELS,
  PROBATION_RECOMMENDATION_LABELS,
  SEPARATION_REASON_LABELS,
  SEPARATION_TYPE_LABELS,
  lengthOfServiceText,
  type EmployeeDocumentRow,
  type EmploymentView,
  type JobHistoryRow,
  type PriorEmploymentView,
  type SeparationView,
} from '@/server/contracts/employees';
import { deleteJobChange, deletePriorEmployment, exportJobHistoryCsv, savePriorEmployment, updateEmployment } from '@/server/actions/employees';
import FormDialog from '../../forms/FormDialog';
import ReasonDialog from '../../dialogs/ReasonDialog';
import ConfirmDialog from '../../dialogs/ConfirmDialog';
import { DateInput, FormGrid, MultiSelectInput, NumberInput, SelectInput, SwitchInput, TextInput } from '../../forms/fields';
import { useActionRunner } from '../../forms/useActionRunner';
import { downloadServerCsv } from '../../list/useServerList';
import { useToast } from '../../ToastProvider';
import { orgOptions } from '../../org/common';
import EmployeePicker, { type PickedEmployee } from '../EmployeePicker';
import { KVGrid, MiniTable, SectionCard } from '../ui';
import { EmploymentStatusChip, ScheduledChip, dateOr, empLabel, optionsOf, yesNo } from '../labels';
import type { ProfileCtx } from './context';
import { ConfirmDialog as ConfirmProbationDialog, ExtendProbationDialog, JobChangeDialog, WithdrawResignationDialog } from './dialogs';

const notice = (e: Pick<EmploymentView, 'contractualNoticeValue' | 'contractualNoticeUnit'>) =>
  e.contractualNoticeValue && e.contractualNoticeUnit ? `${e.contractualNoticeValue} ${NOTICE_UNIT_LABELS[e.contractualNoticeUnit].toLowerCase()}` : 'EA s12 default';

/** Read-only employment facts — shared with P16 (own) and P32 (manager, limited). */
export function EmploymentFacts({ e, hr, limited }: { e: Partial<EmploymentView> & Pick<EmploymentView, 'joinDate' | 'status' | 'department' | 'position' | 'grade' | 'workLocation' | 'workState' | 'workingPattern' | 'lengthOfService'>; hr?: ProfileCtx['profile']['employmentHr']; limited?: boolean }) {
  return (
    <KVGrid
      items={[
        { label: 'Join date', value: dateOr(e.joinDate) },
        { label: 'Continuous-service date', value: dateOr(e.continuousServiceDate), hidden: limited || e.continuousServiceDate === undefined },
        { label: 'Employment type', value: e.employmentType ? EMPLOYMENT_TYPE_LABELS[e.employmentType] : '' },
        { label: 'Probation period', value: e.probationMonths !== undefined ? `${e.probationMonths} months` : '' },
        { label: 'Probation end date', value: dateOr(e.probationEndDate) },
        { label: 'Extended probation end', value: dateOr(e.extendedProbationEndDate), hidden: !e.extendedProbationEndDate },
        { label: 'Confirmation date', value: dateOr(e.confirmationDate) },
        { label: 'Employment status', value: <EmploymentStatusChip status={e.status} /> },
        { label: 'Department', value: e.department.label },
        { label: 'Position / job title', value: e.position.label },
        { label: 'Grade', value: e.grade.label },
        { label: 'Reporting manager', value: e.manager ? empLabel(e.manager) : hr?.isTopOfOrg ? 'Top of organisation' : '' },
        { label: 'Reporting manager since', value: dateOr(e.managerSince) },
        { label: 'Leave approver (override)', value: e.leaveApprover ? empLabel(e.leaveApprover) : 'Reporting manager' },
        { label: 'Claim approver (override)', value: e.claimApprover ? empLabel(e.claimApprover) : 'Reporting manager' },
        { label: 'Work location', value: e.workLocation.label },
        { label: 'Work state', value: MY_STATE_LABELS[e.workState] },
        { label: 'Working-week pattern', value: e.workingPattern.label },
        { label: 'Contractual notice period', value: e.contractualNoticeValue !== undefined ? notice(e as EmploymentView) : '', hidden: limited || e.contractualNoticeValue === undefined },
        { label: 'Length of service', value: lengthOfServiceText(e.lengthOfService) },
        { label: 'Retirement date', value: dateOr(e.retirementDate), hidden: limited || !e.retirementDate },
        ...(hr
          ? [
              { label: 'Top of organisation', value: yesNo(hr.isTopOfOrg) },
              { label: 'Public-holiday calendar override', value: hr.phStateOverride ? MY_STATE_LABELS[hr.phStateOverride] : 'None' },
              { label: 'Cost centre', value: hr.costCentre?.label ?? '' },
              { label: 'Offer / contract reference', value: hr.offerContractRef },
              { label: 'Contract / LOA signed date', value: dateOr(hr.contractSignedDate) },
              { label: 'Employee groups', value: hr.employeeGroups.map((g) => g.label).join(', ') },
              { label: 'Pay group', value: hr.payGroup?.label ?? 'Release 1.1' },
            ]
          : []),
      ]}
    />
  );
}

export function JobHistoryTable({ rows, showEnteredBy, showRemarks = true, actions }: { rows: JobHistoryRow[]; showEnteredBy?: boolean; showRemarks?: boolean; actions?: (r: JobHistoryRow) => React.ReactNode }) {
  return (
    <MiniTable
      caption="Job history"
      rows={[...rows].sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1))}
      getRowId={(r) => r.id}
      empty="No job history."
      rowActions={actions}
      columns={[
        {
          key: 'd',
          header: 'Effective date',
          render: (r) => (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <span>{dateOr(r.effectiveDate)}</span>
              {r.isScheduled && <ScheduledChip />}
            </Stack>
          ),
        },
        { key: 't', header: 'Change type', render: (r) => JOB_CHANGE_TYPE_LABELS[r.changeType] },
        { key: 'dep', header: 'Department', render: (r) => r.department.label },
        { key: 'pos', header: 'Position', render: (r) => r.position.label },
        { key: 'g', header: 'Grade', render: (r) => r.grade.label },
        { key: 'm', header: 'Manager', render: (r) => r.manager?.name ?? '—' },
        { key: 'l', header: 'Location', render: (r) => r.workLocation.label },
        ...(showRemarks ? [{ key: 'r', header: 'Remarks', render: (r: JobHistoryRow) => r.remarks || '—' }] : []),
        ...(showEnteredBy ? [{ key: 'by', header: 'Entered by', render: (r: JobHistoryRow) => (r.enteredByName ? `${r.enteredByName}${r.enteredAt ? `, ${dateOr(r.enteredAt)}` : ''}` : '—') }] : []),
      ]}
    />
  );
}

export function SeparationFacts({ s }: { s: Pick<SeparationView, 'noticeDate' | 'separationType' | 'lastWorkingDay'> & Partial<SeparationView> }) {
  const d = s.details;
  return (
    <KVGrid
      items={[
        { label: 'Notice date', value: dateOr(s.noticeDate) },
        { label: 'Separation type', value: SEPARATION_TYPE_LABELS[s.separationType] },
        { label: 'Last working day', value: dateOr(s.lastWorkingDay) },
        ...(d
          ? [
              { label: 'Reason (HR only)', value: `${SEPARATION_REASON_LABELS[d.reasonCategory]}${d.reasonText ? ` — ${d.reasonText}` : ''}` },
              { label: 'Notice period required', value: `${d.noticeRequiredDays} days` },
              { label: 'Notice handling', value: `${NOTICE_OUTCOME_LABELS[d.noticeOutcome]}${d.noticeShortfallDays ? ` · shortfall ${d.noticeShortfallDays} days` : ''}` },
              { label: 'Portal access end', value: dateOr(d.portalAccessEndDate) },
              { label: 'Eligible for rehire', value: yesNo(d.eligibleForRehire) },
              { label: 'Exit remarks', value: d.exitRemarks, full: true },
            ]
          : []),
        { label: 'Withdrawn', value: s.isWithdrawn ? `Yes, ${dateOr(s.withdrawnAt)}${s.withdrawRemarks ? ` — ${s.withdrawRemarks}` : ''}` : '', hidden: !s.isWithdrawn },
      ]}
    />
  );
}

type EmpForm = {
  joinDate: string;
  continuousServiceDate: string;
  probationMonths: string;
  leaveApprover: PickedEmployee | null;
  claimApprover: PickedEmployee | null;
  contractualNoticeValue: string;
  contractualNoticeUnit: string;
  phStateOverride: string;
  costCentreId: string;
  offerContractRef: string;
  contractSignedDate: string;
  employeeGroupIds: string[];
  isTopOfOrg: boolean;
};

export default function EmploymentTab({ ctx, documents, maxProbationMonths }: { ctx: ProfileCtx; documents: EmployeeDocumentRow[]; maxProbationMonths: number }) {
  const { profile, org, isSuperAdmin } = ctx;
  const e = profile.employment;
  const hr = profile.employmentHr;
  const can = profile.can;
  const toast = useToast();
  const r = useActionRunner();
  const [editing, setEditing] = React.useState(false);
  const [f, setF] = React.useState<EmpForm | null>(null);
  const [dlg, setDlg] = React.useState<'job' | 'confirm' | 'extend' | 'withdraw' | null>(null);
  const [editRow, setEditRow] = React.useState<JobHistoryRow | null>(null);
  const [delRow, setDelRow] = React.useState<JobHistoryRow | null>(null);
  const [menu, setMenu] = React.useState<{ anchor: HTMLElement; row: JobHistoryRow } | null>(null);
  const [prior, setPrior] = React.useState<PriorEmploymentView | 'new' | null>(null);
  const [delPrior, setDelPrior] = React.useState<PriorEmploymentView | null>(null);
  const [exporting, setExporting] = React.useState(false);

  const startEdit = () => {
    r.reset();
    setF({
      joinDate: e.joinDate,
      continuousServiceDate: e.continuousServiceDate,
      probationMonths: String(e.probationMonths),
      leaveApprover: e.leaveApprover,
      claimApprover: e.claimApprover,
      contractualNoticeValue: e.contractualNoticeValue ? String(e.contractualNoticeValue) : '',
      contractualNoticeUnit: e.contractualNoticeUnit ?? '',
      phStateOverride: hr.phStateOverride ?? '',
      costCentreId: hr.costCentre?.id ?? '',
      offerContractRef: hr.offerContractRef ?? '',
      contractSignedDate: hr.contractSignedDate ?? '',
      employeeGroupIds: hr.employeeGroups.map((g) => g.id),
      isTopOfOrg: hr.isTopOfOrg,
    });
    setEditing(true);
  };
  const set = (p: Partial<EmpForm>) => setF((x) => (x ? { ...x, ...p } : x));
  const save = async () => {
    if (!f) return;
    const res = await r.run(
      () =>
        updateEmployment({
          employeeId: profile.id,
          joinDate: f.joinDate,
          continuousServiceDate: f.continuousServiceDate,
          probationMonths: f.probationMonths,
          leaveApproverId: f.leaveApprover?.id ?? null,
          claimApproverId: f.claimApprover?.id ?? null,
          contractualNoticeValue: f.contractualNoticeValue,
          contractualNoticeUnit: f.contractualNoticeUnit,
          phStateOverride: f.phStateOverride,
          costCentreId: f.costCentreId,
          offerContractRef: f.offerContractRef,
          contractSignedDate: f.contractSignedDate,
          employeeGroupIds: f.employeeGroupIds,
          ...(isSuperAdmin ? { isTopOfOrg: f.isTopOfOrg } : {}),
        }),
      { success: 'Employment details saved.' },
    );
    if (res?.ok) setEditing(false);
  };

  const onProbation = e.status === 'on_probation';
  const stateOpts = Object.entries(MY_STATE_LABELS).map(([value, label]) => ({ value, label }));

  return (
    <Stack spacing={2}>
      <SectionCard
        title="Current employment"
        subtitle="Department, position, grade, manager, work location and working pattern change through ADD JOB CHANGE so the history is kept."
        canEdit={can.editEmployment}
        editing={editing}
        onEdit={startEdit}
        onCancel={() => setEditing(false)}
        onSave={save}
        saving={r.saving}
        error={r.error}
        fieldErrors={r.fieldErrors}
        headerActions={
          can.addJobChange &&
          !editing && (
            <Button
              size="small"
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditRow(null);
                setDlg('job');
              }}
            >
              Add job change
            </Button>
          )
        }
      >
        {editing && f ? (
          <FormGrid>
            <DateInput label="Join date" required value={f.joinDate} onChange={(v) => set({ joinDate: v })} error={r.fieldErrors.joinDate} helper="Changing it recomputes probation end and leave entitlements." />
            <DateInput label="Continuous-service date" required value={f.continuousServiceDate} onChange={(v) => set({ continuousServiceDate: v })} error={r.fieldErrors.continuousServiceDate} />
            <NumberInput label="Probation period (months)" required value={f.probationMonths} onChange={(v) => set({ probationMonths: v })} min={0} max={12} error={r.fieldErrors.probationMonths} />
            <SwitchInput label="Top of organisation" checked={f.isTopOfOrg} onChange={(v) => set({ isTopOfOrg: v })} locked={isSuperAdmin ? false : 'Only a Super Admin can change this.'} />
            <EmployeePicker label="Leave approver (override)" value={f.leaveApprover} onChange={(v) => set({ leaveApprover: v })} excludeEmployeeId={profile.id} error={r.fieldErrors.leaveApproverId} helper="Blank = reporting manager." />
            <EmployeePicker label="Claim approver (override)" value={f.claimApprover} onChange={(v) => set({ claimApprover: v })} excludeEmployeeId={profile.id} error={r.fieldErrors.claimApproverId} helper="Blank = reporting manager." />
            <SelectInput label="Public-holiday calendar override" value={f.phStateOverride} onChange={(v) => set({ phStateOverride: v })} options={stateOpts} emptyLabel="— None (use work state) —" error={r.fieldErrors.phStateOverride} />
            <Stack direction="row" spacing={1}>
              <NumberInput label="Contractual notice period" value={f.contractualNoticeValue} onChange={(v) => set({ contractualNoticeValue: v })} min={1} max={52} error={r.fieldErrors.contractualNoticeValue} helper="Blank = EA s12 default." />
              <SelectInput label="Unit" value={f.contractualNoticeUnit} onChange={(v) => set({ contractualNoticeUnit: v })} options={optionsOf(NOTICE_UNIT_LABELS)} emptyLabel="—" error={r.fieldErrors.contractualNoticeUnit} />
            </Stack>
            <SelectInput label="Cost centre" value={f.costCentreId} onChange={(v) => set({ costCentreId: v })} options={orgOptions(org.costCentres, [f.costCentreId])} emptyLabel="— None —" />
            <TextInput label="Offer / contract reference" value={f.offerContractRef} onChange={(v) => set({ offerContractRef: v })} maxLength={50} error={r.fieldErrors.offerContractRef} />
            <DateInput label="Contract / LOA signed date" value={f.contractSignedDate} onChange={(v) => set({ contractSignedDate: v })} error={r.fieldErrors.contractSignedDate} />
            <MultiSelectInput label="Employee groups" value={f.employeeGroupIds} onChange={(v) => set({ employeeGroupIds: v })} options={orgOptions(org.employeeGroups, f.employeeGroupIds)} />
          </FormGrid>
        ) : (
          <EmploymentFacts e={e} hr={hr} />
        )}
      </SectionCard>

      <SectionCard
        title="Probation"
        headerActions={
          <>
            {can.confirm && (
              <Button size="small" variant="contained" onClick={() => setDlg('confirm')}>
                Confirm
              </Button>
            )}
            {can.extendProbation && (
              <Button size="small" variant="outlined" onClick={() => setDlg('extend')}>
                Extend probation
              </Button>
            )}
          </>
        }
      >
        <KVGrid
          items={[
            { label: 'Probation period', value: `${e.probationMonths} months` },
            { label: 'Probation end date', value: dateOr(e.probationEndDate) },
            { label: 'Extended probation end', value: dateOr(e.extendedProbationEndDate) },
            { label: 'Extension reason', value: e.probationExtensionReason },
            { label: 'Confirmation date', value: dateOr(e.confirmationDate) },
          ]}
        />
        <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
          Manager recommendations
        </Typography>
        <MiniTable
          caption="Manager recommendations"
          rows={profile.probationRecommendations}
          getRowId={(x) => x.id}
          empty={onProbation ? 'No recommendation yet.' : 'None.'}
          columns={[
            { key: 'a', header: 'Recorded', render: (x) => dateOr(x.recommendedAt) },
            { key: 'b', header: 'By', render: (x) => x.recommendedByName ?? '—' },
            { key: 'c', header: 'Recommendation', render: (x) => `${PROBATION_RECOMMENDATION_LABELS[x.recommendation]}${x.suggestedExtensionMonths ? ` (${x.suggestedExtensionMonths} months)` : ''}` },
            { key: 'd', header: 'Remarks', render: (x) => x.remarks ?? '—' },
          ]}
        />
      </SectionCard>

      <SectionCard
        title="Job history"
        headerActions={
          <>
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={<FileDownloadOutlinedIcon />}
              loading={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  const res = await exportJobHistoryCsv({ employeeId: profile.id });
                  if (res.ok) downloadServerCsv(res.filename || `job-history-${profile.personal.employeeNo}`, res.content);
                  else toast.info(res.error);
                } catch {
                  toast.info('Export failed. Please try again.');
                } finally {
                  setExporting(false);
                }
              }}
            >
              Export .CSV
            </Button>
            {can.addJobChange && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => {
                  setEditRow(null);
                  setDlg('job');
                }}
              >
                Add job change
              </Button>
            )}
          </>
        }
      >
        <JobHistoryTable
          rows={profile.jobHistory}
          showEnteredBy
          actions={
            can.addJobChange
              ? (row) => (
                  <IconButton size="small" aria-label={`Actions for ${dateOr(row.effectiveDate)}`} onClick={(ev) => setMenu({ anchor: ev.currentTarget, row })}>
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                )
              : undefined
          }
        />
        <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
          <MenuItem
            onClick={() => {
              setEditRow(menu!.row);
              setDlg('job');
              setMenu(null);
            }}
          >
            {menu?.row.isScheduled ? 'Edit' : 'Correct (data correction)'}
          </MenuItem>
          {menu?.row.isScheduled && (
            <MenuItem
              onClick={() => {
                setDelRow(menu.row);
                setMenu(null);
              }}
              sx={{ color: 'error.main' }}
            >
              Delete
            </MenuItem>
          )}
        </Menu>
      </SectionCard>

      {profile.separation && (
        <SectionCard
          title="Separation"
          headerActions={
            <>
              {can.editSeparation && (
                <Button size="small" variant="outlined" startIcon={<EditOutlinedIcon />} component={NextLink} href={`/employees/${encodeURIComponent(profile.personal.employeeNo)}/separation`}>
                  Edit
                </Button>
              )}
              {can.withdrawResignation && (
                <Button size="small" variant="outlined" color="warning" onClick={() => setDlg('withdraw')}>
                  Withdraw resignation
                </Button>
              )}
            </>
          }
        >
          <SeparationFacts s={profile.separation} />
        </SectionCard>
      )}
      {profile.separationHistory.length > 0 && (
        <SectionCard title="Separation history">
          <MiniTable
            caption="Separation history"
            rows={profile.separationHistory}
            getRowId={(x) => x.id}
            columns={[
              { key: 'n', header: 'Notice date', render: (x) => dateOr(x.noticeDate) },
              { key: 't', header: 'Type', render: (x) => SEPARATION_TYPE_LABELS[x.separationType] },
              { key: 'l', header: 'Last working day', render: (x) => dateOr(x.lastWorkingDay) },
              { key: 'w', header: 'Withdrawn', render: (x) => (x.isWithdrawn ? `${dateOr(x.withdrawnAt)}${x.withdrawRemarks ? ` — ${x.withdrawRemarks}` : ''}` : 'No') },
            ]}
          />
        </SectionCard>
      )}

      <PriorEmploymentCard
        rows={profile.priorEmployments}
        canEdit={can.editEmployment}
        onAdd={() => setPrior('new')}
        onEdit={(x) => setPrior(x)}
        onDelete={(x) => setDelPrior(x)}
      />

      <JobChangeDialog open={dlg === 'job'} onClose={() => setDlg(null)} profile={profile} org={org} editRow={editRow} documents={documents} />
      <ConfirmProbationDialog open={dlg === 'confirm'} onClose={() => setDlg(null)} profile={profile} />
      <ExtendProbationDialog open={dlg === 'extend'} onClose={() => setDlg(null)} profile={profile} maxMonths={maxProbationMonths} />
      <WithdrawResignationDialog open={dlg === 'withdraw'} onClose={() => setDlg(null)} profile={profile} />
      <ReasonDialog
        open={delRow !== null}
        title={`Delete the scheduled ${delRow ? JOB_CHANGE_TYPE_LABELS[delRow.changeType].toLowerCase() : ''} on ${dateOr(delRow?.effectiveDate)}?`}
        confirmLabel="Delete"
        intro="The change will not take effect. The deletion is logged."
        onClose={() => setDelRow(null)}
        onConfirm={async (reason) => {
          if (!delRow) return;
          const res = await r.run(() => deleteJobChange({ id: delRow.id, reason }), { success: 'Scheduled job change deleted.' });
          if (res?.ok) setDelRow(null);
          else if (res) toast.info(res.error);
        }}
      />
      <PriorEmploymentDialog open={prior !== null} onClose={() => setPrior(null)} employeeId={profile.id} row={prior === 'new' ? null : prior} joinDate={e.joinDate} />
      <ConfirmDialog
        open={delPrior !== null}
        title="Delete this prior employment?"
        body={delPrior ? `${delPrior.employer} · ${delPrior.position}` : undefined}
        confirmLabel="Delete"
        destructive
        onClose={() => setDelPrior(null)}
        onConfirm={async () => {
          if (delPrior) await r.run(() => deletePriorEmployment({ id: delPrior.id }), { success: 'Prior employment deleted.' });
          setDelPrior(null);
        }}
      />
      {r.error && !editing && (
        <Alert severity="error" onClose={() => r.reset()}>
          {r.error}
        </Alert>
      )}
    </Stack>
  );
}

export function PriorEmploymentCard({
  rows,
  canEdit,
  onAdd,
  onEdit,
  onDelete,
}: {
  rows: PriorEmploymentView[];
  canEdit: boolean;
  onAdd: () => void;
  onEdit: (r: PriorEmploymentView) => void;
  onDelete: (r: PriorEmploymentView) => void;
}) {
  return (
    <SectionCard
      title="Prior employment"
      headerActions={
        canEdit && (
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={onAdd}>
            Add
          </Button>
        )
      }
    >
      <MiniTable
        caption="Prior employment"
        rows={rows}
        getRowId={(x) => x.id}
        empty="No prior employment recorded."
        rowActions={
          canEdit
            ? (x) => (
                <>
                  <IconButton size="small" aria-label={`Edit ${x.employer}`} onClick={() => onEdit(x)}>
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" aria-label={`Delete ${x.employer}`} onClick={() => onDelete(x)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </>
              )
            : undefined
        }
        columns={[
          { key: 'e', header: 'Employer', render: (x) => x.employer },
          { key: 'p', header: 'Position', render: (x) => x.position },
          { key: 'f', header: 'From', render: (x) => dateOr(x.dateFrom) },
          { key: 't', header: 'To', render: (x) => dateOr(x.dateTo) },
        ]}
      />
    </SectionCard>
  );
}

export function PriorEmploymentDialog({ open, onClose, employeeId, row, joinDate }: { open: boolean; onClose: () => void; employeeId: string; row: PriorEmploymentView | null; joinDate: string }) {
  const r = useActionRunner();
  const [f, setF] = React.useState({ employer: '', position: '', dateFrom: '', dateTo: '' });
  React.useEffect(() => {
    if (open) {
      r.reset();
      setF({ employer: row?.employer ?? '', position: row?.position ?? '', dateFrom: row?.dateFrom ?? '', dateTo: row?.dateTo ?? '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <FormDialog
      open={open}
      title={row ? 'Edit prior employment' : 'Add prior employment'}
      onClose={onClose}
      submitLabel="Save"
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty
      onSubmit={async () => {
        if (f.dateTo && joinDate && f.dateTo > joinDate) {
          r.setFieldErrors({ dateTo: '"To" must be on or before the join date.' });
          return;
        }
        const res = await r.run(() => savePriorEmployment({ employeeId, id: row?.id, ...f }), { success: 'Prior employment saved.' });
        if (res?.ok) onClose();
      }}
    >
      <FormGrid>
        <TextInput label="Employer" required value={f.employer} onChange={(v) => setF({ ...f, employer: v })} maxLength={150} error={r.fieldErrors.employer} />
        <TextInput label="Position" required value={f.position} onChange={(v) => setF({ ...f, position: v })} maxLength={100} error={r.fieldErrors.position} />
        <DateInput label="From" required value={f.dateFrom} onChange={(v) => setF({ ...f, dateFrom: v })} error={r.fieldErrors.dateFrom} />
        <DateInput label="To" required value={f.dateTo} onChange={(v) => setF({ ...f, dateTo: v })} maxDate={joinDate} error={r.fieldErrors.dateTo} helper="On or before the join date." />
      </FormGrid>
    </FormDialog>
  );
}
