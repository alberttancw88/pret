'use client';

// L8 · Leave types — S-LV-08 · /leave/setup/types · F-LV-01 · US-LEAVE-001
//   Search code/name · Filters Category · Active · Columns Code › · Name · Category · Paid · Count basis · Entitlement
//   summary · Workflow · Visible to employees · Active ● · ADD NEW LEAVE TYPE · EXPORT .CSV · ⋮ Edit / Deactivate
//   (blocked for the statutory five while anyone is eligible — BR-LV-01).
// L9 · Leave type form — S-LV-09 · /leave/setup/types/{code} · F-LV-01, BR-LV-02 · US-LEAVE-001, 002
//   Cards Identity · Pay & counting · Entitlement · Eligibility · Application rules · Balance · Approval & cancel · Calendar.
//   Save below the Employment Act minimum → blocking dialog (ADM: BACK; SA: override reason → SAVE WITH OVERRIDE, logged).
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import {
  ACCRUAL_METHODS,
  ACCRUAL_METHOD_LABELS,
  ATTACHMENT_RULES,
  ATTACHMENT_RULE_LABELS,
  COUNT_BASES,
  COUNT_BASIS_LABELS,
  ELIGIBLE_GENDERS,
  ELIGIBLE_GENDER_LABELS,
  ELIGIBLE_MARITALS,
  ELIGIBLE_MARITAL_LABELS,
  ENTITLEMENT_METHODS,
  ENTITLEMENT_METHOD_LABELS,
  LEAVE_CATEGORIES,
  LEAVE_CATEGORY_LABELS,
  LEAVE_COLOURS,
  LEAVE_PAYROLL_TREATMENTS,
  LEAVE_PAYROLL_TREATMENT_LABELS,
  NOTICE_BEHAVIOURS,
  NOTICE_BEHAVIOUR_LABELS,
  OCCURRENCE_SCOPES,
  OCCURRENCE_SCOPE_LABELS,
  STATUTORY_CATEGORIES,
  STATUTORY_FLOOR_FIELD,
  type LeaveCategory,
  type LeaveSetupOptions,
  type LeaveTypeDetail,
  type LeaveTypeListParams,
  type LeaveTypeRow,
  type SaveLeaveTypeInput,
} from '@/server/contracts/leave';
import { exportLeaveTypesCsv, saveLeaveType, setLeaveTypeActive } from '@/server/actions/leave';
import ListPage, { type ListColumn } from '../list/ListPage';
import { KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import FormCard from '../forms/FormCard';
import { FormGrid, FullRow, NumberInput, SelectInput, SwitchInput, TextInput } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import ErrorSummary from '../forms/ErrorSummary';
import RecordFooter from '../forms/RecordFooter';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import StatusChip from '../StatusChip';
import { useToast } from '../ToastProvider';
import { formatDateTime } from '@/lib/format';
import { formatDays, optionsFrom } from './common';
import { StatutoryFloorDialog } from './AdjustOverride';
import { LEAVE_TYPE_FILTERS } from './filters';

// ===========================================================================
// L8
// ===========================================================================
export function LeaveTypesList({ rows, total, params }: { rows: LeaveTypeRow[]; total: number; params: LeaveTypeListParams }) {
  const list = useServerList({ filters: LEAVE_TYPE_FILTERS, sort: { key: 'order', direction: 'asc' } });
  const toast = useToast();
  const router = useRouter();
  const r = useActionRunner();
  const [deactivate, setDeactivate] = React.useState<LeaveTypeRow | null>(null);
  const d = list.draft;
  const set = list.setDraftField;
  const href = (x: LeaveTypeRow) => `/leave/setup/types/${encodeURIComponent(x.code)}`;
  const columns: ListColumn<LeaveTypeRow>[] = [
    { key: 'code', header: 'Code', value: (x) => x.code },
    {
      key: 'name',
      header: 'Name',
      value: (x) => x.name,
      render: (x) => (
        <Stack direction="row" spacing={1} alignItems="center">
          <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: x.colour }} />
          <span>{x.name}</span>
        </Stack>
      ),
    },
    { key: 'category', header: 'Category', value: (x) => LEAVE_CATEGORY_LABELS[x.category] },
    { key: 'paid', header: 'Paid', sortable: false, value: (x) => (x.isPaid ? 'Yes' : 'No') },
    { key: 'basis', header: 'Count basis', sortable: false, priority: 'low', value: (x) => COUNT_BASIS_LABELS[x.countBasis] },
    { key: 'ent', header: 'Entitlement summary', sortable: false, value: (x) => x.entitlementSummary },
    { key: 'wf', header: 'Workflow', sortable: false, priority: 'low', value: (x) => x.workflow.label },
    { key: 'vis', header: 'Visible to employees', sortable: false, priority: 'low', value: (x) => (x.visibleToEmployees ? 'Yes' : 'No (HR on behalf only)') },
    { key: 'active', header: 'Active', kind: 'status', sortable: false, value: (x) => (x.isActive ? 'Active' : 'Inactive'), render: (x) => <StatusChip set="active" value={x.isActive ? 'Active' : 'Inactive'} /> },
  ];
  return (
    <>
      <ListPage<LeaveTypeRow>
        itemName={{ singular: 'leave type', plural: 'leave types' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Code or name." />,
          <MultiSelectFilter key="c" label="Category" value={d.categories} onChange={(v) => set('categories', v)} options={optionsFrom(LEAVE_CATEGORY_LABELS)} />,
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
        addNew={{ label: 'Add new leave type', href: '/leave/setup/types/new' }}
        onExport={async () => {
          try {
            const res = await exportLeaveTypesCsv(params);
            if (res.ok) downloadServerCsv(res.filename || 'leave-types', res.content);
            else toast.info(res.error);
          } catch {
            toast.info('Export failed. Please try again.');
          }
        }}
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(x) => x.id}
        getRowHref={href}
        getRowRef={(x) => x.code}
        rowActions={(x) => [
          { label: 'Edit', onClick: () => router.push(href(x)) },
          x.isActive
            ? x.canDeactivate
              ? { label: 'Deactivate', danger: true, onClick: () => setDeactivate(x) }
              : { label: 'Deactivate (blocked — statutory type in use, BR-LV-01)', onClick: () => toast.info('Statutory leave types cannot be deactivated while any employee is eligible (BR-LV-01).') }
            : {
                label: 'Activate',
                onClick: async () => {
                  const res = await r.run(() => setLeaveTypeActive({ id: x.id, isActive: true }), { success: `${x.name} activated.` });
                  if (res && !res.ok) toast.info(res.error);
                },
              },
        ]}
        empty={{ title: 'No leave types configured.' }}
      />
      <ConfirmDialog
        open={Boolean(deactivate)}
        title={`Deactivate ${deactivate?.name ?? ''}?`}
        body="Inactive types cannot be applied for; history is kept."
        confirmLabel="Deactivate"
        destructive
        onClose={() => setDeactivate(null)}
        onConfirm={async () => {
          if (!deactivate) return;
          const res = await r.run(() => setLeaveTypeActive({ id: deactivate.id, isActive: false }), { success: `${deactivate.name} deactivated.` });
          if (res && !res.ok) toast.info(res.error);
          setDeactivate(null);
        }}
      />
    </>
  );
}

