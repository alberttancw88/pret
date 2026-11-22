'use client';

// C5 · Claim categories — S-CL-05 · /claims/setup/categories · F-CLM-01 · US-CLAIM-001, 002
// C6 · Claim category form — S-CL-06 · /claims/setup/categories/{code} · F-CLM-01/02 · US-CLAIM-001, 003 (Details · Limits · History)
// C7 · Claim limits — S-CL-07 · /claims/setup/limits · F-CLM-02 · US-CLAIM-003 (+ limit dialog, End)
// C8 · Claims settings — S-CL-08 · /claims/setup/settings · F-CLM-03 · US-CLAIM-004 (SA-only batch-approval toggle 🔒)
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  CAPTURE_MODE_LABELS,
  CAPTURE_MODES,
  CLAIM_EXTRA_FIELD_LABELS,
  CLAIM_EXTRA_FIELDS,
  CLAIM_GROUP_LABELS,
  CLAIM_GROUPS,
  CLAIMANT_SCOPE_LABELS,
  CLAIMANT_SCOPES,
  LIMIT_APPLIES_TO,
  LIMIT_APPLIES_TO_LABELS,
  LIMIT_BEHAVIOUR_LABELS,
  LIMIT_BEHAVIOURS,
  LIMIT_PRECEDENCE_NOTE,
  TAX_TREATMENT_LABELS,
  TAX_TREATMENTS,
  type CaptureMode,
  type CategoryDetail,
  type ClaimGroup,
  type ClaimantScope,
  type TaxTreatment,
  type CategoryListParams,
  type CategoryRef,
  type CategoryRow,
  type ClaimExtraField,
  type ClaimPolicy,
  type ClaimSetupOptions,
  type LimitListParams,
  type LimitRow,
} from '@/server/contracts/claims';
import {
  endLimit,
  exportCategoriesCsv,
  exportLimitsCsv,
  saveCategory,
  saveLimit,
  setCategoryActive,
  updateClaimPolicy,
} from '@/server/actions/claims';
import ListPage, { type ListColumn } from '../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import { useToast } from '../ToastProvider';
import StatusChip from '../StatusChip';
import FormCard from '../forms/FormCard';
import FormDialog from '../forms/FormDialog';
import ErrorSummary from '../forms/ErrorSummary';
import RecordFooter from '../forms/RecordFooter';
import { useActionRunner } from '../forms/useActionRunner';
import { DateInput, FormGrid, FullRow, MultiSelectInput, NumberInput, SelectInput, SwitchInput, TextInput, type Option } from '../forms/fields';
import { MiniTable, ProfileTabs, useTabParam } from '../employees/ui';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import { formatAmount, formatDate, formatDateTime, formatRatePerKm, todayMyt } from '@/lib/format';
import { ClaimEmployeePicker, MoneyCell } from './common';
import { CATEGORY_FILTERS, LIMIT_FILTERS } from './filters';
import type { PickedPerson } from '../leave/pickers';

const opts = <K extends string>(labels: Record<K, string>, keys: readonly K[]): Option[] => keys.map((k) => ({ value: k, label: labels[k] }));
const yn = (b: boolean) => (b ? 'Yes' : 'No');

