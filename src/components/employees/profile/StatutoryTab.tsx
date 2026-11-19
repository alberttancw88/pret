'use client';

// E3 tab 6 · Statutory & payroll (group H) — sub-cards PCB · EPF · SOCSO & SKBBK · EIS · Zakat ·
// HRDF · PTPTN; employer-only flags (HR only); ✎ ADM/SA, not own. R1.1-required blanks are
// marked "Needed for payroll". Also used read-only (no employer flags) by P16.
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  EPF_RATE_TYPE_LABELS,
  PCB_CATEGORY_LABELS,
  SOCSO_CATEGORY_LABELS,
  type EmployerFlagsView,
  type StatutoryView,
} from '@/server/contracts/employees';
import { saveStatutory } from '@/server/actions/employees';
import { useActionRunner } from '../../forms/useActionRunner';
import MoneyText from '../../MoneyText';
import { KVGrid, SectionCard, type KV } from '../ui';
import { StatutoryFields, flagsPayload, statutoryPayload, type FlagsForm, type StatutoryForm } from '../fieldGroups';
import { boolToYesNo, dateOr, yesNo } from '../labels';
import { OWN_LOCK, type ProfileCtx } from './context';

const toForm = (s: StatutoryView): StatutoryForm => ({
  payPcb: s.payPcb,
  incomeTaxNo: s.incomeTaxNo ?? '',
  isTaxResident: s.isTaxResident,
  lhdnBranchId: s.lhdnBranch?.id ?? '',
  payEpf: s.payEpf,
  epfNo: s.epfNo ?? '',
  epfRateType: s.epfRateType,
  epfSpecificRate: s.epfSpecificRate ?? '',
  epfExtraEmployeePct: s.epfExtraEmployeePct ?? '',
  paySocso: s.paySocso,
  socsoNo: s.socsoNo ?? '',
  socsoCategory: s.socsoCategory ?? '',
  socsoContributedBefore: boolToYesNo(s.socsoContributedBefore),
  payEis: boolToYesNo(s.payEis),
  payZakat: s.payZakat,
  zakatMonthlyAmount: s.zakatMonthlyAmount ?? '',
  zakatAccountNo: s.zakatAccountNo ?? '',
  zakatBodyId: s.zakatBody?.id ?? '',
  ptptnMonthlyAmount: s.ptptnMonthlyAmount ?? '',
  ptptnStartDate: s.ptptnStartDate ?? '',
  ptptnEndDate: s.ptptnEndDate ?? '',
});
const flagsToForm = (f: EmployerFlagsView): FlagsForm => ({ ...f, epfExtraEmployerPct: f.epfExtraEmployerPct ?? '', payHrdf: boolToYesNo(f.payHrdf) });

function needed(label: string, value: React.ReactNode, list: string[]): React.ReactNode {
  const blank = value === null || value === undefined || value === '';
  if (blank && list.some((n) => n.toLowerCase() === label.toLowerCase())) return <Chip size="small" color="warning" variant="outlined" label="Needed for payroll" />;
  return value;
}