// ===========================================================================
// L9
// ===========================================================================
type V = Record<string, string | boolean>;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function defaults(): V {
  return {
    code: '', name: '', category: '', description: '', isPaid: true, countBasis: 'working_days', entitlementMethod: 'annual_banded',
    accrualOverride: 'policy_default', prorateJoinersLeavers: true, eligibleGender: 'all', eligibleMarital: 'any', minServiceMonths: '0',
    availableOnProbation: true, halfDayAllowed: true, reasonRequired: true, attachmentRule: 'not_required', attachmentThresholdDays: '',
    attachmentGraceHours: '0', minNoticeDays: '0', minNoticeBehaviour: 'warn', backdateWorkingDays: '0', maxDaysPerApplication: '',
    maxOccurrences: '', occurrenceScope: '', daysPerOccurrence: '', annualCapDays: '', deductFromTypeId: '', poolWithTypeId: '', poolCapDays: '',
    carryForwardAllowed: false, cfCapOverride: '', cfExpiryMonthsOverride: '', allowNegative: false, maxNegativeDays: '', workflowId: '',
    selfCancelFutureApproved: true, visibleToEmployees: true, calendarColour: LEAVE_COLOURS[0], payrollTreatment: 'paid', displayOrder: '100', isActive: true,
  };
}
function fromDetail(t: LeaveTypeDetail): V {
  const v = t.values as unknown as Record<string, unknown>;
  const out: V = {};
  for (const [k, val] of Object.entries(defaults())) out[k] = typeof val === 'boolean' ? Boolean(v[k] ?? val) : s(v[k]);
  return out;
}

