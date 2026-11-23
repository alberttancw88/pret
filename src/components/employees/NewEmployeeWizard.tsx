'use client';

// E2 · New employee — S-EM-02 · /employees/new · F-EMP-02/04/05/06/07/09/14/16 · US-EMP-001, 002.
// Stepper: (1 Identity) — (2 Contact & emergency) — (3 Employment) — (4 Statutory & bank) —
// (5 Opening leave — F-LV-35, W2-004) — (6 Review & invite). NEXT validates the step (contract zod
// schema, the same one the server uses); BACK keeps data; CREATE EMPLOYEE only on step 6 —
// the record is created atomically. Steps 4 and 5 may be skipped.
// Photo (A16) and bank proof (I6) need the new employee id for the private Storage path, so
// they are uploaded right after the record is created (then setEmployeePhoto / saveBankDetails).
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Step from '@mui/material/Step';
import StepButton from '@mui/material/StepButton';
import Stepper from '@mui/material/Stepper';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import {
  BANK_ACCOUNT_TYPE_LABELS,
  CONTACT_RELATIONSHIP_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  GENDER_LABELS,
  MARITAL_STATUS_LABELS,
  MY_STATE_LABELS,
  PAYMENT_METHOD_LABELS,
  QUALIFICATION_LABELS,
  RACE_LABELS,
  RELIGION_LABELS,
  checkMykad,
  createEmployeeSchema,
  formatMykad,
  joinAgeCheck,
  type CheckMykadResult,
  type EmployeeFormOptions,
} from '@/server/contracts/employees';
import type { OrgOptions } from '@/server/contracts/org';
import { checkMykadAction, createEmployee, saveBankDetails, setEmployeePhoto } from '@/server/actions/employees';
import ErrorSummary from '../forms/ErrorSummary';
import { DateInput, RadioInput } from '../forms/fields';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import { useToast } from '../ToastProvider';
import {
  BankFields,
  ContactFields,
  EMPTY_CONTACT,
  EMPTY_FLAGS,
  EMPTY_IDENTITY,
  EMPTY_STATUTORY,
  EmergencyContactsEditor,
  EMPTY_EMERGENCY,
  EmploymentFields,
  FileField,
  IdentityFields,
  MykadInput,
  StatutoryFields,
  bankFilled,
  bankPayload,
  contactPayload,
  emergencyPayload,
  emptyBank,
  emptyEmployment,
  employmentPayload,
  flagsPayload,
  identityPayload,
  probationEnd,
  statutoryPayload,
  type BankForm,
  type ContactForm,
  type EmergencyForm,
  type EmploymentForm,
  type FlagsForm,
  type IdentityForm,
  type StatutoryForm,
} from './fieldGroups';
import { KVGrid } from './ui';
import { addressText, newIdempotencyKey, yesNo } from './labels';
import { PHOTO_ACCEPT, uploadEmployeeFile } from './upload';
import { addDays, formatDate, todayMyt } from '@/lib/format';
import type { OpeningLeaveForm } from '@/server/contracts/leave';
import OpeningLeaveStep, { EMPTY_OPENING, openingLeavePayload, type OpeningLeaveValue } from '../leave/OpeningLeaveStep';
import { stickyBarSx } from '../forms/stickyBar';

const STEPS = ['Identity', 'Contact & emergency', 'Employment', 'Statutory & bank', 'Opening leave', 'Review & invite'];
const STEP_PREFIX: string[][] = [['identity'], ['contact', 'emergencyContacts'], ['employment'], ['statutory', 'employerFlags', 'bank'], ['openingLeave'], ['invite']];
const PLACEHOLDER_UUID = '00000000-0000-4000-8000-000000000000';

