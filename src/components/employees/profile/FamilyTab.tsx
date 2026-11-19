'use client';

// E3 tab 4 · Family (groups D, E) — ✎ ADM/SA, not own (E→CR).
// Spouses D1–D9 (ADD SPOUSE, max 4 Current; D2 reveal) · Children E1–E9 + derived age
// (ADD CHILD, remove = inactive) · Derived card E10–E13 (manual counts for migration only) ·
// flags BR-EMP-16 / BR-EMP-17 · H11 PCB category (derived).
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
  CHILD_RELATIONSHIP_LABELS,
  GENDER_LABELS,
  PCB_CATEGORY_LABELS,
  PCB_CHILD_CATEGORY_LABELS,
  RELIEF_SHARE_LABELS,
  SPOUSE_RECORD_STATUS_LABELS,
  SPOUSE_WORKING_STATUS_LABELS,
  STUDY_PCB_CATEGORIES,
  type ChildView,
  type FamilyView,
  type SpouseView,
} from '@/server/contracts/employees';
import { saveChild, saveChildCounts, saveSpouse, setChildActive } from '@/server/actions/employees';
import FormDialog from '../../forms/FormDialog';
import ConfirmDialog from '../../dialogs/ConfirmDialog';
import { CheckboxInput, DateInput, FormGrid, NumberInput, SelectInput, SwitchInput, TextInput } from '../../forms/fields';
import { useActionRunner } from '../../forms/useActionRunner';
import MaskedValue, { type RevealMode, type RevealReason } from '../MaskedValue';
import { MykadInput } from '../fieldGroups';
import { KVGrid, MiniTable, SectionCard } from '../ui';
import { boolToYesNo, dateOr, optionsOf, phone, yesNo, YES_NO_OPTIONS, yesNoToBool } from '../labels';
import { todayMyt } from '@/lib/format';

type RevealFn = (field: 'spouse_nric' | 'child_nric', rowId: string) => (reason: RevealReason | null) => Promise<{ ok: true; value: string } | { ok: false; error: string }>;

export function SpousesTable({ rows, revealMode, reveal, actions }: { rows: SpouseView[]; revealMode: RevealMode; reveal: RevealFn; actions?: (r: SpouseView) => React.ReactNode }) {
  return (
    <MiniTable
      caption="Spouses"
      rows={rows}
      getRowId={(r) => r.id}
      empty="No spouse recorded."
      rowActions={actions}
      columns={[
        { key: 'n', header: 'Full name', render: (r) => r.fullName },
        { key: 'k', header: 'MyKad', render: (r) => <MaskedValue masked={r.nricMasked} fieldLabel="spouse MyKad" mode={revealMode} onReveal={reveal('spouse_nric', r.id)} /> },
        { key: 'm', header: 'Date of marriage', render: (r) => dateOr(r.marriageDate) || '—' },
        { key: 'w', header: 'Working status', render: (r) => SPOUSE_WORKING_STATUS_LABELS[r.workingStatus] },
        { key: 'o', header: 'OKU', render: (r) => yesNo(r.isOku) },
        { key: 't', header: 'Income tax no.', render: (r) => r.incomeTaxNo || '—' },
        { key: 'rel', header: 'Relief claimed (R1.1)', render: (r) => yesNo(r.reliefClaimedByEmployee) },
        { key: 's', header: 'Status', render: (r) => SPOUSE_RECORD_STATUS_LABELS[r.recordStatus] },
        { key: 'p', header: 'Phone', render: (r) => phone(r.phone) || '—' },
      ]}
    />
  );
}