export function LeaveTypeForm({ detail, options, isSuperAdmin }: { detail: LeaveTypeDetail | null; options: LeaveSetupOptions; isSuperAdmin: boolean }) {
  const router = useRouter();
  const r = useActionRunner();
  const [v, setV] = React.useState<V>(() => (detail ? fromDetail(detail) : { ...defaults(), workflowId: options.workflows[0]?.id ?? '' }));
  const [dirty, setDirty] = React.useState(false);
  const [floor, setFloor] = React.useState<string | null>(null);
  const [floorReason, setFloorReason] = React.useState('');
  const set = (k: string, val: string | boolean) => {
    setDirty(true);
    setV((x) => ({ ...x, [k]: val }));
  };
  const str = (k: string) => String(v[k] ?? '');
  const bool = (k: string) => Boolean(v[k]);
  const fe = r.fieldErrors;
  const method = str('entitlementMethod');
  const category = str('category') as LeaveCategory | '';
  const statutory = category !== '' && STATUTORY_CATEGORIES.includes(category);
  const minimums = (detail?.statutoryMinimums ?? options.statutoryMinimums).filter((m) => m.category === category);
  const otherTypes = options.leaveTypes.filter((t) => t.id !== detail?.id).map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }));

  const save = async (withOverride: boolean) => {
    const input: SaveLeaveTypeInput = {
      ...(v as unknown as SaveLeaveTypeInput),
      id: detail?.id ?? null,
      version: detail?.version,
      floorOverrideReason: withOverride ? floorReason.trim() : null,
    };
    const res = await r.run(() => saveLeaveType(input), { success: detail ? 'Leave type saved.' : 'Leave type created.' });
    if (res?.ok) {
      setDirty(false);
      if (!detail || res.code !== detail.values.code) router.replace(`/leave/setup/types/${encodeURIComponent(res.code)}`);
    } else if (res?.fieldErrors?.[STATUTORY_FLOOR_FIELD]) setFloor(res.fieldErrors[STATUTORY_FLOOR_FIELD]);
  };
  const cardSx = { mb: 2 } as const;

  return (
    <Box
      component="form"
      noValidate
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        void save(false);
      }}
    >
      <ErrorSummary error={r.error} fieldErrors={Object.fromEntries(Object.entries(fe).filter(([k]) => k !== STATUTORY_FLOOR_FIELD))} />
      {detail && detail.floorOverrides.length > 0 && (
        <Alert severity="warning" sx={cardSx}>
          Saved below the statutory minimum with Super Admin override:{' '}
          {detail.floorOverrides.map((o) => `${o.detail} — “${o.reason}” (${o.approvedByName}, ${formatDateTime(o.approvedAt)})`).join('; ')}
        </Alert>
      )}
      <Box sx={cardSx}>
        <FormCard title="Identity">
          <FormGrid>
            <TextInput label="Code" required value={str('code')} onChange={(x) => set('code', x.toUpperCase())} maxLength={10} error={fe.code} helper="Uppercase letters and digits, e.g. AL." />
            <TextInput label="Name" required value={str('name')} onChange={(x) => set('name', x)} maxLength={60} error={fe.name} />
            <SelectInput
              label="Statutory category"
              required
              value={str('category')}
              onChange={(x) => set('category', x)}
              options={LEAVE_CATEGORIES.map((c) => ({ value: c, label: LEAVE_CATEGORY_LABELS[c] }))}
              error={fe.category}
              locked={detail?.categoryLocked ? `Locked — used by ${detail.usedByApplications} applications.` : false}
            />
            <NumberInput label="Display order" value={str('displayOrder')} onChange={(x) => set('displayOrder', x)} min={0} max={999} error={fe.displayOrder} />
            <FullRow>
              <TextInput label="Description / policy text" value={str('description')} onChange={(x) => set('description', x)} maxLength={1000} multiline minRows={2} helper="Shown on the apply form when this type is selected." />
            </FullRow>
            <SwitchInput label="Active" checked={bool('isActive')} onChange={(x) => set('isActive', x)} helper={detail && !detail.canDeactivate && bool('isActive') ? 'Statutory type in use — cannot be deactivated (BR-LV-01).' : undefined} locked={detail && !detail.canDeactivate && bool('isActive') ? 'BR-LV-01' : false} />
          </FormGrid>
          {statutory && minimums.length > 0 && (
            <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
              Employment Act minimum for {LEAVE_CATEGORY_LABELS[category as LeaveCategory]}:{' '}
              {minimums.map((m) => `${formatDays(m.minDays)} days (${m.serviceFromYears}${m.serviceToYears ? `–< ${m.serviceToYears}` : '+'} yrs)`).join(' · ')} — {minimums[0]?.legalRef}
            </Alert>
          )}
        </FormCard>
      </Box>
      <Box sx={cardSx}>
        <FormCard title="Pay & counting">
          <FormGrid>
            <SelectInput label="Paid" required value={bool('isPaid') ? 'yes' : 'no'} onChange={(x) => set('isPaid', x === 'yes')} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
            <SelectInput label="Payroll treatment" required value={str('payrollTreatment')} onChange={(x) => set('payrollTreatment', x)} options={optionsFrom(LEAVE_PAYROLL_TREATMENT_LABELS, LEAVE_PAYROLL_TREATMENTS)} error={fe.payrollTreatment} />
            <SelectInput label="Count basis" required value={str('countBasis')} onChange={(x) => set('countBasis', x)} options={optionsFrom(COUNT_BASIS_LABELS, COUNT_BASES)} error={fe.countBasis} />
            <SwitchInput label="Half-day allowed" checked={bool('halfDayAllowed')} onChange={(x) => set('halfDayAllowed', x)} />
          </FormGrid>
        </FormCard>
      </Box>
      <Box sx={cardSx}>
        <FormCard title="Entitlement">
          <FormGrid>
            <SelectInput label="Entitlement method" required value={method} onChange={(x) => set('entitlementMethod', x)} options={optionsFrom(ENTITLEMENT_METHOD_LABELS, ENTITLEMENT_METHODS)} error={fe.entitlementMethod} />
            {method === 'annual_banded' && (
              <SelectInput label="Accrual method override" value={str('accrualOverride')} onChange={(x) => set('accrualOverride', x)} options={optionsFrom(ACCRUAL_METHOD_LABELS, ACCRUAL_METHODS)} />
            )}
            {method === 'annual_banded' && <SwitchInput label="Pro-rate for joiners & leavers" checked={bool('prorateJoinersLeavers')} onChange={(x) => set('prorateJoinersLeavers', x)} helper="Statute gives full Sick/Hospitalisation days — keep off for those (BR-LV-13)." />}
            {method === 'annual_banded' && (
              <Box>
                {detail ? (
                  <Button component={NextLink} href={`/leave/setup/bands?type=${encodeURIComponent(detail.values.code)}`} variant="outlined">
                    Edit entitlement bands
                  </Button>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Save the type first, then edit its entitlement bands.
                  </Typography>
                )}
                {detail?.bandsSummary && (
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    {detail.bandsSummary}
                  </Typography>
                )}
              </Box>
            )}
            {method === 'fixed_per_occurrence' && (
              <NumberInput label="Days per occurrence" required value={str('daysPerOccurrence')} onChange={(x) => set('daysPerOccurrence', x)} step={0.5} min={0.5} error={fe.daysPerOccurrence} />
            )}
            {(method === 'fixed_per_occurrence' || method === 'no_entitlement') && (
              <NumberInput label="Max occurrences" value={str('maxOccurrences')} onChange={(x) => set('maxOccurrences', x)} min={1} max={99} error={fe.maxOccurrences} />
            )}
            {(method === 'fixed_per_occurrence' || method === 'no_entitlement') && str('maxOccurrences') !== '' && (
              <SelectInput label="Occurrences counted" required value={str('occurrenceScope')} onChange={(x) => set('occurrenceScope', x)} options={optionsFrom(OCCURRENCE_SCOPE_LABELS, OCCURRENCE_SCOPES)} error={fe.occurrenceScope} />
            )}
            {method === 'no_entitlement' && (
              <NumberInput label="Annual cap (days)" value={str('annualCapDays')} onChange={(x) => set('annualCapDays', x)} step={0.5} min={0.5} error={fe.annualCapDays} helper="Optional, e.g. Unpaid 12 days a year." />
            )}
            <SelectInput label="Deduct from type" value={str('deductFromTypeId')} onChange={(x) => set('deductFromTypeId', x)} options={otherTypes} emptyLabel="— None —" helper="e.g. Emergency → Annual." />
            <SelectInput label="Aggregate pool with" value={str('poolWithTypeId')} onChange={(x) => set('poolWithTypeId', x)} options={otherTypes} emptyLabel="— None —" helper="e.g. Hospitalisation pooled with Sick." />
            {str('poolWithTypeId') !== '' && (
              <NumberInput label="Pool cap (days)" required value={str('poolCapDays')} onChange={(x) => set('poolCapDays', x)} step={0.5} min={0.5} error={fe.poolCapDays} helper="Hospitalisation + Sick = 60 (BR-LV-31)." />
            )}
          </FormGrid>
        </FormCard>
      </Box>
      <Box sx={cardSx}>
        <FormCard title="Eligibility">
          <FormGrid>
            <SelectInput label="Gender" required value={str('eligibleGender')} onChange={(x) => set('eligibleGender', x)} options={optionsFrom(ELIGIBLE_GENDER_LABELS, ELIGIBLE_GENDERS)} />
            <SelectInput label="Marital status" required value={str('eligibleMarital')} onChange={(x) => set('eligibleMarital', x)} options={optionsFrom(ELIGIBLE_MARITAL_LABELS, ELIGIBLE_MARITALS)} />
            <NumberInput label="Minimum service (months)" required value={str('minServiceMonths')} onChange={(x) => set('minServiceMonths', x)} min={0} max={120} error={fe.minServiceMonths} />
            <SwitchInput label="Available during probation" checked={bool('availableOnProbation')} onChange={(x) => set('availableOnProbation', x)} />
            <SwitchInput label="Visible to employees" checked={bool('visibleToEmployees')} onChange={(x) => set('visibleToEmployees', x)} helper="Hidden types can only be applied by HR on behalf." />
          </FormGrid>
        </FormCard>
      </Box>
      <Box sx={cardSx}>
        <FormCard title="Application rules">
          <FormGrid>
            <SwitchInput label="Reason required" checked={bool('reasonRequired')} onChange={(x) => set('reasonRequired', x)} />
            <SelectInput label="Attachment rule" required value={str('attachmentRule')} onChange={(x) => set('attachmentRule', x)} options={optionsFrom(ATTACHMENT_RULE_LABELS, ATTACHMENT_RULES)} />
            {str('attachmentRule') === 'if_more_than_n_days' && (
              <NumberInput label="Attachment day threshold (N)" required value={str('attachmentThresholdDays')} onChange={(x) => set('attachmentThresholdDays', x)} step={0.5} min={0.5} error={fe.attachmentThresholdDays} />
            )}
            <NumberInput label="Allow attachment after submit (hours)" value={str('attachmentGraceHours')} onChange={(x) => set('attachmentGraceHours', x)} min={0} max={720} helper="0 = must attach at submit; > 0 → “Attachment pending”." error={fe.attachmentGraceHours} />
            <NumberInput label="Minimum advance notice (days)" value={str('minNoticeDays')} onChange={(x) => set('minNoticeDays', x)} min={0} max={365} error={fe.minNoticeDays} />
            <SelectInput label="When notice is short" value={str('minNoticeBehaviour')} onChange={(x) => set('minNoticeBehaviour', x)} options={optionsFrom(NOTICE_BEHAVIOUR_LABELS, NOTICE_BEHAVIOURS)} />
            <NumberInput label="Back-date allowed (working days after last leave day)" required value={str('backdateWorkingDays')} onChange={(x) => set('backdateWorkingDays', x)} min={0} max={60} helper="0 = not allowed. Beyond it only HR on behalf." error={fe.backdateWorkingDays} />
            <NumberInput label="Max days per application" value={str('maxDaysPerApplication')} onChange={(x) => set('maxDaysPerApplication', x)} step={0.5} min={0.5} error={fe.maxDaysPerApplication} />
          </FormGrid>
        </FormCard>
      </Box>
      <Box sx={cardSx}>
        <FormCard title="Balance">
          <FormGrid>
            <SwitchInput label="Carry-forward allowed" checked={bool('carryForwardAllowed')} onChange={(x) => set('carryForwardAllowed', x)} />
            {bool('carryForwardAllowed') && <NumberInput label="Carry-forward cap override (days)" value={str('cfCapOverride')} onChange={(x) => set('cfCapOverride', x)} step={0.5} min={0} helper="Blank = policy default." error={fe.cfCapOverride} />}
            {bool('carryForwardAllowed') && <NumberInput label="Carry-forward expiry override (months)" value={str('cfExpiryMonthsOverride')} onChange={(x) => set('cfExpiryMonthsOverride', x)} min={0} max={24} helper="Blank = policy default." error={fe.cfExpiryMonthsOverride} />}
            <SwitchInput label="Allow negative balance" checked={bool('allowNegative')} onChange={(x) => set('allowNegative', x)} />
            {bool('allowNegative') && <NumberInput label="Max negative days" required value={str('maxNegativeDays')} onChange={(x) => set('maxNegativeDays', x)} step={0.5} min={0.5} max={60} error={fe.maxNegativeDays} />}
          </FormGrid>
        </FormCard>
      </Box>
      <Box sx={cardSx}>
        <FormCard title="Approval & cancel">
          <FormGrid>
            <SelectInput label="Approval workflow" required value={str('workflowId')} onChange={(x) => set('workflowId', x)} options={options.workflows.map((w) => ({ value: w.id, label: w.label }))} error={fe.workflowId} />
            <SwitchInput label="Employee can self-cancel approved future leave" checked={bool('selfCancelFutureApproved')} onChange={(x) => set('selfCancelFutureApproved', x)} />
          </FormGrid>
        </FormCard>
      </Box>
      <Box sx={cardSx}>
        <FormCard title="Calendar">
          <Typography variant="body2" sx={{ mb: 1 }}>
            Colour * <Typography component="span" variant="caption" color="text.secondary">(fixed accessible palette)</Typography>
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap role="radiogroup" aria-label="Calendar colour">
            {LEAVE_COLOURS.map((c) => (
              <Tooltip key={c} title={c}>
                <ButtonBase
                  role="radio"
                  aria-checked={str('calendarColour').toUpperCase() === c}
                  aria-label={`Colour ${c}`}
                  onClick={() => set('calendarColour', c)}
                  sx={{ width: 36, height: 36, borderRadius: '50%', bgcolor: c, border: str('calendarColour').toUpperCase() === c ? '3px solid #1F2433' : '2px solid #fff', boxShadow: '0 0 0 1px #D0D4DC' }}
                >
                  {str('calendarColour').toUpperCase() === c && <CheckIcon sx={{ color: '#fff' }} fontSize="small" />}
                </ButtonBase>
              </Tooltip>
            ))}
          </Stack>
          {fe.calendarColour && (
            <Typography variant="caption" color="error">
              {fe.calendarColour}
            </Typography>
          )}
        </FormCard>
      </Box>
      <Card sx={{ position: 'sticky', bottom: 0, zIndex: 2 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button variant="outlined" color="inherit" component={NextLink} href="/leave/setup/types">
              {dirty ? 'Cancel' : 'Back'}
            </Button>
            <Button type="submit" variant="contained" loading={r.saving}>
              {detail ? 'Save' : 'Create leave type'}
            </Button>
          </Stack>
          {detail && <RecordFooter meta={detail} />}
        </CardContent>
      </Card>
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
    </Box>
  );
}