const LABELS: Record<string, string> = {
  'identity.mykad': 'MyKad', 'identity.fullName': 'Full name', 'identity.dateOfBirth': 'Date of birth', 'identity.gender': 'Gender',
  'identity.maritalStatus': 'Marital status', 'identity.maritalEffectiveDate': 'Marital status effective date', 'identity.raceOther': 'Race (other)',
  'identity.okuCardNo': 'OKU card no.', 'identity.passportExpiry': 'Passport expiry', 'identity.dobOverrideConfirmed': 'Date of birth override',
  'identity.genderOverrideConfirmed': 'Gender override', 'contact.workEmail': 'Work email', 'contact.personalEmail': 'Personal email',
  'contact.mobilePhone': 'Mobile phone', 'employment.joinDate': 'Join date', 'employment.departmentId': 'Department', 'employment.positionId': 'Position',
  'employment.gradeId': 'Grade', 'employment.managerId': 'Reporting manager', 'employment.workLocationId': 'Work location',
  'employment.workingPatternId': 'Working-week pattern', 'emergencyContacts': 'Emergency contacts',
};

/** zod issues → dotted field-error map (same keys as the server's fieldErrors). */
function issuesToErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = i.path.map(String).join('.');
    if (!out[k]) out[k] = i.message;
  }
  return out;
}
const sub = (errors: Record<string, string>, prefix: string) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) if (k.startsWith(prefix + '.')) out[k.slice(prefix.length + 1)] = v;
  return out;
};