export function ChildrenTable({ rows, revealMode, reveal, actions }: { rows: ChildView[]; revealMode: RevealMode; reveal: RevealFn; actions?: (r: ChildView) => React.ReactNode }) {
  return (
    <MiniTable
      caption="Children"
      rows={rows.filter((c) => c.isActive)}
      getRowId={(r) => r.id}
      empty="No children recorded."
      rowActions={actions}
      columns={[
        { key: 'n', header: 'Full name', render: (r) => r.fullName },
        { key: 'k', header: 'MyKid / MyKad', render: (r) => (r.nricMasked ? <MaskedValue masked={r.nricMasked} fieldLabel="child MyKid" mode={revealMode} onReveal={reveal('child_nric', r.id)} /> : '—') },
        { key: 'd', header: 'Date of birth', render: (r) => dateOr(r.dateOfBirth) },
        { key: 'a', header: 'Age', render: (r) => r.age },
        { key: 'g', header: 'Gender', render: (r) => (r.gender ? GENDER_LABELS[r.gender] : '—') },
        { key: 'r', header: 'Relationship', render: (r) => CHILD_RELATIONSHIP_LABELS[r.relationship] },
        {
          key: 'c',
          header: 'PCB category (R1.1)',
          render: (r) => (
            <>
              {r.pcbCategory ? PCB_CHILD_CATEGORY_LABELS[r.pcbCategory] : '—'}
              {r.categoryWarning && (
                <Alert severity="warning" sx={{ mt: 0.5, py: 0 }}>
                  {r.categoryWarning}
                </Alert>
              )}
            </>
          ),
        },
        { key: 's', header: 'Relief share (R1.1)', render: (r) => (r.reliefShare ? RELIEF_SHARE_LABELS[r.reliefShare] : '—') },
        { key: 'i', header: 'Institution & level', render: (r) => r.institutionLevel || '—' },
        { key: 'o', header: 'OKU', render: (r) => yesNo(r.isOku) },
      ]}
    />
  );
}

export function DerivedCounts({ family, showRelief }: { family: FamilyView; showRelief: boolean }) {
  const c = family.counts;
  const src = c.manual ?? c.derived;
  return (
    <KVGrid
      columns={4}
      items={[
        { label: 'Number of children', value: c.total },
        { label: 'PCB-qualifying children', value: c.pcbQualifying },
        { label: 'Children < 18', value: src.lt18 },
        { label: 'Children in tertiary education > 18', value: src.tertiary },
        { label: 'Disabled children < 18', value: src.disabledLt18 },
        { label: 'Disabled children in tertiary education', value: src.disabledTertiary },
        { label: 'Deductible child relief points', value: c.reliefPoints ?? 'Derived in R1.1', hidden: !showRelief },
        { label: 'PCB category (derived)', value: PCB_CATEGORY_LABELS[family.pcbCategory] },
        { label: 'Count source', value: c.manual ? 'Entered manually (migration)' : 'Derived from children', full: true },
      ]}
    />
  );
}

export function FamilyFlags({ flags }: { flags: string[] }) {
  if (!flags.length) return null;
  return (
    <Stack spacing={1}>
      {flags.map((f) => (
        <Alert key={f} severity="warning" variant="outlined">
          {f}
        </Alert>
      ))}
    </Stack>
  );
}

