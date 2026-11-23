'use client';

// P17 · Request a change — S-PT-17 · /my/profile/change-requests/new?category= · F-EMP-19 · US-EMP-017.
// CR2 Category * (one open CR per category — EC-EMP-07) · CR3 Changes * (Field · Current value
// (masked where sensitive) · New value, using each field's own control and validation) ·
// CR4 Effective date * (default today; marital status may be past-dated ≤ 90 days) ·
// CR5 Supporting document(s) (camera / file, multiple; required per category, label names it) ·
// CR6 Remarks 0/500 · [CANCEL] [SUBMIT REQUEST] → N-43. Success "Request CR-… submitted."
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';
import {
  BANK_ACCOUNT_TYPE_LABELS,
  CHILD_RELATIONSHIP_LABELS,
  CR_CATEGORIES,
  CR_CATEGORY_LABELS,
  CR_DOCUMENT_REQUIRED,
  EPF_RATE_TYPE_LABELS,
  MARITAL_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  RACE_LABELS,
  RELIGION_LABELS,
  SPOUSE_RECORD_STATUS_LABELS,
  SPOUSE_WORKING_STATUS_LABELS,
  STUDY_PCB_CATEGORIES,
  formatMykad,
  type ChangeRequestFormOptions,
  type CrCategory,
  type MyProfile,
  type SubmitChangeRequestInput,
} from '@/server/contracts/employees';
import { submitChangeRequest } from '@/server/actions/employees';
import ErrorSummary from '../../forms/ErrorSummary';
import { CheckboxInput, DateInput, FormGrid, NumberInput, SelectInput, SwitchInput, TextInput } from '../../forms/fields';
import ConfirmDialog from '../../dialogs/ConfirmDialog';
import { useToast } from '../../ToastProvider';
import { MykadInput } from '../fieldGroups';
import { ChildFields, childToForm, type ChildForm } from '../profile/FamilyTab';
import { boolToYesNo, dateOr, newIdempotencyKey, optionsOf, YES_NO_OPTIONS, yesNoToBool } from '../labels';
import { formatBytes, IMAGE_PDF_ACCEPT, uploadChangeRequestFile } from '../upload';
import { addDays, todayMyt } from '@/lib/format';

type Att = { file: File; fileId: string | null; error: string | null; busy: boolean };
type SpouseRow = { id?: string; fullName: string; mykad: string; marriageDate: string; workingStatus: string; isOku: boolean; incomeTaxNo: string; reliefClaimedByEmployee: string; recordStatus: string; currentMasked?: string };
type ChildRow = ChildForm & { id?: string; op: 'add' | 'update' | 'remove'; currentMasked?: string | null };

function Row({ label, current, children }: { label: string; current: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '180px 1fr 1.4fr' }, gap: { xs: 0.5, sm: 2 }, alignItems: 'center', py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography variant="subtitle2">{label}</Typography>
      <Typography variant="body2" color="text.secondary">
        <Box component="span" sx={{ display: { sm: 'none' } }}>
          Current:{' '}
        </Box>
        {current || '—'}
      </Typography>
      <Box>{children}</Box>
    </Box>
  );
}

