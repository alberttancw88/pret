'use client';

// L10 · Entitlement bands — S-LV-10 · /leave/setup/bands?type=AL&year= · F-LV-02 · US-LEAVE-003
// L11 · Leave policy settings — S-LV-11 · /leave/setup/policy · F-LV-03, F-LV-33, F-LV-34 · US-LEAVE-004, 038, 039
// L12 · Approval workflows — S-LV-12 · /leave/setup/workflows · F-LV-32 · US-LEAVE-037
import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LockIcon from '@mui/icons-material/Lock';
import {
  LEAVE_ROUNDINGS,
  LEAVE_ROUNDING_LABELS,
  PRORATE_BASES,
  PRORATE_BASIS_LABELS,
  STATUTORY_FLOOR_FIELD,
  TEAM_CALENDAR_VISIBILITIES,
  TEAM_CALENDAR_VISIBILITY_LABELS,
  type LeaveBandSet,
  type LeavePolicy,
  type LeaveSetupOptions,
  type StatutoryMinimum,
  type UpdateLeavePolicyInput,
  type WorkflowListParams,
  type WorkflowRow,
} from '@/server/contracts/leave';
import { APPROVER_SOURCE_LABELS, WORKFLOW_APPROVER_SOURCES, type WorkflowApproverSource } from '@/server/contracts/approvals';
import { exportWorkflowsCsv, previewWorkflow, recomputeEntitlements, saveLeaveBands, saveWorkflow, updateLeavePolicy } from '@/server/actions/leave';
import ListPage, { type ListColumn } from '../list/ListPage';
import { KeywordField, SelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import FormCard from '../forms/FormCard';
import FormDialog from '../forms/FormDialog';
import { FormGrid, FullRow, MultiSelectInput, NumberInput, SelectInput, SwitchInput, TextInput } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import ErrorSummary from '../forms/ErrorSummary';
import RecordFooter from '../forms/RecordFooter';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import StatusChip from '../StatusChip';
import { useToast } from '../ToastProvider';
import EmployeePicker, { type PickedEmployee } from '../employees/EmployeePicker';
import { formatDays, optionsFrom } from './common';
import { StatutoryFloorDialog } from './AdjustOverride';
import { WORKFLOW_FILTERS } from './filters';

// ===========================================================================
// L10
// ===========================================================================
type BandDraft = { key: string; serviceFromYears: string; serviceToYears: string; daysPerYear: string; gradeId: string };
let seq = 0;
const nextKey = () => `b${++seq}`;

function statMinFor(mins: StatutoryMinimum[], from: string): string | null {
  const f = Number(from);
  if (!Number.isFinite(f)) return null;
  const m = mins.find((x) => Number(x.serviceFromYears) <= f && (x.serviceToYears === null || f < Number(x.serviceToYears)));
  return m ? m.minDays : null;
}

export function BandsEditor({ set, options, isSuperAdmin }: { set: LeaveBandSet; options: LeaveSetupOptions; isSuperAdmin: boolean }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const r = useActionRunner();
  const toast = useToast();
  const toDraft = (s: LeaveBandSet): BandDraft[] =>
    s.rows.map((x) => ({ key: nextKey(), serviceFromYears: x.serviceFromYears, serviceToYears: x.serviceToYears ?? '', daysPerYear: x.daysPerYear, gradeId: x.grade?.id ?? '' }));
  const [rows, setRows] = React.useState<BandDraft[]>(() => toDraft(set));
  const [year, setYear] = React.useState(set.effectiveYear);
  const [dirty, setDirty] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [floor, setFloor] = React.useState<string | null>(null);
  const [floorReason, setFloorReason] = React.useState('');
  const mins = set.statutoryMinimums.filter((m) => m.category === set.leaveType.category);
  const banded = options.leaveTypes.filter((t) => t.entitlementMethod === 'annual_banded');
  const years = Array.from(new Set([...set.years, year])).sort((a, b) => b - a);
  const upd = (key: string, p: Partial<BandDraft>) => {
    setDirty(true);
    setRows((x) => x.map((b) => (b.key === key ? { ...b, ...p } : b)));
  };
  const go = (type: string, y?: number) => router.replace(`${pathname}?type=${encodeURIComponent(type)}${y ? `&year=${y}` : ''}`);

  const save = async (withOverride: boolean) => {
    const res = await r.run(
      () =>
        saveLeaveBands({
          leaveTypeId: set.leaveType.id,
          effectiveYear: year,
          rows: rows.map((b) => ({ serviceFromYears: b.serviceFromYears, serviceToYears: b.serviceToYears === '' ? null : b.serviceToYears, daysPerYear: b.daysPerYear, gradeId: b.gradeId || null })),
          floorOverrideReason: withOverride ? floorReason.trim() : null,
        }),
      { success: (x) => `Bands saved. Entitlements recomputed for ${(x as unknown as { recomputedEmployees: number }).recomputedEmployees} employees.` },
    );
    setConfirm(false);
    if (res?.ok) {
      setDirty(false);
      if (year !== set.effectiveYear) go(set.leaveType.code, year);
    } else if (res?.fieldErrors?.[STATUTORY_FLOOR_FIELD]) setFloor(res.fieldErrors[STATUTORY_FLOOR_FIELD]);
  };
  const rowErr = (i: number, f: string) => r.fieldErrors[`rows.${i}.${f}`];

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <TextField select size="small" label="Leave type" value={set.leaveType.code} onChange={(e) => go(e.target.value)} sx={{ minWidth: 220 }}>
              {banded.map((t) => (
                <MenuItem key={t.id} value={t.code}>
                  {t.name} ({t.code})
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="Effective leave year" value={String(year)} onChange={(e) => go(set.leaveType.code, Number(e.target.value))} sx={{ minWidth: 180 }}>
              {years.map((y) => (
                <MenuItem key={y} value={String(y)}>
                  {y}
                </MenuItem>
              ))}
            </TextField>
            <Box sx={{ flex: 1 }} />
            <Button
              variant="outlined"
              onClick={() => {
                const ny = Math.max(...years) + 1;
                setYear(ny);
                setRows((x) => x.map((b) => ({ ...b, key: nextKey() })));
                setDirty(true);
                toast.info(`Copied the ${set.effectiveYear} bands into a new ${ny} version — review and SAVE BANDS.`);
              }}
            >
              New version for {Math.max(...years) + 1}
            </Button>
          </Stack>
        </CardContent>
      </Card>
      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <ErrorSummary error={r.error} fieldErrors={Object.fromEntries(Object.entries(r.fieldErrors).filter(([k]) => k !== STATUTORY_FLOOR_FIELD))} />
          <TableContainer>
            <Table size="small" aria-label="Entitlement bands" sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Service from (years, ≥) *</TableCell>
                  <TableCell>Service to (years, &lt;)</TableCell>
                  <TableCell>Days per year *</TableCell>
                  <TableCell>
                    Statutory minimum <LockIcon sx={{ fontSize: 14, verticalAlign: 'middle' }} />
                  </TableCell>
                  <TableCell>Grade override</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((b, i) => {
                  const min = statMinFor(mins, b.serviceFromYears);
                  const below = min !== null && b.daysPerYear !== '' && Number(b.daysPerYear) < Number(min);
                  return (
                    <TableRow key={b.key}>
                      <TableCell>
                        <TextField size="small" type="number" value={b.serviceFromYears} onChange={(e) => upd(b.key, { serviceFromYears: e.target.value })} slotProps={{ htmlInput: { step: 0.5, min: 0, 'aria-label': `Row ${i + 1} service from` } }} error={Boolean(rowErr(i, 'serviceFromYears'))} helperText={rowErr(i, 'serviceFromYears')} />
                      </TableCell>
                      <TableCell>
                        <TextField size="small" type="number" placeholder="no upper" value={b.serviceToYears} onChange={(e) => upd(b.key, { serviceToYears: e.target.value })} slotProps={{ htmlInput: { step: 0.5, min: 0.5, 'aria-label': `Row ${i + 1} service to` } }} error={Boolean(rowErr(i, 'serviceToYears'))} helperText={rowErr(i, 'serviceToYears')} />
                      </TableCell>
                      <TableCell>
                        <TextField size="small" type="number" value={b.daysPerYear} onChange={(e) => upd(b.key, { daysPerYear: e.target.value })} slotProps={{ htmlInput: { step: 0.5, min: 0, 'aria-label': `Row ${i + 1} days per year` } }} error={below || Boolean(rowErr(i, 'daysPerYear'))} helperText={below ? 'Below minimum' : rowErr(i, 'daysPerYear')} />
                      </TableCell>
                      <TableCell className="pret-tnum">{min !== null ? formatDays(min) : '—'}</TableCell>
                      <TableCell>
                        <TextField select size="small" value={b.gradeId} onChange={(e) => upd(b.key, { gradeId: e.target.value })} sx={{ minWidth: 140 }} slotProps={{ htmlInput: { 'aria-label': `Row ${i + 1} grade` } }}>
                          <MenuItem value="">All grades</MenuItem>
                          {options.grades.map((g) => (
                            <MenuItem key={g.id} value={g.id}>
                              {g.label}
                            </MenuItem>
                          ))}
                        </TextField>
                      </TableCell>
                      <TableCell align="right">
                        <IconButton aria-label={`Delete row ${i + 1}`} onClick={() => (setDirty(true), setRows((x) => x.filter((y) => y.key !== b.key)))}>
                          <DeleteOutlineIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            Bands must run from 0 years with no gaps; the last band is open-ended. Grade rows win over the general row for that grade.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
            <Button startIcon={<AddIcon />} onClick={() => (setDirty(true), setRows((x) => [...x, { key: nextKey(), serviceFromYears: x.length ? x[x.length - 1]!.serviceToYears || '' : '0', serviceToYears: '', daysPerYear: '', gradeId: '' }]))}>
              Add band
            </Button>
            <Button startIcon={<AddIcon />} onClick={() => (setDirty(true), setRows((x) => [...x, { key: nextKey(), serviceFromYears: '0', serviceToYears: '', daysPerYear: '', gradeId: options.grades[0]?.id ?? '' }]))}>
              Add grade row
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" disabled={!dirty} onClick={() => setConfirm(true)} loading={r.saving}>
              Save bands
            </Button>
          </Stack>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirm}
        title="Save bands?"
        body={`Entitlements for ${set.employeesAffected} employees will be recomputed.`}
        confirmLabel="Save bands"
        onClose={() => setConfirm(false)}
        onConfirm={() => save(false)}
      />
      <StatutoryFloorDialog
        message={floor}
        isSuperAdmin={isSuperAdmin}
        reason={floorReason}
        onReason={setFloorReason}
        saving={r.saving}
        onClose={() => setFloor(null)}
        onOverride={async () => {
          setFloor(null);
          await save(true);
        }}
      />
    </Stack>
  );
}

// ===========================================================================
// L11
// ===========================================================================
export function PolicyForm({ policy, options }: { policy: LeavePolicy; options: LeaveSetupOptions }) {
  const r = useActionRunner();
  const rr = useActionRunner();
  const toast = useToast();
  type P = Omit<UpdateLeavePolicyInput, 'version'>;
  const init = (): Record<string, unknown> => ({ ...policy });
  const [v, setV] = React.useState<Record<string, unknown>>(init);
  const [dirty, setDirty] = React.useState(false);
  const [ask, setAsk] = React.useState(false);
  const set = (k: keyof P, val: unknown) => {
    setDirty(true);
    setV((x) => ({ ...x, [k]: val }));
  };
  const str = (k: keyof P) => (v[k] === null || v[k] === undefined ? '' : String(v[k]));
  const bool = (k: keyof P) => Boolean(v[k]);
  const fe = r.fieldErrors;
  const kak = (t: string) => (
    <Typography component="span" variant="caption" color="text.secondary">
      {' '}
      · Kakitangan setting: {t}
    </Typography>
  );

  const save = async () => {
    const input = { ...(v as unknown as UpdateLeavePolicyInput), version: policy.version } as UpdateLeavePolicyInput;
    const res = await r.run(() => updateLeavePolicy(input), { success: 'Policy saved. Changes apply to new calculations; existing approved leave is not recounted unless stated.' });
    if (res?.ok) {
      setDirty(false);
      if (res.replacementHolidaysRegenerated.length) toast.info(`Replacement holidays regenerated for ${res.replacementHolidaysRegenerated.join(', ')}.`);
      if (res.recomputeSuggested) setAsk(true);
    }
  };

  return (
    <Box
      component="form"
      noValidate
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        void save();
      }}
    >
      <ErrorSummary error={r.error} fieldErrors={fe} />
      <Stack spacing={2}>
        <FormCard title="Leave year & entitlement">
          <FormGrid>
            <TextInput label="Leave year start" value="01/01" onChange={() => undefined} locked="Calendar year only in Phase 1." />
            <SelectInput
              label="Entitlement method (Annual)"
              required
              value={str('entitlementMethod')}
              onChange={(x) => set('entitlementMethod', x)}
              options={[
                { value: 'accrual_pro_rata', label: 'Accrual on pro-rata basis' },
                { value: 'full_pro_rated', label: 'Full entitlement pro-rated' },
                { value: 'accrual_first_year_then_full', label: 'Accrual in first year, then full' },
              ]}
              helper={kak('accrual on pro-rata basis')}
            />
            <SelectInput label="Pro-rata basis" required value={str('prorateBasis')} onChange={(x) => set('prorateBasis', x)} options={optionsFrom(PRORATE_BASIS_LABELS, PRORATE_BASES)} helper={kak('by day')} />
            <SelectInput label="Rounding" required value={str('rounding')} onChange={(x) => set('rounding', x)} options={optionsFrom(LEAVE_ROUNDING_LABELS, LEAVE_ROUNDINGS)} helper={kak('round up to nearest half day')} />
            <FullRow>
              <SwitchInput label="Employment-Act floor for joiner / leaver entitlements" checked={bool('eaFloorForJoinersLeavers')} onChange={(x) => set('eaFloorForJoinersLeavers', x)} helper="The pro-rated entitlement is never below the EA rule by completed months." />
            </FullRow>
          </FormGrid>
        </FormCard>
        <FormCard title="Carry-forward">
          <FormGrid>
            <NumberInput label="Cap (days)" required value={str('carryForwardCapDays')} onChange={(x) => set('carryForwardCapDays', x)} step={0.5} min={0} error={fe.carryForwardCapDays} helper={<>0 = no carry-forward{kak('10')}</>} />
            <NumberInput label="Expiry (months after year end)" required value={str('carryForwardExpiryMonths')} onChange={(x) => set('carryForwardExpiryMonths', x)} min={0} max={12} error={fe.carryForwardExpiryMonths} helper={`${policy.carryForwardExpiryLabel} · 0 = no expiry`} />
          </FormGrid>
        </FormCard>
        <FormCard title="Next year">
          <FormGrid>
            <SwitchInput label="Allow applying against next year's balance" checked={bool('allowNextYearApplications')} onChange={(x) => set('allowNextYearApplications', x)} helper="Uses next year's projected entitlement (F-LV-33)." />
            <TextInput label="From date (dd/mm)" required value={str('nextYearFromDdmm')} onChange={(x) => set('nextYearFromDdmm', x)} maxLength={5} error={fe.nextYearFromDdmm} helper="e.g. 01/11" />
          </FormGrid>
        </FormCard>
        <FormCard title="Application form">
          <FormGrid>
            <FullRow>
              <TextInput label="Form message" value={str('formMessage')} onChange={(x) => set('formMessage', x)} maxLength={500} multiline minRows={2} helper="Shown at the top of the apply form (F-LV-34)." />
            </FullRow>
            {str('formMessage') && (
              <FullRow>
                <Alert severity="info">Preview: {str('formMessage')}</Alert>
              </FullRow>
            )}
            <NumberInput label="Emergency threshold (days)" required value={str('emergencyThresholdDays')} onChange={(x) => set('emergencyThresholdDays', x)} min={0} max={30} error={fe.emergencyThresholdDays} helper={<>Submitted fewer than N days before start, or back-dated, is flagged EMERGENCY{kak('3')}</>} />
            <MultiSelectInput
              label="Emergency flag applies to types"
              value={(v.emergencyLeaveTypeIds as string[]) ?? []}
              onChange={(x) => set('emergencyLeaveTypeIds', x)}
              options={options.leaveTypes.map((t) => ({ value: t.id, label: t.name }))}
            />
          </FormGrid>
        </FormCard>
        <FormCard title="Visibility & notices">
          <FormGrid>
            <SelectInput label="Team calendar visibility" required value={str('teamCalendarVisibility')} onChange={(x) => set('teamCalendarVisibility', x)} options={optionsFrom(TEAM_CALENDAR_VISIBILITY_LABELS, TEAM_CALENDAR_VISIBILITIES)} />
            <NumberInput label="Team absence warning threshold" required value={str('teamAbsenceThreshold')} onChange={(x) => set('teamAbsenceThreshold', x)} min={0} max={50} error={fe.teamAbsenceThreshold} helper="Approver sees “⚠ n of m team members away” at or above this many (0 = off)." />
            <SwitchInput label="Notify employee & manager when an admin withdraws / cancels leave" checked={bool('notifyOnAdminWithdraw')} onChange={(x) => set('notifyOnAdminWithdraw', x)} />
            <SwitchInput label="Include separated employees in leave reports" checked={bool('includeSeparatedInReports')} onChange={(x) => set('includeSeparatedInReports', x)} />
            <SwitchInput label="Cancellation requests go to the level-1 approver only" checked={bool('cancellationApproverLevel1Only')} onChange={(x) => set('cancellationApproverLevel1Only', x)} />
          </FormGrid>
        </FormCard>
        <FormCard title="Reminders">
          <FormGrid>
            <NumberInput label="Reminder after (working days)" required value={str('reminderAfterWorkingDays')} onChange={(x) => set('reminderAfterWorkingDays', x)} min={0} max={30} error={fe.reminderAfterWorkingDays} helper="0 = off" />
            <NumberInput label="Escalate after (working days)" required value={str('escalateAfterWorkingDays')} onChange={(x) => set('escalateAfterWorkingDays', x)} min={0} max={60} error={fe.escalateAfterWorkingDays} helper="To the approver's manager and HR; 0 = off" />
          </FormGrid>
        </FormCard>
        <FormCard title="Replacement leave">
          <FormGrid>
            <NumberInput label="Credit validity (days after date worked)" required value={str('replacementCreditValidityDays')} onChange={(x) => set('replacementCreditValidityDays', x)} min={0} max={365} error={fe.replacementCreditValidityDays} helper="0 = until the year-end carry-forward expiry" />
            <NumberInput label="Credit request window (days back)" required value={str('replacementWorkedLookbackDays')} onChange={(x) => set('replacementWorkedLookbackDays', x)} min={0} max={365} error={fe.replacementWorkedLookbackDays} />
            <SwitchInput label="Replacement credits carry forward at year end" checked={bool('replacementCreditsCarryForward')} onChange={(x) => set('replacementCreditsCarryForward', x)} />
            <SwitchInput label="Replacement holiday for a public holiday on an off day" checked={bool('replacementForPhOnOffDay')} onChange={(x) => set('replacementForPhOnOffDay', x)} helper="A public holiday on a rest day always gives a replacement. Changing this regenerates replacement holidays." />
            <NumberInput label="Paternity window after birth (days)" required value={str('paternityWindowDaysAfterBirth')} onChange={(x) => set('paternityWindowDaysAfterBirth', x)} min={0} max={365} error={fe.paternityWindowDaysAfterBirth} />
          </FormGrid>
        </FormCard>
        <Card sx={{ position: 'sticky', bottom: 0, zIndex: 2 }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
              <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto' }}>
                Changes apply to new calculations; existing approved leave is not recounted unless stated.
              </Typography>
              <Button type="submit" variant="contained" disabled={!dirty} loading={r.saving}>
                Save policy
              </Button>
            </Stack>
            <RecordFooter meta={policy} />
          </CardContent>
        </Card>
      </Stack>
      <ConfirmDialog
        open={ask}
        title="Recompute entitlements now?"
        body={`Entitlement settings changed. Recompute ${options.currentYear} entitlements for all employees now, or later from Year-end roll-over → REGENERATE ENTITLEMENTS.`}
        confirmLabel="Recompute"
        cancelLabel="Later"
        onClose={() => setAsk(false)}
        onConfirm={async () => {
          const res = await rr.run(() => recomputeEntitlements({ year: options.currentYear }), {
            success: (x) => `Recomputed ${(x as unknown as { employees: number }).employees} employees (${(x as unknown as { changed: number }).changed} changed).`,
          });
          if (res && !res.ok) toast.info(res.error);
          setAsk(false);
        }}
      />
    </Box>
  );
}

// ===========================================================================
// L12
// ===========================================================================
export function WorkflowsList({ rows, total, params }: { rows: WorkflowRow[]; total: number; params: WorkflowListParams }) {
  const list = useServerList({ filters: WORKFLOW_FILTERS, sort: { key: 'name', direction: 'asc' } });
  const toast = useToast();
  const [form, setForm] = React.useState<{ row: WorkflowRow | null } | null>(null);
  const d = list.draft;
  const set = list.setDraftField;
  const columns: ListColumn<WorkflowRow>[] = [
    { key: 'name', header: 'Name', value: (r) => r.name },
    { key: 'levels', header: 'Levels', sortable: false, value: (r) => r.levelsLabel },
    { key: 'used', header: 'Used by types', sortable: false, value: (r) => (r.usedBy.length ? `${r.usedBy.length}: ${r.usedBy.map((t) => t.code).join(', ')}` : '—') },
    { key: 'active', header: 'Active', kind: 'status', sortable: false, value: (r) => (r.isActive ? 'Active' : 'Inactive'), render: (r) => <StatusChip set="active" value={r.isActive ? 'Active' : 'Inactive'} /> },
  ];
  return (
    <>
      <ListPage<WorkflowRow>
        itemName={{ singular: 'workflow', plural: 'approval workflows' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Name." />,
          <SelectFilter
            key="a"
            label="Active"
            value={d.active}
            onChange={(v) => set('active', v || 'all')}
            options={[
              { value: 'all', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />,
        ]}
        {...list.listProps}
        addNew={{ label: 'Add workflow', onClick: () => setForm({ row: null }) }}
        onExport={async () => {
          try {
            const res = await exportWorkflowsCsv(params);
            if (res.ok) downloadServerCsv(res.filename || 'approval-workflows', res.content);
            else toast.info(res.error);
          } catch {
            toast.info('Export failed. Please try again.');
          }
        }}
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(r) => r.id}
        getRowRef={(r) => r.name}
        rowActions={(r) => [{ label: 'Edit', onClick: () => setForm({ row: r }) }]}
        empty={{ title: 'No approval workflows yet.' }}
      />
      <WorkflowDialog open={form !== null} row={form?.row ?? null} onClose={() => setForm(null)} />
    </>
  );
}

type LevelDraft = { source: WorkflowApproverSource | ''; employee: PickedEmployee | null };

function WorkflowDialog({ open, row, onClose }: { open: boolean; row: WorkflowRow | null; onClose: () => void }) {
  const r = useActionRunner();
  const [name, setName] = React.useState('');
  const [levels, setLevels] = React.useState<LevelDraft[]>([{ source: 'direct_manager', employee: null }]);
  const [skip, setSkip] = React.useState(true);
  const [merge, setMerge] = React.useState(true);
  const [active, setActive] = React.useState(true);
  const [example, setExample] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setName(row?.name ?? '');
      setLevels(
        row
          ? row.levels.map((l) => ({
              source: (WORKFLOW_APPROVER_SOURCES as readonly string[]).includes(l.source) ? (l.source as WorkflowApproverSource) : '',
              employee: l.specificEmployee ? { id: l.specificEmployee.id, employeeNo: l.specificEmployee.employeeNo ?? '', name: l.specificEmployee.name } : null,
            }))
          : [
              { source: 'direct_manager', employee: null },
              { source: 'admin_pool', employee: null },
            ],
      );
      setSkip(row?.skipIfApproverIsApplicant ?? true);
      setMerge(row?.mergeConsecutiveIdentical ?? true);
      setActive(row?.isActive ?? true);
      setDirty(false);
      r.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const payloadLevels = levels.filter((l) => l.source).map((l) => ({ source: l.source as WorkflowApproverSource, specificEmployeeId: l.source === 'specific_employee' ? l.employee?.id ?? null : null }));
  const levelsKey = JSON.stringify(payloadLevels);
  React.useEffect(() => {
    if (!open || payloadLevels.length === 0) {
      setExample(null);
      return;
    }
    let alive = true;
    const t = window.setTimeout(async () => {
      try {
        const res = await previewWorkflow({ levels: payloadLevels });
        if (alive) setExample(res.ok ? res.example : null);
      } catch {
        if (alive) setExample(null);
      }
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, levelsKey]);
  const upd = (i: number, p: Partial<LevelDraft>) => {
    setDirty(true);
    setLevels((x) => x.map((l, j) => (j === i ? { ...l, ...p } : l)));
  };
  return (
    <FormDialog
      open={open}
      title={row ? `Edit workflow — ${row.name}` : 'Add approval workflow'}
      onClose={onClose}
      saving={r.saving}
      dirty={dirty}
      error={r.error}
      fieldErrors={r.fieldErrors}
      meta={row}
      onSubmit={async () => {
        const res = await r.run(
          () => saveWorkflow({ id: row?.id ?? null, name, levels: payloadLevels, skipIfApproverIsApplicant: skip, mergeConsecutiveIdentical: merge, isActive: active }),
          { success: row ? 'Workflow saved.' : 'Workflow created.' },
        );
        if (res?.ok) onClose();
      }}
    >
      <Stack spacing={2}>
        <TextInput label="Name" required value={name} onChange={(x) => (setDirty(true), setName(x))} maxLength={80} error={r.fieldErrors.name} />
        {levels.map((l, i) => (
          <Card key={i} variant="outlined">
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Typography variant="subtitle2">Level {i + 1}</Typography>
                <Box sx={{ flex: 1 }} />
                {levels.length > 1 && (
                  <Button size="small" color="error" onClick={() => (setDirty(true), setLevels((x) => x.filter((_y, j) => j !== i)))}>
                    Remove
                  </Button>
                )}
              </Stack>
              <Stack spacing={1.5}>
                <SelectInput
                  label="Approver source"
                  required
                  value={l.source}
                  onChange={(x) => upd(i, { source: x as WorkflowApproverSource })}
                  options={WORKFLOW_APPROVER_SOURCES.map((s) => ({ value: s, label: APPROVER_SOURCE_LABELS[s] }))}
                  error={r.fieldErrors[`levels.${i}.source`]}
                />
                {l.source === 'specific_employee' && (
                  <EmployeePicker label="Employee" required value={l.employee} onChange={(x) => upd(i, { employee: x })} error={r.fieldErrors[`levels.${i}.specificEmployeeId`]} />
                )}
              </Stack>
            </CardContent>
          </Card>
        ))}
        {levels.length < 3 && (
          <Button startIcon={<AddIcon />} onClick={() => (setDirty(true), setLevels((x) => [...x, { source: '', employee: null }]))} sx={{ alignSelf: 'flex-start' }}>
            Add level
          </Button>
        )}
        {r.fieldErrors.levels && (
          <Typography variant="caption" color="error">
            {r.fieldErrors.levels}
          </Typography>
        )}
        <SwitchInput label="Skip level if approver = applicant" checked={skip} onChange={(x) => (setDirty(true), setSkip(x))} />
        <SwitchInput label="Auto-merge consecutive identical approvers" checked={merge} onChange={(x) => (setDirty(true), setMerge(x))} />
        <SwitchInput
          label="Active"
          checked={active}
          onChange={(x) => (setDirty(true), setActive(x))}
          locked={row && !row.canDeactivate && active ? 'Assigned to an active leave type' : false}
          helper={row && !row.canDeactivate ? `Used by: ${row.usedBy.map((t) => t.name).join(', ')} — cannot deactivate while assigned to an active type.` : undefined}
        />
        {example && (
          <Alert severity="info" variant="outlined">
            {example}
          </Alert>
        )}
      </Stack>
    </FormDialog>
  );
}