export default function FamilyTab({
  employeeId,
  family,
  canEdit,
  own,
  revealMode,
  reveal,
}: {
  employeeId: string;
  family: FamilyView;
  canEdit: boolean;
  own: boolean;
  revealMode: RevealMode;
  reveal: RevealFn;
}) {
  const editable = canEdit && !own;
  const lock = own ? 'Use a change request for your own record.' : null;
  const [spouse, setSpouse] = React.useState<SpouseView | 'new' | null>(null);
  const [child, setChild] = React.useState<ChildView | 'new' | null>(null);
  const [remove, setRemove] = React.useState<ChildView | null>(null);
  const [counts, setCounts] = React.useState(false);
  const r = useActionRunner();
  const currentSpouses = family.spouses.filter((s) => s.recordStatus === 'current').length;

  return (
    <Stack spacing={2}>
      <FamilyFlags flags={family.flags} />
      <SectionCard
        title="Spouses"
        lockedReason={lock}
        headerActions={
          editable && (
            <Tooltip title={currentSpouses >= 4 ? 'At most 4 current spouses.' : ''}>
              <span>
                <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setSpouse('new')} disabled={currentSpouses >= 4}>
                  Add spouse
                </Button>
              </span>
            </Tooltip>
          )
        }
      >
        <SpousesTable
          rows={family.spouses}
          revealMode={revealMode}
          reveal={reveal}
          actions={
            editable
              ? (s) => (
                  <IconButton size="small" aria-label={`Edit ${s.fullName}`} onClick={() => setSpouse(s)}>
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                )
              : undefined
          }
        />
      </SectionCard>
      <SectionCard
        title="Children"
        lockedReason={lock}
        headerActions={
          editable && (
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setChild('new')}>
              Add child
            </Button>
          )
        }
      >
        <ChildrenTable
          rows={family.children}
          revealMode={revealMode}
          reveal={reveal}
          actions={
            editable
              ? (c) => (
                  <>
                    <IconButton size="small" aria-label={`Edit ${c.fullName}`} onClick={() => setChild(c)}>
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" aria-label={`Remove ${c.fullName}`} onClick={() => setRemove(c)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </>
                )
              : undefined
          }
        />
      </SectionCard>
      <SectionCard
        title="Derived counts (PCB relief inputs)"
        subtitle="Derived from the children rows. Counts can be entered directly only when per-child detail is not available (migration)."
        headerActions={
          editable && (
            <Button size="small" variant="outlined" startIcon={<EditOutlinedIcon />} onClick={() => setCounts(true)}>
              Edit counts
            </Button>
          )
        }
      >
        <DerivedCounts family={family} showRelief />
      </SectionCard>

      <SpouseDialog open={spouse !== null} onClose={() => setSpouse(null)} employeeId={employeeId} row={spouse === 'new' ? null : spouse} />
      <ChildDialog open={child !== null} onClose={() => setChild(null)} employeeId={employeeId} row={child === 'new' ? null : child} />
      <CountsDialog open={counts} onClose={() => setCounts(false)} employeeId={employeeId} family={family} />
      <ConfirmDialog
        open={remove !== null}
        title={`Remove ${remove?.fullName ?? ''} from the family list?`}
        body="The child no longer counts for PCB relief. The record is kept in the history."
        confirmLabel="Remove"
        destructive
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          if (remove) await r.run(() => setChildActive({ id: remove.id, isActive: false }), { success: 'Child removed.' });
          setRemove(null);
        }}
      />
    </Stack>
  );
}

type SpouseForm = { fullName: string; mykad: string; marriageDate: string; workingStatus: string; isOku: boolean; incomeTaxNo: string; reliefClaimedByEmployee: string; recordStatus: string; phone: string };