export default function ChangeRequestForm({
  me,
  initialCategory,
  options,
}: {
  me: MyProfile;
  initialCategory: CrCategory | null;
  /** banks I2, LHDN branches H5, zakat bodies H31 — getChangeRequestFormOptions (every role, Q-F2) */
  options: ChangeRequestFormOptions;
}) {
  const { banks, lhdnBranches, zakatBodies } = options;
  const router = useRouter();
  const toast = useToast();
  const p = me.personal;
  const s = me.statutory;
  const b = me.bank.current;
  const today = todayMyt();
  const [category, setCategory] = React.useState<CrCategory | ''>(initialCategory ?? '');
  const [effectiveDate, setEffectiveDate] = React.useState(today);
  const [remarks, setRemarks] = React.useState('');
  const [atts, setAtts] = React.useState<Att[]>([]);
  const [v, setV] = React.useState<Record<string, string | boolean>>({});
  const [spouses, setSpouses] = React.useState<SpouseRow[]>([]);
  const [children, setChildren] = React.useState<ChildRow[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [guard, setGuard] = React.useState(false);
  const [idem] = React.useState(() => newIdempotencyKey());
  const fileRef = React.useRef<HTMLInputElement>(null);
  const camRef = React.useRef<HTMLInputElement>(null);

  // Pre-fill "new value" inputs with the current values when the category changes.
  React.useEffect(() => {
    setErrors({});
    setError(null);
    setV({
      fullName: p.fullName,
      mykad: '',
      maritalStatus: p.maritalStatus,
      isOku: p.isOku,
      okuCardNo: p.okuCardNo ?? '',
      religion: p.religion ?? '',
      race: p.race ?? '',
      raceOther: p.raceOther ?? '',
      paymentMethod: b?.paymentMethod ?? 'bank_transfer',
      bankId: b?.bank?.id ?? '',
      accountType: b?.accountType ?? '',
      accountNo: '',
      accountHolderName: p.fullName,
      holderNameMismatchAck: false,
      asnbAccountNo: '',
      incomeTaxNo: s.incomeTaxNo ?? '',
      lhdnBranchId: s.lhdnBranch?.id ?? '',
      epfNo: s.epfNo ?? '',
      epfRateType: s.epfRateType,
      epfSpecificRate: s.epfSpecificRate ?? '',
      epfExtraEmployeePct: s.epfExtraEmployeePct ?? '',
      socsoContributedBefore: boolToYesNo(s.socsoContributedBefore),
      payZakat: s.payZakat,
      zakatMonthlyAmount: s.zakatMonthlyAmount ?? '',
      zakatAccountNo: s.zakatAccountNo ?? '',
      zakatBodyId: s.zakatBody?.id ?? '',
      ptptnMonthlyAmount: s.ptptnMonthlyAmount ?? '',
      ptptnStartDate: s.ptptnStartDate ?? '',
      ptptnEndDate: s.ptptnEndDate ?? '',
    });
    setSpouses(
      me.family.spouses.map((x) => ({
        id: x.id,
        fullName: x.fullName,
        mykad: '',
        marriageDate: x.marriageDate ?? '',
        workingStatus: x.workingStatus,
        isOku: x.isOku,
        incomeTaxNo: x.incomeTaxNo ?? '',
        reliefClaimedByEmployee: boolToYesNo(x.reliefClaimedByEmployee),
        recordStatus: x.recordStatus,
        currentMasked: x.nricMasked,
      })),
    );
    setChildren(me.family.children.filter((c) => c.isActive).map((c) => ({ ...childToForm(c), id: c.id, op: 'update', currentMasked: c.nricMasked })));
    setEffectiveDate(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const str = (k: string) => String(v[k] ?? '');
  const bool = (k: string) => Boolean(v[k]);
  const setVal = (k: string, val: string | boolean) => setV((x) => ({ ...x, [k]: val }));
  const openCr = category ? me.openChangeRequests[category] : undefined;
  const docLabel = category ? CR_DOCUMENT_REQUIRED[category] : undefined;
  const minEff = category === 'marital_spouse' ? addDays(today, -90) : today;
  const holderMismatch = str('paymentMethod') === 'bank_transfer' && str('accountHolderName').trim() !== '' && str('accountHolderName').trim().toUpperCase() !== p.fullName.trim().toUpperCase();
  const dirty = category !== '' && (remarks !== '' || atts.length > 0);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const list = Array.from(files).slice(0, 5 - atts.length);
    for (const file of list) {
      setAtts((a) => [...a, { file, fileId: null, error: null, busy: true }]);
      const up = await uploadChangeRequestFile(file);
      setAtts((a) => a.map((x) => (x.file === file ? { ...x, busy: false, fileId: up.ok ? up.fileId : null, error: up.ok ? null : up.error } : x)));
    }
  };

  const payload = (): SubmitChangeRequestInput | null => {
    if (!category) return null;
    const common = { effectiveDate, remarks, fileIds: atts.filter((a) => a.fileId).map((a) => a.fileId!), idempotencyKey: idem };
    switch (category) {
      case 'legal_name':
        return { category, ...common, fullName: str('fullName') };
      case 'mykad':
        return { category, ...common, mykad: str('mykad') };
      case 'marital_spouse':
        return {
          category,
          ...common,
          maritalStatus: str('maritalStatus') as 'single',
          spouses: spouses.map((x) => ({
            id: x.id,
            fullName: x.fullName,
            mykad: x.mykad,
            marriageDate: x.marriageDate,
            workingStatus: x.workingStatus as 'working',
            isOku: x.isOku,
            incomeTaxNo: x.incomeTaxNo,
            reliefClaimedByEmployee: yesNoToBool(x.reliefClaimedByEmployee),
            recordStatus: x.recordStatus as 'current',
          })),
        };
      case 'children':
        return {
          category,
          ...common,
          children: children
            .filter((c) => c.op !== 'update' || c.id === undefined || isChildChanged(c, me))
            .map((c) => ({ ...c, relationship: c.relationship as 'biological', institutionLevel: (STUDY_PCB_CATEGORIES as string[]).includes(c.pcbCategory) ? c.institutionLevel : '' })),
        };
      case 'oku':
        return { category, ...common, isOku: bool('isOku'), okuCardNo: bool('isOku') ? str('okuCardNo') : '' };
      case 'religion':
        return { category, ...common, religion: str('religion') };
      case 'race':
        return { category, ...common, race: str('race'), raceOther: str('race') === 'others' ? str('raceOther') : '' };
      case 'bank_details':
        return {
          category,
          ...common,
          paymentMethod: str('paymentMethod') as 'bank_transfer',
          bankId: str('bankId'),
          accountType: str('accountType'),
          accountNo: str('accountNo'),
          accountHolderName: str('accountHolderName'),
          holderNameMismatchAck: bool('holderNameMismatchAck'),
          asnbAccountNo: str('asnbAccountNo'),
        };
      case 'statutory_numbers':
        return {
          category,
          ...common,
          incomeTaxNo: str('incomeTaxNo'),
          lhdnBranchId: str('lhdnBranchId'),
          epfNo: str('epfNo'),
          epfRateType: str('epfRateType') as 'statutory',
          epfSpecificRate: str('epfRateType') === 'specific' ? str('epfSpecificRate') : '',
          epfExtraEmployeePct: str('epfExtraEmployeePct'),
          socsoContributedBefore: yesNoToBool(str('socsoContributedBefore')),
          payZakat: bool('payZakat'),
          zakatMonthlyAmount: bool('payZakat') ? str('zakatMonthlyAmount') : '',
          zakatAccountNo: bool('payZakat') ? str('zakatAccountNo') : '',
          zakatBodyId: bool('payZakat') ? str('zakatBodyId') : '',
          ptptnMonthlyAmount: str('ptptnMonthlyAmount'),
          ptptnStartDate: str('ptptnStartDate'),
          ptptnEndDate: str('ptptnEndDate'),
        };
    }
  };

  const submit = async () => {
    const pl = payload();
    if (!pl) {
      setErrors({ category: 'Select the category.' });
      return;
    }
    if (openCr) {
      setErrors({ category: `You already have an open request for ${CR_CATEGORY_LABELS[category as CrCategory]} (${openCr}). Cancel it first or wait for HR.` });
      return;
    }
    if (atts.some((a) => a.busy)) {
      setError('Wait for the attachments to finish uploading.');
      return;
    }
    if (category === 'bank_details' && holderMismatch && !bool('holderNameMismatchAck')) {
      setErrors({ holderNameMismatchAck: 'Confirm the holder name differs from your name.' });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await submitChangeRequest(pl);
      if (res.ok) {
        toast.success(`Request ${res.crNo} submitted. HR will review it.`);
        router.push(`/my/profile/change-requests/${encodeURIComponent(res.crNo)}`);
        return;
      }
      setError(res.error);
      setErrors(res.fieldErrors ?? {});
    } catch {
      setError('Something went wrong. Your request was not submitted.');
    }
    setSaving(false);
  };

  const spouseSet = (i: number, x: Partial<SpouseRow>) => setSpouses((l) => l.map((r, j) => (j === i ? { ...r, ...x } : r)));
  const childSet = (i: number, x: Partial<ChildRow>) => setChildren((l) => l.map((r, j) => (j === i ? { ...r, ...x } : r)));
  const e = errors;

  const changes = (() => {
    switch (category) {
      case 'legal_name':
        return (
          <Row label="Full name (as per MyKad)" current={p.fullName}>
            <TextInput label="New full name" required value={str('fullName')} onChange={(x) => setVal('fullName', x)} maxLength={150} error={e.fullName} />
          </Row>
        );
      case 'mykad':
        return (
          <Row label="MyKad (NRIC) no." current={formatMykad(p.nric)}>
            <MykadInput label="New MyKad no." value={str('mykad')} onChange={(x) => setVal('mykad', x)} error={e.mykad} />
          </Row>
        );
      case 'oku':
        return (
          <>
            <Row label="Person with disability (OKU)" current={p.isOku ? 'Yes' : 'No'}>
              <SwitchInput label="OKU" checked={bool('isOku')} onChange={(x) => setVal('isOku', x)} />
            </Row>
            {bool('isOku') && (
              <Row label="OKU card no." current={p.okuCardNo}>
                <TextInput label="OKU card no." required value={str('okuCardNo')} onChange={(x) => setVal('okuCardNo', x)} maxLength={20} error={e.okuCardNo} />
              </Row>
            )}
          </>
        );
      case 'religion':
        return (
          <Row label="Religion" current={p.religion ? RELIGION_LABELS[p.religion] : ''}>
            <SelectInput label="New religion" value={str('religion')} onChange={(x) => setVal('religion', x)} options={optionsOf(RELIGION_LABELS)} emptyLabel="— Not set —" error={e.religion} />
          </Row>
        );
      case 'race':
        return (
          <>
            <Row label="Race" current={p.race ? RACE_LABELS[p.race] : ''}>
              <SelectInput label="New race" value={str('race')} onChange={(x) => setVal('race', x)} options={optionsOf(RACE_LABELS)} emptyLabel="— Not set —" error={e.race} />
            </Row>
            {str('race') === 'others' && (
              <Row label="Race (other)" current={p.raceOther}>
                <TextInput label="Specify" required value={str('raceOther')} onChange={(x) => setVal('raceOther', x)} maxLength={50} error={e.raceOther} />
              </Row>
            )}
          </>
        );
      case 'bank_details':
        return (
          <>
            <Row label="Payment method" current={b ? PAYMENT_METHOD_LABELS[b.paymentMethod] : ''}>
              <SelectInput label="Payment method" required value={str('paymentMethod')} onChange={(x) => setVal('paymentMethod', x)} options={optionsOf(PAYMENT_METHOD_LABELS)} error={e.paymentMethod} />
            </Row>
            {str('paymentMethod') === 'bank_transfer' && (
              <>
                <Row label="Bank" current={b?.bank?.name}>
                  <SelectInput label="Bank" required value={str('bankId')} onChange={(x) => setVal('bankId', x)} options={banks.map((x) => ({ value: x.id, label: x.name, secondary: x.code }))} error={e.bankId} />
                </Row>
                <Row label="Account type" current={b?.accountType ? BANK_ACCOUNT_TYPE_LABELS[b.accountType] : ''}>
                  <SelectInput label="Account type" required value={str('accountType')} onChange={(x) => setVal('accountType', x)} options={optionsOf(BANK_ACCOUNT_TYPE_LABELS)} error={e.accountType} />
                </Row>
                <Row label="Account no." current={b?.accountNoMasked}>
                  <TextInput label="New account no." required value={str('accountNo')} onChange={(x) => setVal('accountNo', x.replace(/\D/g, '').slice(0, 20))} inputMode="numeric" autoComplete="off" error={e.accountNo} helper="Digits only, 6–20." />
                </Row>
                <Row label="Account holder name" current={b?.accountHolderName}>
                  <TextInput label="Account holder name" required value={str('accountHolderName')} onChange={(x) => setV((o) => ({ ...o, accountHolderName: x, holderNameMismatchAck: false }))} maxLength={150} error={e.accountHolderName} />
                  {holderMismatch && (
                    <Alert severity="warning" variant="outlined" sx={{ mt: 1 }}>
                      Holder name differs from your name — joint or third-party accounts are discouraged.
                      <CheckboxInput label="Continue anyway" checked={bool('holderNameMismatchAck')} onChange={(x) => setVal('holderNameMismatchAck', x)} error={e.holderNameMismatchAck} />
                    </Alert>
                  )}
                </Row>
              </>
            )}
            <Row label="ASNB account no." current={b?.asnbMasked}>
              <TextInput label="New ASNB account no." value={str('asnbAccountNo')} onChange={(x) => setVal('asnbAccountNo', x.replace(/\D/g, '').slice(0, 20))} inputMode="numeric" autoComplete="off" error={e.asnbAccountNo} helper="Optional — leave blank to keep." />
            </Row>
          </>
        );
      case 'statutory_numbers':
        return (
          <>
            <Row label="Income tax no." current={s.incomeTaxNo}>
              <TextInput label="Income tax no." value={str('incomeTaxNo')} onChange={(x) => setVal('incomeTaxNo', x.toUpperCase())} maxLength={14} error={e.incomeTaxNo} />
            </Row>
            <Row label="LHDN state / branch" current={s.lhdnBranch?.label}>
              <SelectInput label="LHDN branch" value={str('lhdnBranchId')} onChange={(x) => setVal('lhdnBranchId', x)} options={lhdnBranches.map((x) => ({ value: x.id, label: x.label }))} emptyLabel="— Not set —" error={e.lhdnBranchId} />
            </Row>
            <Row label="EPF no." current={s.epfNo}>
              <TextInput label="EPF no." value={str('epfNo')} onChange={(x) => setVal('epfNo', x.replace(/\D/g, '').slice(0, 9))} inputMode="numeric" error={e.epfNo} />
            </Row>
            <Row label="Employee EPF rate" current={EPF_RATE_TYPE_LABELS[s.epfRateType]}>
              <Stack direction="row" spacing={1}>
                <SelectInput label="EPF rate" value={str('epfRateType')} onChange={(x) => setVal('epfRateType', x)} options={optionsOf(EPF_RATE_TYPE_LABELS)} />
                {str('epfRateType') === 'specific' && <NumberInput label="Rate" required value={str('epfSpecificRate')} onChange={(x) => setVal('epfSpecificRate', x)} min={0} max={89} step={0.1} suffix="%" error={e.epfSpecificRate} />}
              </Stack>
            </Row>
            <Row label="Extra employee EPF %" current={s.epfExtraEmployeePct ? `${s.epfExtraEmployeePct}%` : ''}>
              <NumberInput label="Extra employee EPF %" value={str('epfExtraEmployeePct')} onChange={(x) => setVal('epfExtraEmployeePct', x)} min={0} max={89} step={0.1} suffix="%" error={e.epfExtraEmployeePct} />
            </Row>
            <Row label="Contributed to SOCSO before" current={s.socsoContributedBefore === null ? '' : s.socsoContributedBefore ? 'Yes' : 'No'}>
              <SelectInput label="Contributed before" value={str('socsoContributedBefore')} onChange={(x) => setVal('socsoContributedBefore', x)} options={YES_NO_OPTIONS} emptyLabel="— Not set —" />
            </Row>
            <Row label="Pay zakat via payroll" current={s.payZakat ? 'Yes' : 'No'}>
              <SwitchInput label="Pay zakat via payroll" checked={bool('payZakat')} onChange={(x) => setVal('payZakat', x)} />
            </Row>
            {bool('payZakat') && (
              <>
                <Row label="Zakat monthly amount (RM)" current={s.zakatMonthlyAmount}>
                  <TextInput label="Amount (RM)" required value={str('zakatMonthlyAmount')} onChange={(x) => setVal('zakatMonthlyAmount', x)} inputMode="decimal" error={e.zakatMonthlyAmount} />
                </Row>
                <Row label="Zakat account / reference no." current={s.zakatAccountNo}>
                  <TextInput label="Account / reference no." required value={str('zakatAccountNo')} onChange={(x) => setVal('zakatAccountNo', x)} maxLength={30} error={e.zakatAccountNo} />
                </Row>
                <Row label="Zakat authority" current={s.zakatBody?.label}>
                  <SelectInput label="Zakat authority" value={str('zakatBodyId')} onChange={(x) => setVal('zakatBodyId', x)} options={zakatBodies.map((z) => ({ value: z.id, label: z.label }))} emptyLabel="— Default: work state —" />
                </Row>
              </>
            )}
            <Row label="PTPTN monthly deduction (RM)" current={s.ptptnMonthlyAmount}>
              <TextInput label="Amount (RM)" value={str('ptptnMonthlyAmount')} onChange={(x) => setVal('ptptnMonthlyAmount', x)} inputMode="decimal" error={e.ptptnMonthlyAmount} />
            </Row>
            {Number(str('ptptnMonthlyAmount')) > 0 && (
              <Row label="PTPTN start / end" current={s.ptptnStartDate ? `${dateOr(s.ptptnStartDate)} – ${dateOr(s.ptptnEndDate)}` : ''}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <DateInput label="Start" required value={str('ptptnStartDate')} onChange={(x) => setVal('ptptnStartDate', x)} error={e.ptptnStartDate} />
                  <DateInput label="End" required value={str('ptptnEndDate')} onChange={(x) => setVal('ptptnEndDate', x)} error={e.ptptnEndDate} />
                </Stack>
              </Row>
            )}
          </>
        );
      case 'marital_spouse':
        return (
          <>
            <Row label="Marital status" current={MARITAL_STATUS_LABELS[p.maritalStatus]}>
              <SelectInput label="New marital status" required value={str('maritalStatus')} onChange={(x) => setVal('maritalStatus', x)} options={optionsOf(MARITAL_STATUS_LABELS)} error={e.maritalStatus} />
            </Row>
            {spouses.map((sp, i) => (
              <Box key={sp.id ?? `n${i}`} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2, mt: 2 }}>
                <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                    Spouse {i + 1}
                    {sp.id ? '' : ' (new)'}
                  </Typography>
                  {!sp.id && (
                    <IconButton size="small" aria-label="Remove new spouse" onClick={() => setSpouses((l) => l.filter((_, j) => j !== i))}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
                <FormGrid>
                  <TextInput label="Full name (as per MyKad)" required value={sp.fullName} onChange={(x) => spouseSet(i, { fullName: x })} maxLength={150} error={e[`spouses.${i}.fullName`]} />
                  <MykadInput label="Spouse MyKad no." required={!sp.id} value={sp.mykad} onChange={(x) => spouseSet(i, { mykad: x })} error={e[`spouses.${i}.mykad`]} helper={sp.currentMasked ? `Current ${sp.currentMasked} — leave blank to keep.` : undefined} />
                  <DateInput label="Date of marriage" value={sp.marriageDate} onChange={(x) => spouseSet(i, { marriageDate: x })} maxDate={today} />
                  <SelectInput label="Working status" required value={sp.workingStatus} onChange={(x) => spouseSet(i, { workingStatus: x })} options={optionsOf(SPOUSE_WORKING_STATUS_LABELS)} error={e[`spouses.${i}.workingStatus`]} />
                  <SwitchInput label="Spouse disabled (OKU)" checked={sp.isOku} onChange={(x) => spouseSet(i, { isOku: x })} />
                  <TextInput label="Spouse income tax no." value={sp.incomeTaxNo} onChange={(x) => spouseSet(i, { incomeTaxNo: x.toUpperCase() })} maxLength={20} error={e[`spouses.${i}.incomeTaxNo`]} />
                  {sp.workingStatus === 'not_working' && <SelectInput label="I claim spouse relief (R1.1)" value={sp.reliefClaimedByEmployee} onChange={(x) => spouseSet(i, { reliefClaimedByEmployee: x })} options={YES_NO_OPTIONS} emptyLabel="— Not set —" />}
                  <SelectInput label="Record status" value={sp.recordStatus} onChange={(x) => spouseSet(i, { recordStatus: x })} options={optionsOf(SPOUSE_RECORD_STATUS_LABELS)} helper="Former after divorce or death." />
                </FormGrid>
              </Box>
            ))}
            {spouses.filter((x) => x.recordStatus === 'current').length < 4 && (
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                sx={{ mt: 2 }}
                onClick={() => setSpouses((l) => [...l, { fullName: '', mykad: '', marriageDate: '', workingStatus: '', isOku: false, incomeTaxNo: '', reliefClaimedByEmployee: '', recordStatus: 'current' }])}
              >
                Add spouse
              </Button>
            )}
          </>
        );
      case 'children':
        return (
          <>
            {errors.children && <Alert severity="error">{errors.children}</Alert>}
            {children.map((c, i) => (
              <Box key={c.id ?? `n${i}`} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2, mt: 2, opacity: c.op === 'remove' ? 0.6 : 1 }}>
                <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                    {c.op === 'add' ? 'New child' : c.fullName || `Child ${i + 1}`}
                    {c.op === 'remove' ? ' — will be removed' : ''}
                  </Typography>
                  {c.op === 'add' ? (
                    <IconButton size="small" aria-label="Remove new child" onClick={() => setChildren((l) => l.filter((_, j) => j !== i))}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  ) : (
                    <Button size="small" color={c.op === 'remove' ? 'primary' : 'error'} onClick={() => childSet(i, { op: c.op === 'remove' ? 'update' : 'remove' })}>
                      {c.op === 'remove' ? 'Keep' : 'Remove'}
                    </Button>
                  )}
                </Stack>
                {c.op !== 'remove' && (
                  <ChildFields
                    f={c}
                    set={(x) => childSet(i, x)}
                    errors={Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith(`children.${i}.`)).map(([k, val]) => [k.slice(`children.${i}.`.length), val]))}
                    editing={c.currentMasked}
                  />
                )}
              </Box>
            ))}
            <Button variant="outlined" startIcon={<AddIcon />} sx={{ mt: 2 }} onClick={() => setChildren((l) => [...l, { ...childToForm(null), op: 'add' }])}>
              Add child
            </Button>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
              Relationships: {Object.values(CHILD_RELATIONSHIP_LABELS).join(' / ')}.
            </Typography>
          </>
        );
      default:
        return <Typography color="text.secondary">Choose a category to see the fields you can change.</Typography>;
    }
  })();

  return (
    <Stack spacing={2}>
      <ErrorSummary error={error} fieldErrors={Object.keys(errors).length ? errors : undefined} title="Can't submit yet" labels={{ category: 'Category', fileIds: 'Supporting document', effectiveDate: 'Effective date' }} />
      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <FormGrid>
            <SelectInput
              label="Category"
              required
              value={category}
              onChange={(x) => setCategory(x as CrCategory)}
              options={CR_CATEGORIES.map((c) => ({ value: c, label: CR_CATEGORY_LABELS[c], secondary: me.openChangeRequests[c] ? `open: ${me.openChangeRequests[c]}` : undefined }))}
              error={errors.category}
            />
            <DateInput
              label="Effective date"
              required
              value={effectiveDate}
              onChange={setEffectiveDate}
              minDate={minEff}
              maxDate={addDays(today, 90)}
              error={errors.effectiveDate}
              helper={category === 'marital_spouse' ? 'May be up to 90 days in the past.' : 'Default today.'}
            />
          </FormGrid>
          {openCr && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              You already have an open request for {CR_CATEGORY_LABELS[category as CrCategory]} (
              <Link component={NextLink} href={`/my/profile/change-requests/${encodeURIComponent(openCr)}`}>
                {openCr}
              </Link>
              ). Cancel it first or wait for HR.
            </Alert>
          )}
        </CardContent>
      </Card>
      {category && !openCr && (
        <>
          <Card>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
                Changes
              </Typography>
              <Box sx={{ display: { xs: 'none', sm: 'grid' }, gridTemplateColumns: '180px 1fr 1.4fr', gap: 2, pb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary">
                  Field
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Current value
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  New value
                </Typography>
              </Box>
              {changes}
            </CardContent>
          </Card>
          <Card>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
                Supporting document{docLabel ? ' *' : 's'}
              </Typography>
              <Typography variant="body2" color={errors.fileIds ? 'error' : 'text.secondary'} sx={{ mb: 1.5 }}>
                {errors.fileIds ?? (docLabel ? `Required: ${docLabel}.` : 'Optional.')} PDF, JPG, PNG or HEIC, up to 10 MB each, at most 5.
              </Typography>
              <Stack spacing={1}>
                {atts.map((a, i) => (
                  <Stack key={`${a.file.name}-${i}`} direction="row" spacing={1} alignItems="center">
                    <AttachFileIcon fontSize="small" />
                    <Typography variant="body2" sx={{ flexGrow: 1 }}>
                      {a.file.name} · {formatBytes(a.file.size)} {a.busy ? '· uploading…' : a.error ? `· ${a.error}` : '· ✓'}
                    </Typography>
                    <IconButton size="small" aria-label={`Remove ${a.file.name}`} onClick={() => setAtts((l) => l.filter((_, j) => j !== i))}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
              {atts.length < 5 && (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                  <Button variant="outlined" startIcon={<PhotoCameraOutlinedIcon />} onClick={() => camRef.current?.click()} sx={{ minHeight: 44 }}>
                    Take photo
                  </Button>
                  <Button variant="outlined" startIcon={<AttachFileIcon />} onClick={() => fileRef.current?.click()} sx={{ minHeight: 44 }}>
                    Choose file
                  </Button>
                </Stack>
              )}
              <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(ev) => void addFiles(ev.target.files).then(() => (ev.target.value = ''))} />
              <input ref={fileRef} type="file" accept={IMAGE_PDF_ACCEPT} multiple hidden onChange={(ev) => void addFiles(ev.target.files).then(() => (ev.target.value = ''))} />
              <Box sx={{ mt: 2 }}>
                <TextInput label="Remarks" value={remarks} onChange={setRemarks} maxLength={500} multiline minRows={2} error={errors.remarks} />
              </Box>
            </CardContent>
          </Card>
        </>
      )}
      <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ position: { xs: 'sticky', sm: 'static' }, bottom: { xs: 'var(--pret-bottom-bar, 0px)', sm: 0 }, bgcolor: { xs: 'background.default', sm: 'transparent' }, py: { xs: 1.5, sm: 0 }, zIndex: 1 }}>
        <Button variant="outlined" color="inherit" onClick={() => (dirty ? setGuard(true) : router.push('/my/profile/change-requests'))} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} loading={saving} disabled={!category || Boolean(openCr)} sx={{ flexGrow: { xs: 1, sm: 0 } }}>
          Submit request
        </Button>
      </Stack>
      <ConfirmDialog open={guard} title="Discard unsaved changes?" confirmLabel="Discard" cancelLabel="Keep editing" destructive onClose={() => setGuard(false)} onConfirm={() => router.push('/my/profile/change-requests')} />
    </Stack>
  );
}

function isChildChanged(c: ChildRow, me: MyProfile): boolean {
  const o = me.family.children.find((x) => x.id === c.id);
  if (!o) return true;
  const f = childToForm(o);
  return c.mykad !== '' || (Object.keys(f) as (keyof ChildForm)[]).some((k) => k !== 'mykad' && f[k] !== c[k]);
}