// =============================================================================================
// C5 categories list
// =============================================================================================
export function CategoriesList({ rows, total, params }: { rows: CategoryRow[]; total: number; params: CategoryListParams }) {
  const router = useRouter();
  const toast = useToast();
  const list = useServerList({ filters: CATEGORY_FILTERS, sort: { key: 'order', direction: 'asc' } });
  const [target, setTarget] = React.useState<CategoryRow | null>(null);
  const d = list.draft;
  const set = list.setDraftField;
  const columns: ListColumn<CategoryRow>[] = [
    { key: 'code', header: 'Code', value: (r) => r.code },
    { key: 'name', header: 'Name', value: (r) => r.name },
    { key: 'group', header: 'Group', value: (r) => CLAIM_GROUP_LABELS[r.group] },
    { key: 'receipt', header: 'Receipt required', sortable: false, priority: 'low', value: (r) => yn(r.receiptRequired) },
    { key: 'rate', header: 'Mileage rate (RM/km)', sortable: false, priority: 'low', value: (r) => (r.isMileage ? formatRatePerKm(r.mileageRate) : '') },
    { key: 'limits', header: 'Limits summary', sortable: false, value: (r) => r.limitsSummary },
    { key: 'tax', header: 'Tax treatment', sortable: false, priority: 'low', hideOnCard: true, value: (r) => TAX_TREATMENT_LABELS[r.taxTreatment] },
    { key: 'gl', header: 'GL account', sortable: false, priority: 'low', hideOnCard: true, value: (r) => r.glAccountCode },
    { key: 'active', header: 'Active', kind: 'status', sortable: false, value: (r) => (r.isActive ? 'Active' : 'Inactive'), render: (r) => <StatusChip set="active" value={r.isActive ? 'Active' : 'Inactive'} /> },
  ];
  return (
    <>
      <ListPage<CategoryRow>
        itemName={{ singular: 'category', plural: 'claim categories' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Code or name." />,
          <MultiSelectFilter key="g" label="Group" value={d.groups} onChange={(v) => set('groups', v)} options={opts(CLAIM_GROUP_LABELS, CLAIM_GROUPS)} />,
          <SelectFilter key="a" label="Active" value={d.active === 'all' ? '' : d.active} onChange={(v) => set('active', v || 'all')} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />,
          <MultiSelectFilter key="t" label="Tax treatment" value={d.taxTreatments} onChange={(v) => set('taxTreatments', v)} options={opts(TAX_TREATMENT_LABELS, TAX_TREATMENTS)} />,
        ]}
        {...list.listProps}
        addNew={{ label: 'Add new category', href: '/claims/setup/categories/new' }}
        extraActions={
          <Button variant="outlined" component={NextLink} href="/claims/setup/limits">
            Limits
          </Button>
        }
        onExport={async () => {
          const res = await exportCategoriesCsv(params);
          if (res.ok) downloadServerCsv(res.filename || 'claim-categories', res.content);
          else toast.info(res.error);
        }}
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/claims/setup/categories/${encodeURIComponent(r.code)}`}
        getRowRef={(r) => r.code}
        rowActions={(r) => [
          { label: 'Edit', onClick: () => router.push(`/claims/setup/categories/${encodeURIComponent(r.code)}`) },
          { label: r.isActive ? 'Deactivate' : 'Activate', danger: r.isActive, onClick: () => setTarget(r) },
        ]}
        empty={{ title: 'No claim categories configured.' }}
      />
      <ConfirmDialog
        open={Boolean(target)}
        title={target?.isActive ? `Deactivate ${target?.name}?` : `Activate ${target?.name}?`}
        body={target?.isActive ? 'Pending claims with this category continue; new lines cannot use it.' : 'The category becomes available on new claim lines.'}
        confirmLabel={target?.isActive ? 'Deactivate' : 'Activate'}
        destructive={target?.isActive}
        onClose={() => setTarget(null)}
        onConfirm={async () => {
          if (!target) return;
          const res = await setCategoryActive({ id: target.id, isActive: !target.isActive });
          if (res.ok) {
            toast.success(target.isActive ? 'Category deactivated.' : 'Category activated.');
            setTarget(null);
            router.refresh();
          } else toast.info(res.error);
        }}
      />
    </>
  );
}

// =============================================================================================
// C6 category form
// =============================================================================================
type CatForm = {
  code: string; name: string; group: string; description: string; displayOrder: string; isActive: boolean;
  receiptRequired: boolean; notesRequired: boolean; receiptNoMode: string; myinvoisUuidMode: string; captureSst: boolean; extraFields: ClaimExtraField[];
  isMileage: boolean; mileageRate: string; mileageRateFrom: string;
  claimantScope: string; minServiceMonths: string; eligibleStatuses: string[]; gradeIds: string[];
  taxTreatment: string; eaFormLine: string; glAccountCode: string;
};
const STATUS_OPTS: Option[] = [
  { value: 'on_probation', label: 'Probation' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'notice_period', label: 'Notice' },
];

export function CategoryForm({ detail, options }: { detail: CategoryDetail | null; options: ClaimSetupOptions }) {
  const router = useRouter();
  const r = useActionRunner();
  const v = detail?.values;
  const [f, setF] = React.useState<CatForm>({
    code: v?.code ?? '', name: v?.name ?? '', group: v?.group ?? '', description: v?.description ?? '', displayOrder: String(v?.displayOrder ?? 100), isActive: v?.isActive ?? true,
    receiptRequired: v?.receiptRequired ?? true, notesRequired: v?.notesRequired ?? false, receiptNoMode: v?.receiptNoMode ?? 'optional', myinvoisUuidMode: v?.myinvoisUuidMode ?? 'optional', captureSst: v?.captureSst ?? true, extraFields: v?.extraFields ?? [],
    isMileage: v?.isMileage ?? false, mileageRate: detail?.currentRate ?? '', mileageRateFrom: '',
    claimantScope: v?.claimantScope ?? 'employee_only', minServiceMonths: String(v?.minServiceMonths ?? 0), eligibleStatuses: v?.eligibleStatuses ?? ['on_probation', 'confirmed', 'notice_period'], gradeIds: v?.gradeIds ?? [],
    taxTreatment: v?.taxTreatment ?? '', eaFormLine: v?.eaFormLine ?? '', glAccountCode: v?.glAccountCode ?? '',
  });
  const [dirty, setDirty] = React.useState(false);
  const tabs = detail ? [{ value: 'details', label: 'Details' }, { value: 'limits', label: 'Limits', count: detail.limits.length }, { value: 'history', label: 'History' }] : [{ value: 'details', label: 'Details' }];
  const [tab, setTab] = useTabParam(tabs, 'details');
  const [limitDlg, setLimitDlg] = React.useState<LimitRow | 'new' | null>(null);
  const set = (p: Partial<CatForm>) => {
    setDirty(true);
    setF((x) => ({ ...x, ...p }));
  };
  const e = r.fieldErrors;
  const rateChanged = f.isMileage && f.mileageRate && f.mileageRate !== (detail?.currentRate ?? '');

  const save = async () => {
    const res = await r.run(
      () =>
        saveCategory({
          id: detail?.id,
          version: detail?.version,
          code: f.code,
          name: f.name,
          group: f.group as ClaimGroup,
          description: f.description || null,
          receiptRequired: f.receiptRequired,
          notesRequired: f.notesRequired,
          receiptNoMode: f.receiptNoMode as CaptureMode,
          myinvoisUuidMode: f.myinvoisUuidMode as CaptureMode,
          captureSst: f.captureSst,
          isMileage: f.isMileage,
          mileageRate: f.isMileage && rateChanged ? f.mileageRate : null,
          mileageRateFrom: f.isMileage && rateChanged ? f.mileageRateFrom || null : null,
          extraFields: f.extraFields,
          claimantScope: f.claimantScope as ClaimantScope,
          minServiceMonths: Number(f.minServiceMonths || 0),
          eligibleStatuses: f.eligibleStatuses as ('on_probation' | 'confirmed' | 'notice_period')[],
          gradeIds: f.gradeIds,
          taxTreatment: f.taxTreatment as TaxTreatment,
          eaFormLine: f.eaFormLine || null,
          glAccountCode: f.glAccountCode,
          displayOrder: Number(f.displayOrder || 0),
          isActive: f.isActive,
        }),
      { success: 'Category saved.' },
    );
    if (res?.ok) {
      setDirty(false);
      if (!detail || res.code !== detail.values.code) router.replace(`/claims/setup/categories/${encodeURIComponent(res.code)}`);
    }
  };

  const labels = { code: 'Code', name: 'Name', group: 'Group', mileageRate: 'Mileage rate', glAccountCode: 'AutoCount GL account', taxTreatment: 'Tax treatment', eligibleStatuses: 'Statuses' };
  const card = (title: string, children: React.ReactNode, subtitle?: string) => (
    <Card component="section">
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h5" component="h2" sx={{ mb: subtitle ? 0.5 : 2 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {subtitle}
          </Typography>
        )}
        {children}
      </CardContent>
    </Card>
  );

  return (
    <Box>
      <ProfileTabs tabs={tabs} value={tab} onChange={setTab} label="Category sections" />
      {tab === 'details' && (
        <Box component="form" noValidate onSubmit={(ev: React.FormEvent) => (ev.preventDefault(), void save())} sx={{ pb: 10 }}>
          <ErrorSummary error={r.error} fieldErrors={e} labels={labels} />
          <fieldset disabled={r.saving} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            <Stack spacing={2}>
              {card(
                'Identity',
                <FormGrid>
                  <TextInput label="Code" required value={f.code} onChange={(x) => set({ code: x.toUpperCase() })} maxLength={10} error={e.code} locked={detail?.inUse ? 'Used on claim lines — the code cannot change.' : false} />
                  <TextInput label="Name" required value={f.name} onChange={(x) => set({ name: x })} maxLength={80} error={e.name} />
                  <SelectInput label="Group" required value={f.group} onChange={(x) => set({ group: x })} options={opts(CLAIM_GROUP_LABELS, CLAIM_GROUPS)} error={e.group} />
                  <NumberInput label="Display order" value={f.displayOrder} onChange={(x) => set({ displayOrder: x })} min={0} max={9999} error={e.displayOrder} />
                  <FullRow>
                    <TextInput label="Description / policy text" value={f.description} onChange={(x) => set({ description: x })} maxLength={1000} multiline minRows={3} helper="Shown under the category on the claim line." error={e.description} />
                  </FullRow>
                  <SwitchInput label="Active" checked={f.isActive} onChange={(x) => set({ isActive: x })} helper="Inactive categories are hidden for new lines; pending claims continue." />
                </FormGrid>,
              )}
              {card(
                'Capture rules',
                <FormGrid>
                  <SwitchInput label="Receipt required *" checked={f.receiptRequired} onChange={(x) => set({ receiptRequired: x })} />
                  <SwitchInput label="Notes required *" checked={f.notesRequired} onChange={(x) => set({ notesRequired: x })} />
                  <SelectInput label="e-Invoice / receipt no." required value={f.receiptNoMode} onChange={(x) => set({ receiptNoMode: x })} options={opts(CAPTURE_MODE_LABELS, CAPTURE_MODES)} />
                  <SelectInput label="MyInvois UUID" required value={f.myinvoisUuidMode} onChange={(x) => set({ myinvoisUuidMode: x })} options={opts(CAPTURE_MODE_LABELS, CAPTURE_MODES)} />
                  <SwitchInput label="Capture SST *" checked={f.captureSst} onChange={(x) => set({ captureSst: x })} />
                  <MultiSelectInput label="Extra line fields" value={f.extraFields} onChange={(x) => set({ extraFields: x as ClaimExtraField[] })} options={opts(CLAIM_EXTRA_FIELD_LABELS, CLAIM_EXTRA_FIELDS)} helper="These fields become mandatory on the line." />
                </FormGrid>,
              )}
              {card(
                'Mileage',
                <Stack spacing={2}>
                  <SwitchInput label="Mileage-based *" checked={f.isMileage} onChange={(x) => set({ isMileage: x })} helper="Amount = km × rate (rounded to the sen); From, To and Purpose required." />
                  {f.isMileage && (
                    <FormGrid>
                      <TextInput label="Rate (RM/km)" required value={f.mileageRate} onChange={(x) => set({ mileageRate: x.replace(/[^0-9.]/g, '') })} inputMode="decimal" error={e.mileageRate} helper="Up to 3 decimals, e.g. 0.500. A change adds a history row." />
                      <DateInput label="Effective from" required={Boolean(rateChanged)} value={f.mileageRateFrom} onChange={(x) => set({ mileageRateFrom: x })} error={e.mileageRateFrom} helper="Lines use the rate effective on their transaction date." />
                    </FormGrid>
                  )}
                  {detail && detail.rates.length > 0 && (
                    <MiniTable
                      caption="Rate history"
                      rows={detail.rates}
                      getRowId={(x) => x.id}
                      columns={[
                        { key: 'f', header: 'Effective from', render: (x) => formatDate(x.effectiveFrom) },
                        { key: 'r', header: 'Rate', render: (x) => formatRatePerKm(x.ratePerKm) },
                        { key: 'b', header: 'Set by', render: (x) => `${x.setByName ?? 'System'} · ${formatDateTime(x.createdAt)}` },
                      ]}
                    />
                  )}
                </Stack>,
              )}
              {card(
                'Eligibility',
                <FormGrid>
                  <SelectInput label="Claimant" required value={f.claimantScope} onChange={(x) => set({ claimantScope: x })} options={opts(CLAIMANT_SCOPE_LABELS, CLAIMANT_SCOPES)} helper="Employee and dependants lets the line name a spouse or child (sensitive for Medical)." />
                  <NumberInput label="Minimum service (months)" value={f.minServiceMonths} onChange={(x) => set({ minServiceMonths: x })} min={0} max={600} error={e.minServiceMonths} />
                  <MultiSelectInput label="Statuses" required value={f.eligibleStatuses} onChange={(x) => set({ eligibleStatuses: x })} options={STATUS_OPTS} error={e.eligibleStatuses} />
                  <MultiSelectInput label="Grades" value={f.gradeIds} onChange={(x) => set({ gradeIds: x })} options={options.grades.map((g) => ({ value: g.id, label: g.label }))} helper="Blank = all grades." />
                </FormGrid>,
              )}
              {card(
                'Finance',
                <FormGrid>
                  <SelectInput label="Tax treatment" required value={f.taxTreatment} onChange={(x) => set({ taxTreatment: x })} options={opts(TAX_TREATMENT_LABELS, TAX_TREATMENTS)} error={e.taxTreatment} helper="Proposal — verify with the tax adviser (Q24). Stored for payroll / EA form (R1.1)." />
                  {f.taxTreatment && f.taxTreatment !== 'reimbursement' ? (
                    <TextInput label="EA form line" value={f.eaFormLine} onChange={(x) => set({ eaFormLine: x })} maxLength={40} error={e.eaFormLine} helper="EA Part B line (used from R1.1)." />
                  ) : (
                    <Box />
                  )}
                  <Autocomplete
                    freeSolo
                    options={options.glAccounts}
                    value={f.glAccountCode}
                    onInputChange={(_ev, x) => set({ glAccountCode: x.slice(0, 20) })}
                    renderInput={(p) => <TextField {...p} label="AutoCount GL account" required error={Boolean(e.glAccountCode)} helperText={e.glAccountCode ?? 'Expense account in AutoCount (checked against the GL mapping list).'} />}
                  />
                </FormGrid>,
              )}
              <RecordFooter meta={detail} />
            </Stack>
          </fieldset>
          <Box sx={{ position: 'sticky', bottom: 0, py: 1.5, bgcolor: 'background.default', display: 'flex', justifyContent: 'flex-end', gap: 1, zIndex: 2 }}>
            <Button variant="outlined" color="inherit" component={NextLink} href="/claims/setup/categories">
              Back
            </Button>
            <Button variant="contained" type="submit" loading={r.saving} disabled={!dirty && Boolean(detail)}>
              Save
            </Button>
          </Box>
        </Box>
      )}
      {tab === 'limits' && detail && (
        <Card>
          <CardContent>
            <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                Precedence: {LIMIT_PRECEDENCE_NOTE}. Limits include SST.
              </Typography>
              <Button variant="contained" onClick={() => setLimitDlg('new')}>
                Add limit
              </Button>
            </Stack>
            <MiniTable caption="Limits" rows={detail.limits} getRowId={(x) => x.id} columns={limitMiniColumns()} empty="No limits — this category has no limit." rowActions={(x) => (x.canEdit ? <Button size="small" onClick={() => setLimitDlg(x)}>Edit</Button> : null)} />
          </CardContent>
        </Card>
      )}
      {tab === 'history' && detail && (
        <Card>
          <CardContent>
            <MiniTable
              caption="History"
              rows={detail.history}
              getRowId={(x) => `${x.at}-${x.field}`}
              empty="No changes recorded."
              columns={[
                { key: 'f', header: 'Field', render: (x) => x.field },
                { key: 'b', header: 'Before', render: (x) => x.before ?? '—' },
                { key: 'a', header: 'After', render: (x) => x.after ?? '—' },
                { key: 'by', header: 'By', render: (x) => x.byName },
                { key: 'at', header: 'At', render: (x) => formatDateTime(x.at) },
              ]}
            />
          </CardContent>
        </Card>
      )}
      {limitDlg && detail && (
        <LimitDialog
          open
          row={limitDlg === 'new' ? null : limitDlg}
          categories={[{ id: detail.id, code: detail.values.code, name: detail.values.name, group: detail.values.group, isMileage: detail.values.isMileage }]}
          fixedCategoryId={detail.id}
          options={options}
          onClose={() => setLimitDlg(null)}
        />
      )}
    </Box>
  );
}

function limitMiniColumns() {
  return [
    { key: 'a', header: 'Applies to', render: (x: LimitRow) => LIMIT_APPLIES_TO_LABELS[x.appliesTo] },
    { key: 't', header: 'Target', render: (x: LimitRow) => x.target?.label ?? '—' },
    { key: 'pt', header: 'Per transaction (RM)', align: 'right' as const, render: (x: LimitRow) => (x.perTransaction ? <MoneyCell v={x.perTransaction} /> : '—') },
    { key: 'pm', header: 'Per month (RM)', align: 'right' as const, render: (x: LimitRow) => (x.perMonth ? <MoneyCell v={x.perMonth} /> : '—') },
    { key: 'py', header: 'Per year (RM)', align: 'right' as const, render: (x: LimitRow) => (x.perYear ? <MoneyCell v={x.perYear} /> : '—') },
    { key: 'b', header: 'Behaviour', render: (x: LimitRow) => LIMIT_BEHAVIOUR_LABELS[x.behaviour] },
    { key: 'f', header: 'Effective from', render: (x: LimitRow) => formatDate(x.effectiveFrom) },
    { key: 'to', header: 'Effective to', render: (x: LimitRow) => formatDate(x.effectiveTo) || '—' },
  ];
}

// =============================================================================================
// C7 limits list + dialog
// =============================================================================================
export function LimitsList({ rows, total, params, categories, options }: { rows: LimitRow[]; total: number; params: LimitListParams; categories: CategoryRef[]; options: ClaimSetupOptions }) {
  const router = useRouter();
  const toast = useToast();
  const list = useServerList({ filters: LIMIT_FILTERS, sort: { key: 'category', direction: 'asc' } });
  const [dlg, setDlg] = React.useState<LimitRow | 'new' | null>(null);
  const [ending, setEnding] = React.useState<LimitRow | null>(null);
  const [endDate, setEndDate] = React.useState(todayMyt());
  const d = list.draft;
  const set = list.setDraftField;
  const columns: ListColumn<LimitRow>[] = [
    { key: 'category', header: 'Category', value: (x) => x.category.name },
    { key: 'appliesTo', header: 'Applies to', value: (x) => LIMIT_APPLIES_TO_LABELS[x.appliesTo] },
    { key: 'target', header: 'Target', sortable: false, value: (x) => x.target?.label ?? '' },
    { key: 'pt', header: 'Per transaction (RM)', kind: 'money', sortable: false, value: (x) => (x.perTransaction ? formatAmount(x.perTransaction) : ''), render: (x) => (x.perTransaction ? <MoneyCell v={x.perTransaction} /> : '—') },
    { key: 'pm', header: 'Per month (RM)', kind: 'money', sortable: false, value: (x) => (x.perMonth ? formatAmount(x.perMonth) : ''), render: (x) => (x.perMonth ? <MoneyCell v={x.perMonth} /> : '—') },
    { key: 'py', header: 'Per year (RM)', kind: 'money', sortable: false, priority: 'low', value: (x) => (x.perYear ? formatAmount(x.perYear) : ''), render: (x) => (x.perYear ? <MoneyCell v={x.perYear} /> : '—') },
    { key: 'b', header: 'Behaviour', sortable: false, value: (x) => LIMIT_BEHAVIOUR_LABELS[x.behaviour] },
    { key: 'from', header: 'Effective from', kind: 'date', value: (x) => formatDate(x.effectiveFrom) },
    { key: 'to', header: 'Effective to', kind: 'date', sortable: false, priority: 'low', value: (x) => formatDate(x.effectiveTo) },
  ];
  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Precedence: {LIMIT_PRECEDENCE_NOTE}. Amounts include SST; blank = no limit.
      </Typography>
      <ListPage<LimitRow>
        itemName={{ singular: 'limit', plural: 'limits' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Category or target." />,
          <MultiSelectFilter key="c" label="Category" value={d.categoryIds} onChange={(v) => set('categoryIds', v)} options={categories.map((c) => ({ value: c.id, label: c.name }))} />,
          <MultiSelectFilter key="a" label="Applies to" value={d.appliesTo} onChange={(v) => set('appliesTo', v)} options={opts(LIMIT_APPLIES_TO_LABELS, LIMIT_APPLIES_TO)} />,
          <DateFilter key="e" label="Effective on" value={d.effectiveOn} onChange={(v) => set('effectiveOn', v)} />,
          <MultiSelectFilter key="b" label="Behaviour" value={d.behaviours} onChange={(v) => set('behaviours', v)} options={opts(LIMIT_BEHAVIOUR_LABELS, LIMIT_BEHAVIOURS)} />,
        ]}
        {...list.listProps}
        addNew={{ label: 'Add limit', onClick: () => setDlg('new') }}
        onExport={async () => {
          const res = await exportLimitsCsv(params);
          if (res.ok) downloadServerCsv(res.filename || 'claim-limits', res.content);
          else toast.info(res.error);
        }}
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(x) => x.id}
        getRowRef={(x) => `${x.category.name} ${LIMIT_APPLIES_TO_LABELS[x.appliesTo]}`}
        rowActions={(x) => [
          ...(x.canEdit ? [{ label: 'Edit', onClick: () => setDlg(x) }] : []),
          ...(x.canEnd ? [{ label: 'End', danger: true, onClick: () => setEnding(x) }] : []),
        ]}
        empty={{ title: 'No limits configured — claims have no limit.' }}
      />
      {dlg && <LimitDialog open row={dlg === 'new' ? null : dlg} categories={categories} options={options} onClose={() => setDlg(null)} />}
      <ConfirmDialog
        open={Boolean(ending)}
        title={`End this limit for ${ending?.category.name}?`}
        body={<DateInput label="Effective to" required value={endDate} onChange={setEndDate} />}
        confirmLabel="End limit"
        destructive
        onClose={() => setEnding(null)}
        onConfirm={async () => {
          if (!ending) return;
          const res = await endLimit({ id: ending.id, effectiveTo: endDate });
          if (res.ok) {
            toast.success('Limit ended.');
            setEnding(null);
            router.refresh();
          } else toast.info(res.error);
        }}
      />
    </>
  );
}

export function LimitDialog({
  open,
  row,
  categories,
  fixedCategoryId,
  options,
  onClose,
}: {
  open: boolean;
  row: LimitRow | null;
  categories: CategoryRef[];
  fixedCategoryId?: string;
  options: ClaimSetupOptions;
  onClose: () => void;
}) {
  const r = useActionRunner();
  const [f, setF] = React.useState({
    categoryId: row?.category.id ?? fixedCategoryId ?? '',
    appliesTo: row?.appliesTo ?? 'everyone',
    targetId: row?.target?.id ?? '',
    perTransaction: row?.perTransaction ?? '',
    perMonth: row?.perMonth ?? '',
    perYear: row?.perYear ?? '',
    behaviour: row?.behaviour ?? 'block',
    effectiveFrom: row?.effectiveFrom ?? todayMyt(),
    effectiveTo: row?.effectiveTo ?? '',
  });
  const [emp, setEmp] = React.useState<PickedPerson | null>(row?.appliesTo === 'employee' && row.target ? { id: row.target.id, employeeNo: null, name: row.target.label } : null);
  const [dirty, setDirty] = React.useState(false);
  const set = (p: Partial<typeof f>) => {
    setDirty(true);
    setF((x) => ({ ...x, ...p }));
  };
  const targets: Option[] =
    f.appliesTo === 'grade' ? options.grades.map((x) => ({ value: x.id, label: x.label })) : f.appliesTo === 'department' ? options.departments.map((x) => ({ value: x.id, label: x.label })) : f.appliesTo === 'employee_group' ? options.employeeGroups.map((x) => ({ value: x.id, label: x.label })) : [];
  const e = r.fieldErrors;
  return (
    <FormDialog
      open={open}
      title={row ? 'Edit limit' : 'Add limit'}
      onClose={onClose}
      dirty={dirty}
      saving={r.saving}
      error={r.error}
      fieldErrors={e}
      fieldLabels={{ categoryId: 'Category', targetId: 'Target', perTransaction: 'Per transaction', perMonth: 'Per month', perYear: 'Per year', effectiveFrom: 'Effective from', effectiveTo: 'Effective to' }}
      onSubmit={async () => {
        const res = await r.run(
          () =>
            saveLimit({
              id: row?.id,
              categoryId: f.categoryId,
              appliesTo: f.appliesTo,
              targetId: f.appliesTo === 'everyone' ? null : f.appliesTo === 'employee' ? emp?.id ?? null : f.targetId || null,
              perTransaction: f.perTransaction || null,
              perMonth: f.perMonth || null,
              perYear: f.perYear || null,
              behaviour: f.behaviour,
              effectiveFrom: f.effectiveFrom,
              effectiveTo: f.effectiveTo || null,
            }),
          { success: 'Limit saved.' },
        );
        if (res?.ok) onClose();
      }}
    >
      <FormGrid>
        <SelectInput label="Category" required value={f.categoryId} onChange={(x) => set({ categoryId: x })} options={categories.map((c) => ({ value: c.id, label: c.name }))} error={e.categoryId} locked={fixedCategoryId ? 'This category.' : false} />
        <SelectInput label="Applies to" required value={f.appliesTo} onChange={(x) => set({ appliesTo: x as typeof f.appliesTo, targetId: '' })} options={opts(LIMIT_APPLIES_TO_LABELS, LIMIT_APPLIES_TO)} />
        {f.appliesTo === 'employee' ? (
          <FullRow>
            <ClaimEmployeePicker label="Target employee" required value={emp} onChange={(p) => (setDirty(true), setEmp(p))} error={e.targetId} />
          </FullRow>
        ) : f.appliesTo !== 'everyone' ? (
          <FullRow>
            <SelectInput label="Target" required value={f.targetId} onChange={(x) => set({ targetId: x })} options={targets} error={e.targetId} />
          </FullRow>
        ) : null}
        <TextInput label="Per transaction (RM)" value={f.perTransaction} onChange={(x) => set({ perTransaction: x })} inputMode="decimal" error={e.perTransaction} helper="Blank = no limit." />
        <TextInput label="Per month (RM)" value={f.perMonth} onChange={(x) => set({ perMonth: x })} inputMode="decimal" error={e.perMonth} helper="At least the per-transaction amount." />
        <TextInput label="Per year (RM)" value={f.perYear} onChange={(x) => set({ perYear: x })} inputMode="decimal" error={e.perYear} helper="At least the per-month amount." />
        <SelectInput label="Behaviour" required value={f.behaviour} onChange={(x) => set({ behaviour: x as 'block' | 'warn' })} options={opts(LIMIT_BEHAVIOUR_LABELS, LIMIT_BEHAVIOURS)} helper="Block stops submission; Warn lets it through with a flag for the approver." />
        <DateInput label="Effective from" required value={f.effectiveFrom} onChange={(x) => set({ effectiveFrom: x })} error={e.effectiveFrom} />
        <DateInput label="Effective to" value={f.effectiveTo} onChange={(x) => set({ effectiveTo: x })} error={e.effectiveTo} />
        <FullRow>
          <Typography variant="caption" color="text.secondary">
            Precedence: {LIMIT_PRECEDENCE_NOTE}.
          </Typography>
        </FullRow>
      </FormGrid>
    </FormDialog>
  );
}

// =============================================================================================
// C8 claims settings
// =============================================================================================
export function ClaimSettingsForm({ policy, glAccounts }: { policy: ClaimPolicy; glAccounts: string[] }) {
  const r = useActionRunner();
  const [f, setF] = React.useState({
    submissionDeadlineDays: String(policy.submissionDeadlineDays),
    limitRefreshDay: String(policy.limitRefreshDay),
    disbursementCutoffDay: String(policy.disbursementCutoffDay),
    notesRequiredDefault: policy.notesRequiredDefault,
    attachmentsRequiredDefault: policy.attachmentsRequiredDefault,
    newClaimReminderDays: String(policy.newClaimReminderDays),
    includeSeparatedDefault: policy.includeSeparatedDefault,
    autocountDocumentDateBasis: policy.autocountDocumentDateBasis,
    claimsPayableGl: policy.claimsPayableGl ?? '',
    saBatchApprovalRequired: policy.saBatchApprovalRequired,
  });
  const [dirty, setDirty] = React.useState(false);
  const set = (p: Partial<typeof f>) => {
    setDirty(true);
    setF((x) => ({ ...x, ...p }));
  };
  const dayOpts = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: i === 30 ? '31 — last day of the month' : String(i + 1) }));
  const e = r.fieldErrors;
  return (
    <FormCard
      title="Claims settings"
      subtitle="Apply to new claims and the next disbursement batch."
      onSave={async () => {
        const res = await r.run(
          () =>
            updateClaimPolicy({
              submissionDeadlineDays: Number(f.submissionDeadlineDays),
              limitRefreshDay: Number(f.limitRefreshDay),
              disbursementCutoffDay: Number(f.disbursementCutoffDay),
              notesRequiredDefault: f.notesRequiredDefault,
              attachmentsRequiredDefault: f.attachmentsRequiredDefault,
              newClaimReminderDays: Number(f.newClaimReminderDays),
              includeSeparatedDefault: f.includeSeparatedDefault,
              autocountDocumentDateBasis: f.autocountDocumentDateBasis,
              claimsPayableGl: f.claimsPayableGl || null,
              saBatchApprovalRequired: policy.canEditSaSetting ? f.saBatchApprovalRequired : undefined,
            }),
          { success: 'Claims settings saved.' },
        );
        if (res?.ok) setDirty(false);
      }}
      saving={r.saving}
      dirty={dirty}
      saveLabel="Save settings"
      error={r.error}
      fieldErrors={e}
      meta={policy}
    >
      <FormGrid>
        <NumberInput label="Submission deadline (days after transaction)" required value={f.submissionDeadlineDays} onChange={(x) => set({ submissionDeadlineDays: x })} min={1} max={366} error={e.submissionDeadlineDays} helper="Default 60 (BR-CLM-10). Older lines need a late-submission override." />
        <SelectInput label="Monthly limit-refresh day" required value={f.limitRefreshDay} onChange={(x) => set({ limitRefreshDay: x })} options={dayOpts} error={e.limitRefreshDay} helper="Default 31 = month end (as Kakitangan)." />
        <SelectInput label="Month-end disbursement cut-off" required value={f.disbursementCutoffDay} onChange={(x) => set({ disbursementCutoffDay: x })} options={dayOpts} error={e.disbursementCutoffDay} helper="Default: last day of the month. Approved claims up to this date are proposed for the batch." />
        <NumberInput label="Reminder for unsubmitted New claims (days)" value={f.newClaimReminderDays} onChange={(x) => set({ newClaimReminderDays: x })} min={1} max={366} error={e.newClaimReminderDays} />
        <SwitchInput label="Notes required by default" checked={f.notesRequiredDefault} onChange={(x) => set({ notesRequiredDefault: x })} />
        <SwitchInput label="Attachments required by default" checked={f.attachmentsRequiredDefault} onChange={(x) => set({ attachmentsRequiredDefault: x })} />
        <SwitchInput label="Include separated employees in claims lists" checked={f.includeSeparatedDefault} onChange={(x) => set({ includeSeparatedDefault: x })} />
        <SwitchInput
          label="Super Admin approval of disbursement batches"
          checked={f.saBatchApprovalRequired}
          onChange={(x) => set({ saBatchApprovalRequired: x })}
          locked={policy.canEditSaSetting ? false : 'Only a Super Admin can change this.'}
          helper="Default Off (D12). When on, a Super Admin other than the preparer approves each batch before outputs are generated."
        />
        <SelectInput
          label="AutoCount document date"
          required
          value={f.autocountDocumentDateBasis}
          onChange={(x) => set({ autocountDocumentDateBasis: x as 'approval' | 'disbursed' })}
          options={[
            { value: 'approval', label: 'Approval date' },
            { value: 'disbursed', label: 'Disbursed date' },
          ]}
        />
        <Autocomplete
          freeSolo
          options={glAccounts}
          value={f.claimsPayableGl}
          onInputChange={(_ev, x) => set({ claimsPayableGl: x.slice(0, 20) })}
          renderInput={(p) => <TextField {...p} label="AutoCount claims-payable credit account (GL)" error={Boolean(e.claimsPayableGl)} helperText={e.claimsPayableGl ?? 'Credit account on the AutoCount postings export.'} />}
        />
        <FullRow>
          <Alert severity="info" variant="outlined">
            Claims cut-off for payroll arrives with Release 1.1 (payroll settings).
          </Alert>
        </FullRow>
      </FormGrid>
    </FormCard>
  );
}