/** Read-only statutory sub-cards. `flags` = HR view; omit for the employee's own view (P16). */
export function StatutoryReadOnly({ s, flags }: { s: StatutoryView; flags?: EmployerFlagsView | null }) {
  const n = s.neededForPayroll;
  const kv = (label: string, value: React.ReactNode, hidden = false): KV => ({ label, value: needed(label, value, n), hidden });
  const block = (title: string, items: KV[]) => (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Typography variant="subtitle1" component="h3" sx={{ mb: 1.5 }}>
        {title}
      </Typography>
      <KVGrid items={items} />
    </Box>
  );
  return (
    <Stack spacing={2}>
      {s.warnings.map((w) => (
        <Alert key={w} severity="warning" variant="outlined">
          {w}
        </Alert>
      ))}
      {block('PCB / income tax', [
        kv('Pay tax (PCB/MTD)', yesNo(s.payPcb)),
        kv('Tax borne by employer', yesNo(flags?.pcbBorneByEmployer), !flags),
        kv('Income tax no.', s.incomeTaxNo),
        kv('Malaysian tax resident', yesNo(s.isTaxResident)),
        kv('LHDN state / branch', s.lhdnBranch?.label ?? ''),
        kv('Returning Expert Programme', yesNo(flags?.returningExpertProgramme), !flags),
        kv('Knowledge worker at specified region', yesNo(flags?.knowledgeWorkerSpecifiedRegion), !flags),
        kv('PCB category (derived)', PCB_CATEGORY_LABELS[s.pcbCategory]),
        { label: 'Disabled person (self) · spouse · children', value: 'From the Personal and Family tabs (single source).', full: true },
      ])}
      {block('EPF (KWSP)', [
        kv('Pay EPF', yesNo(s.payEpf)),
        kv('EPF borne by employer', yesNo(flags?.epfBorneByEmployer), !flags),
        kv('EPF no.', s.epfNo),
        kv('Employee EPF rate', `${EPF_RATE_TYPE_LABELS[s.epfRateType]}${s.epfRateType === 'specific' && s.epfSpecificRate ? ` (${s.epfSpecificRate}%)` : ''}`),
        kv('Extra employee EPF %', s.epfExtraEmployeePct ? `${s.epfExtraEmployeePct}%` : ''),
        kv('Extra employer EPF %', flags?.epfExtraEmployerPct ? `${flags.epfExtraEmployerPct}%` : '', !flags),
      ])}
      {block('SOCSO (PERKESO) & SKBBK', [
        kv('Pay SOCSO', yesNo(s.paySocso)),
        kv('SOCSO borne by employer', yesNo(flags?.socsoBorneByEmployer), !flags),
        kv('SOCSO no.', s.socsoNo),
        kv('SOCSO category', s.socsoCategory ? SOCSO_CATEGORY_LABELS[s.socsoCategory] : ''),
        kv('Has contributed to SOCSO before', yesNo(s.socsoContributedBefore)),
        kv('Pay SKBBK', yesNo(flags?.paySkbbk), !flags),
        kv('SKBBK borne by employer', yesNo(flags?.skbbkBorneByEmployer), !flags),
      ])}
      {block('EIS', [kv('Pay EIS', yesNo(s.payEis)), kv('EIS borne by employer', yesNo(flags?.eisBorneByEmployer), !flags)])}
      {block('Zakat', [
        kv('Pay zakat via payroll', yesNo(s.payZakat)),
        kv('Zakat monthly amount', s.zakatMonthlyAmount ? <MoneyText component="span" amount={s.zakatMonthlyAmount} /> : '', !s.payZakat),
        kv('Zakat account / reference no.', s.zakatAccountNo, !s.payZakat),
        kv('Zakat authority', s.zakatBody?.label ?? '', !s.payZakat),
      ])}
      {flags && block('HRDF', [kv('Pay HRDF levy for this employee', yesNo(flags.payHrdf))])}
      {block('PTPTN', [
        kv('PTPTN monthly deduction', s.ptptnMonthlyAmount ? <MoneyText component="span" amount={s.ptptnMonthlyAmount} /> : ''),
        kv('Deduction start', dateOr(s.ptptnStartDate), !s.ptptnMonthlyAmount),
        kv('Deduction end', dateOr(s.ptptnEndDate), !s.ptptnMonthlyAmount),
      ])}
    </Stack>
  );
}

export default function StatutoryTab({ ctx, religionKnownNotIslam }: { ctx: ProfileCtx; religionKnownNotIslam: boolean }) {
  const { profile, org, formOptions } = ctx;
  const own = profile.isOwnRecord;
  const r = useActionRunner();
  const [editing, setEditing] = React.useState(false);
  const [s, setS] = React.useState<StatutoryForm>(() => toForm(profile.statutory));
  const [f, setF] = React.useState<FlagsForm>(() => flagsToForm(profile.employerFlags));
  return (
    <SectionCard
      title="Statutory & payroll-deduction profile"
      subtitle={
        profile.statutory.neededForPayroll.length
          ? `Captured now, used by payroll from Release 1.1. Needed for payroll: ${profile.statutory.neededForPayroll.join(', ')}.`
          : 'Captured now, used by payroll from Release 1.1.'
      }
      canEdit={profile.can.editStatutory && !own}
      lockedReason={own ? OWN_LOCK : null}
      editing={editing}
      onEdit={() => {
        setS(toForm(profile.statutory));
        setF(flagsToForm(profile.employerFlags));
        r.reset();
        setEditing(true);
      }}
      onCancel={() => setEditing(false)}
      onSave={async () => {
        const res = await r.run(() => saveStatutory({ employeeId: profile.id, profile: statutoryPayload(s), employerFlags: flagsPayload(f) }), {
          success: (x) => {
            const w = (x as unknown as { warnings?: string[] }).warnings ?? [];
            return w.length ? `Saved. ${w.join(' ')}` : 'Statutory profile saved.';
          },
        });
        if (res?.ok) setEditing(false);
      }}
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
    >
      {editing ? (
        <StatutoryFields
          value={s}
          onChange={(p) => setS((v) => ({ ...v, ...p }))}
          flags={f}
          onFlagsChange={(p) => setF((v) => ({ ...v, ...p }))}
          errors={r.fieldErrors}
          lhdnBranches={formOptions.lhdnBranches}
          zakatBodies={org.zakatBodies}
          pcbCategoryText={PCB_CATEGORY_LABELS[profile.statutory.pcbCategory]}
          religionWarning={religionKnownNotIslam}
          companyHrdfRegistered={formOptions.settings.companyHrdfRegistered}
        />
      ) : (
        <StatutoryReadOnly s={profile.statutory} flags={profile.employerFlags} />
      )}
    </SectionCard>
  );
}