export default function NewEmployeeWizard({
  org,
  formOptions,
  isSuperAdmin,
}: {
  org: OrgOptions;
  formOptions: EmployeeFormOptions;
  isSuperAdmin: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const today = todayMyt();
  const s = formOptions.settings;

  const [step, setStep] = React.useState(0);
  const [identity, setIdentity] = React.useState<IdentityForm>(EMPTY_IDENTITY);
  const [photo, setPhoto] = React.useState<File | null>(null);
  const [contact, setContact] = React.useState<ContactForm>(EMPTY_CONTACT);
  const [contacts, setContacts] = React.useState<EmergencyForm[]>([{ ...EMPTY_EMERGENCY }]);
  const [employment, setEmployment] = React.useState<EmploymentForm>(emptyEmployment(s.defaultProbationMonths));
  const [statutory, setStatutory] = React.useState<StatutoryForm>(EMPTY_STATUTORY);
  const [flags, setFlags] = React.useState<FlagsForm>({ ...EMPTY_FLAGS });
  const [bank, setBank] = React.useState<BankForm>(emptyBank(today));
  const [opening, setOpening] = React.useState<OpeningLeaveValue>(EMPTY_OPENING);
  const [openingForm, setOpeningForm] = React.useState<OpeningLeaveForm | null>(null);
  const [inviteMode, setInviteMode] = React.useState<'now' | 'scheduled' | 'later'>('scheduled');
  const [inviteDate, setInviteDate] = React.useState('');
  const [mykadInfo, setMykadInfo] = React.useState<CheckMykadResult | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [guard, setGuard] = React.useState(false);
  const [idem] = React.useState(() => newIdempotencyKey());
  const [visited, setVisited] = React.useState<Set<number>>(new Set([0]));

  const dirty = identity.mykad !== '' || identity.fullName !== '' || contact.workEmail !== '';
  React.useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty && !saving) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, saving]);

  // Default invite date = join date − lead days (not before today).
  const defaultInviteDate = employment.joinDate ? (addDays(employment.joinDate, -s.inviteLeadDays) < today ? today : addDays(employment.joinDate, -s.inviteLeadDays)) : '';
  const effectiveInviteDate = inviteDate || defaultInviteDate;

  const positionDefaults = React.useMemo(() => ({}) as Record<string, { departmentId: string | null; gradeId: string | null }>, []);
  const derived = React.useMemo(() => {
    const c = checkMykad(identity.mykad);
    return c.ok ? { dateOfBirth: c.dateOfBirth, gender: c.gender } : { dateOfBirth: null, gender: null };
  }, [identity.mykad]);

  const onMykadBlur = async () => {
    const c = checkMykad(identity.mykad);
    if (!identity.mykad) return;
    if (!c.ok) {
      setErrors((e) => ({ ...e, 'identity.mykad': c.error ?? 'Invalid MyKad.' }));
      setMykadInfo(null);
      return;
    }
    // pre-fill DOB and gender when empty (BR-EMP-02/04)
    setIdentity((v) => ({
      ...v,
      mykad: formatMykad(c.digits),
      dateOfBirth: v.dateOfBirth || c.dateOfBirth || '',
      gender: v.gender || c.gender || '',
    }));
    try {
      const res = await checkMykadAction({ mykad: c.digits });
      if (res.ok) {
        setMykadInfo(res);
        setErrors((e) => {
          const n = { ...e };
          if (res.duplicate) n['identity.mykad'] = `MyKad already exists for ${res.duplicate.employeeNo}.`;
          else delete n['identity.mykad'];
          return n;
        });
      }
    } catch {
      /* duplicate check runs again on save */
    }
  };

  const buildPayload = (forValidation = false) => ({
    identity: { ...identityPayload(identity), photoFileId: null },
    contact: contactPayload(contact),
    emergencyContacts: emergencyPayload(contacts),
    employment: employmentPayload(employment, isSuperAdmin),
    statutory: statutoryPayload(statutory),
    employerFlags: flagsPayload(flags),
    ...(forValidation && bankFilled(bank) ? { bank: bankPayload(bank, bank.proof ? PLACEHOLDER_UUID : null) } : {}),
    invite: { mode: inviteMode, scheduledSendDate: inviteMode === 'scheduled' ? effectiveInviteDate : null },
    openingLeave: openingLeavePayload(opening, openingForm),
    idempotencyKey: idem,
  });

  const validateStep = (k: number): Record<string, string> => {
    const parsed = createEmployeeSchema.safeParse(buildPayload(true));
    let errs: Record<string, string> = parsed.success ? {} : issuesToErrors(parsed.error.issues);
    const prefixes = STEP_PREFIX[k] ?? [];
    errs = Object.fromEntries(Object.entries(errs).filter(([key]) => prefixes.some((p) => key === p || key.startsWith(p + '.'))));
    if (k === 0) {
      if (mykadInfo?.duplicate) errs['identity.mykad'] = `MyKad already exists for ${mykadInfo.duplicate.employeeNo}.`;
      if (photo && !['image/jpeg', 'image/png'].includes(photo.type)) errs['identity.photo'] = 'Upload a JPG or PNG photo.';
      else if (photo && photo.size > 5 * 1024 * 1024) errs['identity.photo'] = 'The photo must be 5 MB or smaller.';
    }
    if (k === 2 && identity.dateOfBirth && employment.joinDate && joinAgeCheck(identity.dateOfBirth, employment.joinDate).block)
      errs['employment.joinDate'] = 'Employee must be at least 15 at the join date.';
    if (k === 2 && employment.joinDate && employment.joinDate > addDays(today, 366)) errs['employment.joinDate'] = 'Join date can be at most 12 months ahead.';
    return errs;
  };

  const go = (target: number) => {
    setServerError(null);
    if (target > step) {
      for (let k = step; k < target; k++) {
        if (k === 3 || k === 4) continue; // skippable
        const e = validateStep(k);
        if (Object.keys(e).length) {
          setErrors(e);
          setStep(k);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
      }
      if (step === 3) {
        const e = validateStep(3);
        if (Object.keys(e).length) {
          setErrors(e);
          return;
        }
      }
    }
    setErrors({});
    setStep(target);
    setVisited((v) => new Set([...v, target]));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const create = async () => {
    for (const k of [0, 1, 2, 3]) {
      const e = validateStep(k);
      if (Object.keys(e).length) {
        setErrors(e);
        setStep(k);
        return;
      }
    }
    setSaving(true);
    setServerError(null);
    try {
      const res = await createEmployee(buildPayload(false));
      if (!res.ok) {
        const fe = res.fieldErrors ?? {};
        setServerError(res.error);
        setErrors(fe);
        const first = STEP_PREFIX.findIndex((ps) => Object.keys(fe).some((key) => ps.some((p) => key === p || key.startsWith(p + '.'))));
        if (first >= 0) setStep(first);
        setSaving(false);
        return;
      }
      const warnings: string[] = [...res.warnings];
      if (photo) {
        const up = await uploadEmployeeFile(res.employeeId, 'photo', photo);
        const set = up.ok ? await setEmployeePhoto({ employeeId: res.employeeId, fileId: up.fileId }) : null;
        if (!up.ok || !set?.ok) warnings.push('The photo could not be saved — add it from the profile.');
      }
      if (bankFilled(bank)) {
        // createEmployee does not store bank details: upload the proof with the new id, then saveBankDetails.
        let proofId: string | null = null;
        let proofError: string | null = null;
        if (bank.proof) {
          const up = await uploadEmployeeFile(res.employeeId, 'bank_proof', bank.proof);
          if (up.ok) proofId = up.fileId;
          else proofError = up.error;
        }
        if (proofError) warnings.push(`The bank proof could not be uploaded (${proofError}) — add the bank details from the Bank tab.`);
        else {
          const b = await saveBankDetails({ employeeId: res.employeeId, bank: bankPayload(bank, proofId) });
          if (!b.ok) warnings.push(`Bank details were not saved (${b.error}) — add them from the Bank tab.`);
        }
      }
      const statusText = EMPLOYMENT_STATUS_LABELS[res.status];
      const inviteText =
        res.invite.mode === 'now'
          ? res.invite.emailSent
            ? 'invite sent'
            : 'invite created (email not sent)'
          : res.invite.mode === 'scheduled' && res.invite.scheduledFor
            ? `invite scheduled ${formatDate(res.invite.scheduledFor)}`
            : 'no invite scheduled';
      toast.success(`${res.employeeNo} created · status ${statusText} · ${inviteText}.`);
      if (warnings.length) toast.info(warnings.join(' '));
      router.push(`/employees/${encodeURIComponent(res.employeeNo)}`);
    } catch {
      setServerError('Something went wrong. The employee was not created.');
      setSaving(false);
    }
  };

  const idErr = sub(errors, 'identity');
  const age = identity.dateOfBirth && employment.joinDate ? joinAgeCheck(identity.dateOfBirth, employment.joinDate) : null;
  const deptLabel = (id: string) => org.departments.find((d) => d.id === id)?.label ?? '';
  const posLabel = (id: string) => org.positions.find((d) => d.id === id)?.label ?? '';
  const gradeLabel = (id: string) => org.grades.find((d) => d.id === id)?.label ?? '';
  const loc = org.locations.find((l) => l.id === employment.workLocationId);
  const patternLabel = org.workingPatterns.find((p) => p.id === employment.workingPatternId)?.label ?? '';
  const missingPayroll = [!statutory.incomeTaxNo && 'Tax no.', !statutory.epfNo && 'EPF no.', bank.paymentMethod === 'bank_transfer' && !bank.accountNo && 'Bank account'].filter(Boolean) as string[];

  const EditLink = ({ to }: { to: number }) => (
    <Link component="button" type="button" onClick={() => go(to)} sx={{ ml: 1 }}>
      Edit
    </Link>
  );

  const stepBody = (() => {
    switch (step) {
      case 0:
        return (
          <IdentityFields
            value={identity}
            onChange={(p) => setIdentity((v) => ({ ...v, ...p }))}
            errors={idErr}
            derived={derived}
            mykadSlot={
              <Box>
                <MykadInput
                  value={identity.mykad}
                  onChange={(v) => {
                    setIdentity((x) => ({ ...x, mykad: v }));
                    setMykadInfo(null);
                  }}
                  onBlur={onMykadBlur}
                  error={idErr.mykad}
                  helper={mykadInfo?.warnings[0]}
                />
                {mykadInfo?.duplicate && (
                  <Alert severity="error" variant="outlined" sx={{ mt: 1 }}>
                    MyKad already exists for {mykadInfo.duplicate.employeeNo} ({mykadInfo.duplicate.name}, {EMPLOYMENT_STATUS_LABELS[mykadInfo.duplicate.status]}).
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                      <Button size="small" variant="outlined" component={NextLink} href={`/employees/${encodeURIComponent(mykadInfo.duplicate.employeeNo)}`}>
                        Open
                      </Button>
                      {mykadInfo.duplicate.canRehire && (
                        <Button size="small" variant="contained" component={NextLink} href={`/employees/${encodeURIComponent(mykadInfo.duplicate.employeeNo)}/rehire`}>
                          Rehire this person
                        </Button>
                      )}
                    </Stack>
                  </Alert>
                )}
              </Box>
            }
            photoSlot={<FileField label="Photo" file={photo} onChange={setPhoto} accept={PHOTO_ACCEPT} error={idErr.photo} helper="JPG or PNG, up to 5 MB; shown square." />}
          />
        );
      case 1:
        return (
          <Stack spacing={3}>
            <ContactFields value={contact} onChange={(p) => setContact((v) => ({ ...v, ...p }))} errors={sub(errors, 'contact')} allowedDomains={s.allowedEmailDomains} />
            <Box>
              <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
                Emergency contacts
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                At least one, up to three. Order sets the priority.
              </Typography>
              <EmergencyContactsEditor rows={contacts} onChange={setContacts} errors={errors} prefix="emergencyContacts." />
            </Box>
          </Stack>
        );
      case 2:
        return (
          <Stack spacing={2}>
            {age?.warn && <Alert severity="warning">Employee will be under 18 at join date.</Alert>}
            <EmploymentFields
              value={employment}
              onChange={(p) => setEmployment((v) => ({ ...v, ...p }))}
              errors={sub(errors, 'employment')}
              opts={{ org, employeeNoPreview: s.employeeNoPreview, maxProbationMonths: s.maxProbationMonths, positionDefaults }}
              isSuperAdmin={isSuperAdmin}
            />
          </Stack>
        );
      case 3:
        return (
          <Stack spacing={3}>
            <Alert severity="info" variant="outlined">
              Optional in Release 1.0 — required before the employee&apos;s first PRET payroll. Defaults are pre-filled. You can skip this step.
            </Alert>
            <StatutoryFields
              value={statutory}
              onChange={(p) => setStatutory((v) => ({ ...v, ...p }))}
              flags={flags}
              onFlagsChange={(p) => setFlags((v) => ({ ...v, ...p }))}
              errors={{ ...sub(errors, 'statutory'), ...Object.fromEntries(Object.entries(sub(errors, 'employerFlags')).map(([k, v]) => [`employerFlags.${k}`, v])) }}
              lhdnBranches={formOptions.lhdnBranches}
              zakatBodies={org.zakatBodies}
              religionWarning={identity.religion !== '' && identity.religion !== 'islam'}
              companyHrdfRegistered={s.companyHrdfRegistered}
            />
            <Box>
              <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
                Bank
              </Typography>
              <BankFields value={bank} onChange={(p) => setBank((v) => ({ ...v, ...p }))} errors={sub(errors, 'bank')} banks={formOptions.banks} employeeFullName={identity.fullName} />
            </Box>
          </Stack>
        );
      case 4:
        return (
          <OpeningLeaveStep
            joinDate={employment.joinDate}
            continuousServiceDate={employment.continuousServiceDate}
            gradeId={employment.gradeId}
            gender={identity.gender}
            value={opening}
            onChange={setOpening}
            onForm={setOpeningForm}
            errors={sub(errors, 'openingLeave')}
          />
        );
      default:
        return (
          <Stack spacing={3}>
            <Box>
              <Typography variant="h6" component="h3">
                Identity <EditLink to={0} />
              </Typography>
              <KVGrid
                items={[
                  { label: 'MyKad', value: formatMykad(identity.mykad) },
                  { label: 'Full name', value: identity.fullName },
                  { label: 'Preferred name', value: identity.preferredName },
                  { label: 'Date of birth', value: formatDate(identity.dateOfBirth) },
                  { label: 'Gender', value: identity.gender ? GENDER_LABELS[identity.gender as 'male'] : '' },
                  { label: 'Race', value: identity.race ? RACE_LABELS[identity.race as 'malay'] + (identity.raceOther ? ` (${identity.raceOther})` : '') : '' },
                  { label: 'Religion', value: identity.religion ? RELIGION_LABELS[identity.religion as 'islam'] : '' },
                  { label: 'Marital status', value: MARITAL_STATUS_LABELS[identity.maritalStatus as 'single'] + (identity.maritalEffectiveDate ? ` from ${formatDate(identity.maritalEffectiveDate)}` : '') },
                  { label: 'OKU', value: identity.isOku ? `Yes (${identity.okuCardNo})` : 'No' },
                  { label: 'Passport', value: identity.passportNo ? `${identity.passportNo} · expires ${formatDate(identity.passportExpiry)}` : '' },
                  { label: 'Highest qualification', value: identity.highestQualification ? QUALIFICATION_LABELS[identity.highestQualification as 'spm'] : '' },
                  { label: 'Photo', value: photo?.name ?? '' },
                ]}
              />
            </Box>
            <Box>
              <Typography variant="h6" component="h3">
                Contact & emergency <EditLink to={1} />
              </Typography>
              <KVGrid
                items={[
                  { label: 'Work email', value: contact.workEmail },
                  { label: 'Personal email', value: contact.personalEmail },
                  { label: 'Mobile', value: contact.mobilePhone },
                  { label: 'Work phone', value: contact.workPhone },
                  { label: 'Residential address', value: addressText({ ...contact.residential, state: contact.residential.state as 'SGR', line2: contact.residential.line2 || null, line3: contact.residential.line3 || null }), full: true },
                  { label: 'Mailing address', value: contact.mailingSame ? 'Same as residential' : addressText({ ...contact.mailing, state: contact.mailing.state as 'SGR', line2: contact.mailing.line2 || null, line3: contact.mailing.line3 || null }), full: true },
                  {
                    label: 'Emergency contacts',
                    full: true,
                    value: contacts.map((c, i) => `${i + 1}. ${c.name} (${c.relationship ? CONTACT_RELATIONSHIP_LABELS[c.relationship as 'spouse'] : ''}) ${c.mobilePhone}${c.isNextOfKin ? ' · next of kin' : ''}`).join(' · '),
                  },
                ]}
              />
            </Box>
            <Box>
              <Typography variant="h6" component="h3">
                Employment <EditLink to={2} />
              </Typography>
              <KVGrid
                items={[
                  { label: 'Join date', value: formatDate(employment.joinDate) },
                  { label: 'Continuous-service date', value: formatDate(employment.continuousServiceDate || employment.joinDate) },
                  { label: 'Probation', value: `${employment.probationMonths} months${probationEnd(employment.joinDate, employment.probationMonths) ? ` · ends ${formatDate(probationEnd(employment.joinDate, employment.probationMonths))}` : ''}` },
                  { label: 'Department', value: deptLabel(employment.departmentId) },
                  { label: 'Position', value: posLabel(employment.positionId) },
                  { label: 'Grade', value: gradeLabel(employment.gradeId) },
                  { label: 'Reporting manager', value: employment.isTopOfOrg ? 'Top of organisation' : employment.manager?.name ?? '' },
                  { label: 'Work location', value: loc ? `${loc.label} (${MY_STATE_LABELS[loc.state]})` : '' },
                  { label: 'Working-week pattern', value: patternLabel },
                  { label: 'Employee no.', value: (isSuperAdmin && employment.employeeNo) || `Assigned on save: ${s.employeeNoPreview}` },
                ]}
              />
            </Box>
            <Box>
              <Typography variant="h6" component="h3">
                Statutory & bank <EditLink to={3} />
              </Typography>
              <KVGrid
                items={[
                  { label: 'Pay tax / EPF / SOCSO', value: `${yesNo(statutory.payPcb)} / ${yesNo(statutory.payEpf)} / ${yesNo(statutory.paySocso)}` },
                  { label: 'Income tax no.', value: statutory.incomeTaxNo },
                  { label: 'EPF no.', value: statutory.epfNo },
                  { label: 'Zakat via payroll', value: yesNo(statutory.payZakat) },
                  { label: 'Payment method', value: PAYMENT_METHOD_LABELS[bank.paymentMethod as 'cash'] },
                  {
                    label: 'Bank',
                    value: bank.accountNo
                      ? `${formOptions.banks.find((b) => b.id === bank.bankId)?.name ?? ''} · ${bank.accountType ? BANK_ACCOUNT_TYPE_LABELS[bank.accountType as 'savings'] : ''} · ••••••${bank.accountNo.slice(-4)}`
                      : '',
                  },
                ]}
              />
            </Box>
            <Box>
              <Typography variant="h6" component="h3">
                Opening leave <EditLink to={4} />
              </Typography>
              {(() => {
                const ol = openingLeavePayload(opening, openingForm);
                if (!ol) return <Typography color="text.secondary">None entered.</Typography>;
                const name = (id: string) => openingForm?.rows.find((r) => r.leaveType.id === id)?.leaveType.name ?? '';
                return (
                  <KVGrid
                    items={[
                      ...(ol.rows ?? []).map((r) => ({
                        label: name(r.leaveTypeId),
                        value: `Taken ${Number(r.takenThisYear ?? 0).toFixed(1)}${Number(r.carryForward ?? 0) > 0 ? ` · carry-forward ${Number(r.carryForward).toFixed(1)} (expires ${formatDate(String(r.carryForwardExpiry ?? ''))})` : ''}`,
                      })),
                      { label: 'Replacement credits', value: `${(ol.credits ?? []).length}`, hidden: !(ol.credits ?? []).length },
                      { label: 'Paternity occurrences used', value: String(ol.paternityOccurrencesUsed ?? 0), hidden: !Number(ol.paternityOccurrencesUsed ?? 0) },
                    ]}
                  />
                );
              })()}
            </Box>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
                  Portal invite
                </Typography>
                <RadioInput
                  label="Invite"
                  value={inviteMode}
                  onChange={(v) => setInviteMode(v as 'now' | 'scheduled' | 'later')}
                  options={[
                    { value: 'now', label: 'Send invite now' },
                    { value: 'scheduled', label: `Send on a date (default: join date − ${s.inviteLeadDays} days)` },
                    { value: 'later', label: "Don't schedule — I'll invite later" },
                  ]}
                />
                {inviteMode === 'scheduled' && (
                  <Box sx={{ mt: 2, maxWidth: 320 }}>
                    <DateInput label="Send on" required value={effectiveInviteDate} onChange={setInviteDate} minDate={today} error={errors['invite.scheduledSendDate']} />
                  </Box>
                )}
              </CardContent>
            </Card>
            {missingPayroll.length > 0 ? (
              <Alert severity="warning" variant="outlined">
                Missing for payroll: {missingPayroll.join(', ')}.
              </Alert>
            ) : (
              <Alert severity="success" variant="outlined">
                No payroll fields missing.
              </Alert>
            )}
          </Stack>
        );
    }
  })();

  return (
    <Box>
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          {phone ? (
            <Typography variant="subtitle1" component="p" aria-live="polite">
              Step {step + 1} of {STEPS.length}: {STEPS[step]}
            </Typography>
          ) : (
            <Stepper nonLinear activeStep={step} alternativeLabel>
              {STEPS.map((label, i) => (
                <Step key={label} completed={visited.has(i) && i < step}>
                  <StepButton onClick={() => go(i)} optional={i === 3 || i === 4 ? <Typography variant="caption">Optional</Typography> : undefined}>
                    {label}
                  </StepButton>
                </Step>
              ))}
            </Stepper>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
            {STEPS[step]}
          </Typography>
          <ErrorSummary error={serverError} fieldErrors={Object.keys(errors).length ? errors : undefined} labels={LABELS} />
          <fieldset disabled={saving} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            {stepBody}
          </fieldset>
        </CardContent>
      </Card>
      <Stack
        direction="row"
        spacing={1}
        justifyContent="flex-end"
        sx={[{ mt: 2 }, stickyBarSx]}
      >
        <Button variant="outlined" color="inherit" onClick={() => (dirty ? setGuard(true) : router.push('/employees'))} disabled={saving}>
          Cancel
        </Button>
        {step > 0 && (
          <Button variant="outlined" onClick={() => go(step - 1)} disabled={saving}>
            Back
          </Button>
        )}
        {(step === 3 || step === 4) && (
          <Button
            variant="text"
            onClick={() => {
              setErrors({});
              setStep(step + 1);
              setVisited((v) => new Set([...v, step + 1]));
            }}
            disabled={saving}
          >
            Skip
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button variant="contained" onClick={() => go(step + 1)}>
            Next
          </Button>
        ) : (
          <Button variant="contained" onClick={create} loading={saving}>
            {saving ? 'Creating…' : 'Create employee'}
          </Button>
        )}
      </Stack>
      <ConfirmDialog
        open={guard}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onClose={() => setGuard(false)}
        onConfirm={() => router.push('/employees')}
      />
    </Box>
  );
}