export function SpouseDialog({ open, onClose, employeeId, row }: { open: boolean; onClose: () => void; employeeId: string; row: SpouseView | null }) {
  const r = useActionRunner();
  const [f, setF] = React.useState<SpouseForm>({ fullName: '', mykad: '', marriageDate: '', workingStatus: '', isOku: false, incomeTaxNo: '', reliefClaimedByEmployee: '', recordStatus: 'current', phone: '' });
  React.useEffect(() => {
    if (!open) return;
    r.reset();
    setF({
      fullName: row?.fullName ?? '',
      mykad: '',
      marriageDate: row?.marriageDate ?? '',
      workingStatus: row?.workingStatus ?? '',
      isOku: row?.isOku ?? false,
      incomeTaxNo: row?.incomeTaxNo ?? '',
      reliefClaimedByEmployee: boolToYesNo(row?.reliefClaimedByEmployee),
      recordStatus: row?.recordStatus ?? 'current',
      phone: row?.phone ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (p: Partial<SpouseForm>) => setF((x) => ({ ...x, ...p }));
  return (
    <FormDialog
      open={open}
      title={row ? `Edit spouse — ${row.fullName}` : 'Add spouse'}
      onClose={onClose}
      submitLabel="Save spouse"
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty
      onSubmit={async () => {
        const res = await r.run(
          () =>
            saveSpouse({
              employeeId,
              id: row?.id,
              fullName: f.fullName,
              mykad: f.mykad,
              marriageDate: f.marriageDate,
              workingStatus: f.workingStatus as 'working',
              isOku: f.isOku,
              incomeTaxNo: f.incomeTaxNo,
              reliefClaimedByEmployee: yesNoToBool(f.reliefClaimedByEmployee),
              recordStatus: f.recordStatus as 'current',
              phone: f.phone,
            }),
          { success: 'Spouse saved.' },
        );
        if (res?.ok) onClose();
      }}
    >
      <FormGrid>
        <TextInput full label="Spouse full name (as per MyKad)" required value={f.fullName} onChange={(v) => set({ fullName: v })} maxLength={150} error={r.fieldErrors.fullName} />
        <MykadInput label="Spouse MyKad no." required={!row} value={f.mykad} onChange={(v) => set({ mykad: v })} error={r.fieldErrors.mykad} helper={row ? `Current ${row.nricMasked} — leave blank to keep.` : undefined} />
        <DateInput label="Date of marriage" value={f.marriageDate} onChange={(v) => set({ marriageDate: v })} maxDate={todayMyt()} error={r.fieldErrors.marriageDate} />
        <SelectInput label="Spouse working status" required value={f.workingStatus} onChange={(v) => set({ workingStatus: v, reliefClaimedByEmployee: v === 'working' ? '' : f.reliefClaimedByEmployee })} options={optionsOf(SPOUSE_WORKING_STATUS_LABELS)} error={r.fieldErrors.workingStatus} helper="Drives the PCB category." />
        <SwitchInput label="Spouse disabled (OKU)" checked={f.isOku} onChange={(v) => set({ isOku: v })} />
        <TextInput label="Spouse income tax no." value={f.incomeTaxNo} onChange={(v) => set({ incomeTaxNo: v.toUpperCase() })} maxLength={20} error={r.fieldErrors.incomeTaxNo} />
        {f.workingStatus === 'not_working' && (
          <SelectInput label="Spouse relief claimed by employee (R1.1)" value={f.reliefClaimedByEmployee} onChange={(v) => set({ reliefClaimedByEmployee: v })} options={YES_NO_OPTIONS} emptyLabel="— Not set —" error={r.fieldErrors.reliefClaimedByEmployee} />
        )}
        <SelectInput label="Spouse record status" required value={f.recordStatus} onChange={(v) => set({ recordStatus: v })} options={optionsOf(SPOUSE_RECORD_STATUS_LABELS)} helper="Former on divorce or death — not used for PCB." />
        <TextInput label="Spouse phone" type="tel" value={f.phone} onChange={(v) => set({ phone: v })} maxLength={20} error={r.fieldErrors.phone} />
      </FormGrid>
    </FormDialog>
  );
}

type ChildForm = { fullName: string; mykad: string; dateOfBirth: string; gender: string; relationship: string; pcbCategory: string; reliefShare: string; institutionLevel: string; isOku: boolean };

export function ChildFields({ f, set, errors, editing }: { f: ChildForm; set: (p: Partial<ChildForm>) => void; errors: Record<string, string | undefined>; editing?: string | null }) {
  const study = (STUDY_PCB_CATEGORIES as string[]).includes(f.pcbCategory);
  return (
    <FormGrid>
      <TextInput full label="Child full name" required value={f.fullName} onChange={(v) => set({ fullName: v })} maxLength={150} error={errors.fullName} />
      <MykadInput label="MyKid / MyKad no." required={false} value={f.mykad} onChange={(v) => set({ mykad: v })} error={errors.mykad} helper={editing ? `Current ${editing} — leave blank to keep.` : 'Optional.'} />
      <DateInput label="Date of birth" required value={f.dateOfBirth} onChange={(v) => set({ dateOfBirth: v })} maxDate={todayMyt()} error={errors.dateOfBirth} />
      <SelectInput label="Gender" value={f.gender} onChange={(v) => set({ gender: v })} options={optionsOf(GENDER_LABELS)} emptyLabel="— Not set —" />
      <SelectInput label="Relationship" required value={f.relationship} onChange={(v) => set({ relationship: v })} options={optionsOf(CHILD_RELATIONSHIP_LABELS)} error={errors.relationship} />
      <SelectInput label="PCB child category (R1.1)" value={f.pcbCategory} onChange={(v) => set({ pcbCategory: v })} options={optionsOf(PCB_CHILD_CATEGORY_LABELS)} emptyLabel="— Not set —" error={errors.pcbCategory} helper="Must be consistent with the child's age." />
      <SelectInput label="Relief share (R1.1)" value={f.reliefShare} onChange={(v) => set({ reliefShare: v })} options={optionsOf(RELIEF_SHARE_LABELS)} emptyLabel="— Not set —" />
      {study && <TextInput label="Institution & level of study" required value={f.institutionLevel} onChange={(v) => set({ institutionLevel: v })} maxLength={100} error={errors.institutionLevel} />}
      <CheckboxInput label="Child disabled (OKU)" checked={f.isOku} onChange={(v) => set({ isOku: v })} />
    </FormGrid>
  );
}
export const childToForm = (row: ChildView | null): ChildForm => ({
  fullName: row?.fullName ?? '',
  mykad: '',
  dateOfBirth: row?.dateOfBirth ?? '',
  gender: row?.gender ?? '',
  relationship: row?.relationship ?? '',
  pcbCategory: row?.pcbCategory ?? '',
  reliefShare: row?.reliefShare ?? '',
  institutionLevel: row?.institutionLevel ?? '',
  isOku: row?.isOku ?? false,
});
export type { ChildForm };

function ChildDialog({ open, onClose, employeeId, row }: { open: boolean; onClose: () => void; employeeId: string; row: ChildView | null }) {
  const r = useActionRunner();
  const [f, setF] = React.useState<ChildForm>(childToForm(null));
  React.useEffect(() => {
    if (open) {
      r.reset();
      setF(childToForm(row));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <FormDialog
      open={open}
      title={row ? `Edit child — ${row.fullName}` : 'Add child'}
      onClose={onClose}
      submitLabel="Save child"
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty
      onSubmit={async () => {
        const res = await r.run(
          () =>
            saveChild({
              employeeId,
              id: row?.id,
              ...f,
              relationship: f.relationship as 'biological',
              institutionLevel: (STUDY_PCB_CATEGORIES as string[]).includes(f.pcbCategory) ? f.institutionLevel : '',
            }),
          { success: 'Child saved.' },
        );
        if (res?.ok) onClose();
      }}
    >
      <ChildFields f={f} set={(p) => setF((x) => ({ ...x, ...p }))} errors={r.fieldErrors} editing={row?.nricMasked} />
    </FormDialog>
  );
}

function CountsDialog({ open, onClose, employeeId, family }: { open: boolean; onClose: () => void; employeeId: string; family: FamilyView }) {
  const r = useActionRunner();
  const [manual, setManual] = React.useState(false);
  const [c, setC] = React.useState({ lt18: '0', tertiary: '0', disabledLt18: '0', disabledTertiary: '0' });
  React.useEffect(() => {
    if (!open) return;
    r.reset();
    const src = family.counts.manual ?? family.counts.derived;
    setManual(Boolean(family.counts.manual));
    setC({ lt18: String(src.lt18), tertiary: String(src.tertiary), disabledLt18: String(src.disabledLt18), disabledTertiary: String(src.disabledTertiary) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <FormDialog
      open={open}
      title="Child counts (PCB)"
      onClose={onClose}
      submitLabel="Save counts"
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      onSubmit={async () => {
        const res = await r.run(
          () => saveChildCounts({ employeeId, counts: manual ? { lt18: c.lt18, tertiary: c.tertiary, disabledLt18: c.disabledLt18, disabledTertiary: c.disabledTertiary } : null }),
          { success: manual ? 'Manual counts saved.' : 'Counts now derived from the children rows.' },
        );
        if (res?.ok) onClose();
      }}
    >
      <Stack spacing={2}>
        <SwitchInput label="Enter counts manually (no per-child detail — migration)" checked={manual} onChange={setManual} />
        {manual && (
          <FormGrid>
            <NumberInput label="Children < 18" value={c.lt18} onChange={(v) => setC({ ...c, lt18: v })} min={0} max={20} />
            <NumberInput label="Children in tertiary education > 18" value={c.tertiary} onChange={(v) => setC({ ...c, tertiary: v })} min={0} max={20} />
            <NumberInput label="Disabled children < 18" value={c.disabledLt18} onChange={(v) => setC({ ...c, disabledLt18: v })} min={0} max={20} />
            <NumberInput label="Disabled children in tertiary education" value={c.disabledTertiary} onChange={(v) => setC({ ...c, disabledTertiary: v })} min={0} max={20} />
          </FormGrid>
        )}
      </Stack>
    </FormDialog>
  );
}
