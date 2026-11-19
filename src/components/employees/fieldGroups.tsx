'use client';

// Field groups shared by E2 New employee, E3 inline edit cards (S-EM-04), E9 Rehire and
// P16 self-update. Order and controls follow wireframes-employees.md; validation rules are
// the contract's zod schemas (re-checked on the server). Field ids in comments are PRD §5.3.
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import {
  BANK_ACCOUNT_TYPE_LABELS,
  CONTACT_RELATIONSHIP_LABELS,
  EPF_RATE_TYPE_LABELS,
  GENDER_LABELS,
  MARITAL_STATUS_LABELS,
  MY_STATES,
  MY_STATE_LABELS,
  NOTICE_UNIT_LABELS,
  PAYMENT_METHOD_LABELS,
  QUALIFICATION_LABELS,
  RACE_LABELS,
  RELIGION_LABELS,
  SOCSO_CATEGORY_LABELS,
  type Address,
  type BankDetailsInput,
  type BankOption,
  type CreateEmployeeInput,
  type EmployerFlagsInput,
  type StatutoryProfileInput,
  type ContactView,
  type EmergencyContactView,
  type Ref,
} from '@/server/contracts/employees';
import type { OrgOptions } from '@/server/contracts/org';
import { CheckboxInput, DateInput, FormGrid, FullRow, MultiSelectInput, NumberInput, SelectInput, SwitchInput, TextInput, type Option } from '../forms/fields';
import { orgOptions } from '../org/common';
import EmployeePicker, { EmployeeMultiPicker, type PickedEmployee } from './EmployeePicker';
import { formatBytes } from './upload';
import { optionsOf, yesNoToBool } from './labels';
import { formatPhone } from '@/lib/format';

type Errors = Record<string, string | undefined>;
type Locks = Record<string, string | false | undefined>;
const ST = MY_STATES.map((s) => ({ value: s, label: MY_STATE_LABELS[s] }));

// ---------------------------------------------------------------------------
// File field (proof, photo, document)
// ---------------------------------------------------------------------------
export function FileField({
  label,
  file,
  onChange,
  accept,
  required,
  error,
  helper,
  existing,
}: {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
  accept: string;
  required?: boolean;
  error?: string;
  helper?: React.ReactNode;
  existing?: string | null;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <Box>
      <Typography variant="caption" color={error ? 'error' : 'text.secondary'} component="p" sx={{ mb: 0.5 }}>
        {label}
        {required ? ' *' : ''}
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button variant="outlined" startIcon={<AttachFileIcon />} onClick={() => ref.current?.click()}>
          {file ? 'Change file' : 'Choose file'}
        </Button>
        {file ? (
          <>
            <Typography variant="body2">
              {file.name} · {formatBytes(file.size)}
            </Typography>
            <IconButton size="small" aria-label={`Remove ${file.name}`} onClick={() => onChange(null)}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </>
        ) : (
          existing && (
            <Typography variant="body2" color="text.secondary">
              Current: {existing}
            </Typography>
          )
        )}
      </Stack>
      <input
        ref={ref}
        type="file"
        hidden
        accept={accept}
        onChange={(e) => {
          onChange(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
      {(error || helper) && (
        <Typography variant="caption" color={error ? 'error' : 'text.secondary'} component="p" sx={{ mt: 0.5 }}>
          {error ?? helper}
        </Typography>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// A — Identity & personal
// ---------------------------------------------------------------------------
export type IdentityForm = {
  mykad: string;
  fullName: string;
  preferredName: string;
  dateOfBirth: string;
  dobOverrideConfirmed: boolean;
  gender: string;
  genderOverrideConfirmed: boolean;
  race: string;
  raceOther: string;
  religion: string;
  maritalStatus: string;
  maritalEffectiveDate: string;
  isOku: boolean;
  okuCardNo: string;
  passportNo: string;
  passportExpiry: string;
  highestQualification: string;
};
export const EMPTY_IDENTITY: IdentityForm = {
  mykad: '', fullName: '', preferredName: '', dateOfBirth: '', dobOverrideConfirmed: false, gender: '', genderOverrideConfirmed: false,
  race: '', raceOther: '', religion: '', maritalStatus: 'single', maritalEffectiveDate: '', isOku: false, okuCardNo: '',
  passportNo: '', passportExpiry: '', highestQualification: '',
};

export function MykadInput({
  value,
  onChange,
  onBlur,
  error,
  helper,
  required = true,
  label = 'MyKad (NRIC) no.',
  locked,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: string;
  helper?: React.ReactNode;
  required?: boolean;
  label?: string;
  locked?: string | false;
}) {
  if (locked) return <TextInput label={label} value={value} onChange={() => undefined} locked={locked} />;
  return (
    <TextField
      fullWidth
      label={label}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d-]/g, '').slice(0, 14))}
      onBlur={onBlur}
      error={Boolean(error)}
      helperText={error ?? helper ?? 'YYMMDD-PB-###G — dashes optional.'}
      slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'off', className: 'pret-tnum' } }}
    />
  );
}

/**
 * Identity fields in wireframe order. `include` limits which fields render (profile cards);
 * `derived` = DOB/gender from MyKad (override warnings, BR-EMP-02/04).
 */
export function IdentityFields({
  value,
  onChange,
  errors = {},
  locks = {},
  derived,
  include,
  mykadSlot,
  photoSlot,
}: {
  value: IdentityForm;
  onChange: (patch: Partial<IdentityForm>) => void;
  errors?: Errors;
  locks?: Locks;
  derived?: { dateOfBirth: string | null; gender: string | null };
  include?: (keyof IdentityForm | 'photo')[];
  mykadSlot?: React.ReactNode;
  photoSlot?: React.ReactNode;
}) {
  const has = (k: keyof IdentityForm | 'photo') => !include || include.includes(k);
  const dobDiffers = Boolean(derived?.dateOfBirth && value.dateOfBirth && derived.dateOfBirth !== value.dateOfBirth);
  const genderDiffers = Boolean(derived?.gender && value.gender && derived.gender !== value.gender);
  return (
    <FormGrid>
      {has('mykad') && mykadSlot}
      {has('fullName') && (
        <TextInput label="Full name (as per MyKad)" required value={value.fullName} onChange={(v) => onChange({ fullName: v })} maxLength={150} error={errors.fullName} locked={locks.fullName} />
      )}
      {has('preferredName') && (
        <TextInput label="Preferred name" value={value.preferredName} onChange={(v) => onChange({ preferredName: v })} maxLength={60} error={errors.preferredName} helper="Used in greetings and the staff directory." locked={locks.preferredName} />
      )}
      {has('dateOfBirth') && (
        <Box>
          <DateInput label="Date of birth" required value={value.dateOfBirth} onChange={(v) => onChange({ dateOfBirth: v, dobOverrideConfirmed: false })} error={errors.dateOfBirth} locked={locks.dateOfBirth} helper={derived?.dateOfBirth && !dobDiffers ? 'Derived from MyKad.' : undefined} />
          {dobDiffers && (
            <Alert severity="warning" variant="outlined" sx={{ mt: 1 }}>
              Date of birth differs from MyKad.
              <CheckboxInput label="Confirm override (logged)" checked={value.dobOverrideConfirmed} onChange={(v) => onChange({ dobOverrideConfirmed: v })} error={errors.dobOverrideConfirmed} />
            </Alert>
          )}
        </Box>
      )}
      {has('gender') && (
        <Box>
          <SelectInput label="Gender" required value={value.gender} onChange={(v) => onChange({ gender: v, genderOverrideConfirmed: false })} options={optionsOf(GENDER_LABELS)} error={errors.gender} locked={locks.gender} />
          {genderDiffers && (
            <Alert severity="warning" variant="outlined" sx={{ mt: 1 }}>
              Gender differs from MyKad.
              <CheckboxInput label="Confirm override (logged)" checked={value.genderOverrideConfirmed} onChange={(v) => onChange({ genderOverrideConfirmed: v })} error={errors.genderOverrideConfirmed} />
            </Alert>
          )}
        </Box>
      )}
      {has('dateOfBirth') && <TextInput label="Nationality" value="Malaysian" onChange={() => undefined} locked="Fixed to Malaysian in Phase 1." />}
      {has('race') && (
        <SelectInput label="Race" value={value.race} onChange={(v) => onChange({ race: v, raceOther: v === 'others' ? value.raceOther : '' })} options={optionsOf(RACE_LABELS)} emptyLabel="— Not set —" error={errors.race} locked={locks.race} />
      )}
      {has('race') && value.race === 'others' && (
        <TextInput label="Race (other, specify)" required value={value.raceOther} onChange={(v) => onChange({ raceOther: v })} maxLength={50} error={errors.raceOther} locked={locks.race} />
      )}
      {has('religion') && (
        <SelectInput label="Religion (sensitive)" value={value.religion} onChange={(v) => onChange({ religion: v })} options={optionsOf(RELIGION_LABELS)} emptyLabel="— Not set —" error={errors.religion} locked={locks.religion} helper="Visible only to the employee, Admin and Super Admin." />
      )}
      {has('maritalStatus') && (
        <SelectInput label="Marital status" required value={value.maritalStatus} onChange={(v) => onChange({ maritalStatus: v })} options={optionsOf(MARITAL_STATUS_LABELS)} error={errors.maritalStatus} locked={locks.maritalStatus} />
      )}
      {has('maritalStatus') && value.maritalStatus !== 'single' && (
        <DateInput label="Marital status effective date" required value={value.maritalEffectiveDate} onChange={(v) => onChange({ maritalEffectiveDate: v })} error={errors.maritalEffectiveDate} locked={locks.maritalStatus} helper="Up to 30 days ahead." />
      )}
      {has('isOku') && (
        <SwitchInput label="Person with disability (OKU) — sensitive" checked={value.isOku} onChange={(v) => onChange({ isOku: v, okuCardNo: v ? value.okuCardNo : '' })} error={errors.isOku} locked={locks.isOku} />
      )}
      {has('isOku') && value.isOku && (
        <TextInput label="OKU card no." required value={value.okuCardNo} onChange={(v) => onChange({ okuCardNo: v })} maxLength={20} error={errors.okuCardNo} locked={locks.isOku} />
      )}
      {has('photo') && photoSlot}
      {has('passportNo') && (
        <TextInput label="Passport no." value={value.passportNo} onChange={(v) => onChange({ passportNo: v.toUpperCase() })} maxLength={20} error={errors.passportNo} helper="For business travel bookings." locked={locks.passportNo} />
      )}
      {has('passportNo') && value.passportNo && (
        <DateInput label="Passport expiry" required value={value.passportExpiry} onChange={(v) => onChange({ passportExpiry: v })} error={errors.passportExpiry} locked={locks.passportNo} helper="An alert is sent 90 days before." />
      )}
      {has('highestQualification') && (
        <SelectInput label="Highest qualification" value={value.highestQualification} onChange={(v) => onChange({ highestQualification: v })} options={optionsOf(QUALIFICATION_LABELS)} emptyLabel="— Not set —" error={errors.highestQualification} locked={locks.highestQualification} />
      )}
    </FormGrid>
  );
}

/** Payload pieces shared by createEmployee / updatePersonal. */
export const identityPayload = (v: IdentityForm): Omit<CreateEmployeeInput['identity'], 'photoFileId'> => ({
  mykad: v.mykad,
  fullName: v.fullName,
  preferredName: v.preferredName,
  dateOfBirth: v.dateOfBirth,
  dobOverrideConfirmed: v.dobOverrideConfirmed,
  gender: v.gender,
  genderOverrideConfirmed: v.genderOverrideConfirmed,
  race: v.race,
  raceOther: v.race === 'others' ? v.raceOther : '',
  religion: v.religion,
  maritalStatus: v.maritalStatus,
  maritalEffectiveDate: v.maritalStatus === 'single' ? '' : v.maritalEffectiveDate,
  isOku: v.isOku,
  okuCardNo: v.isOku ? v.okuCardNo : '',
  passportNo: v.passportNo,
  passportExpiry: v.passportNo ? v.passportExpiry : '',
  highestQualification: v.highestQualification,
} as Omit<CreateEmployeeInput['identity'], 'photoFileId'>);

// ---------------------------------------------------------------------------
// B — Contact & address
// ---------------------------------------------------------------------------
export type AddressForm = { line1: string; line2: string; line3: string; postcode: string; city: string; state: string; country: string };
export const EMPTY_ADDRESS: AddressForm = { line1: '', line2: '', line3: '', postcode: '', city: '', state: '', country: 'Malaysia' };
export const addressToForm = (a: Address | null | undefined): AddressForm =>
  a ? { line1: a.line1, line2: a.line2 ?? '', line3: a.line3 ?? '', postcode: a.postcode, city: a.city, state: a.state, country: a.country || 'Malaysia' } : { ...EMPTY_ADDRESS };

export function AddressEditor({ value, onChange, errors = {}, prefix = '', locked }: { value: AddressForm; onChange: (v: AddressForm) => void; errors?: Errors; prefix?: string; locked?: string | false }) {
  const e = (k: string) => errors[`${prefix}${k}`];
  const set = (k: keyof AddressForm) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <FormGrid>
      <TextInput full label="Address line 1" required value={value.line1} onChange={set('line1')} maxLength={100} error={e('line1')} locked={locked} />
      <TextInput label="Address line 2" value={value.line2} onChange={set('line2')} maxLength={100} error={e('line2')} locked={locked} />
      <TextInput label="Address line 3" value={value.line3} onChange={set('line3')} maxLength={100} error={e('line3')} locked={locked} />
      <TextInput label="Postcode" required value={value.postcode} onChange={(v) => set('postcode')(v.replace(/\D/g, '').slice(0, 5))} inputMode="numeric" error={e('postcode')} locked={locked} />
      <TextInput label="City" required value={value.city} onChange={set('city')} maxLength={50} error={e('city')} locked={locked} />
      <SelectInput label="State" required value={value.state} onChange={set('state')} options={ST} error={e('state')} locked={locked} />
      <TextInput label="Country" required value={value.country} onChange={set('country')} maxLength={60} error={e('country')} locked={locked} />
    </FormGrid>
  );
}

export type ContactForm = {
  workEmail: string;
  personalEmail: string;
  mobilePhone: string;
  workPhone: string;
  residential: AddressForm;
  mailingSame: boolean;
  mailing: AddressForm;
};
export const EMPTY_CONTACT: ContactForm = { workEmail: '', personalEmail: '', mobilePhone: '', workPhone: '', residential: { ...EMPTY_ADDRESS }, mailingSame: true, mailing: { ...EMPTY_ADDRESS } };
export const contactToForm = (c: ContactView): ContactForm => ({
  workEmail: c.workEmail,
  personalEmail: c.personalEmail,
  mobilePhone: formatPhone(c.mobilePhone) || c.mobilePhone,
  workPhone: c.workPhone ?? '',
  residential: addressToForm(c.residentialAddress),
  mailingSame: c.mailingSameAsResidential,
  mailing: addressToForm(c.mailingAddress),
});
export const contactPayload = (v: ContactForm): CreateEmployeeInput['contact'] => ({
  workEmail: v.workEmail,
  personalEmail: v.personalEmail,
  mobilePhone: v.mobilePhone,
  workPhone: v.workPhone,
  residentialAddress: v.residential,
  mailingSameAsResidential: v.mailingSame,
  mailingAddress: v.mailingSame ? null : v.mailing,
} as CreateEmployeeInput['contact']);

export function ContactFields({
  value,
  onChange,
  errors = {},
  locks = {},
  allowedDomains,
  workEmailWarning,
}: {
  value: ContactForm;
  onChange: (patch: Partial<ContactForm>) => void;
  errors?: Errors;
  locks?: Locks;
  allowedDomains?: string[];
  workEmailWarning?: string;
}) {
  return (
    <Stack spacing={2}>
      <FormGrid>
        <TextInput
          label="Work email"
          required
          type="email"
          value={value.workEmail}
          onChange={(v) => onChange({ workEmail: v })}
          maxLength={254}
          error={errors.workEmail}
          locked={locks.workEmail}
          helper={workEmailWarning ?? (allowedDomains?.length ? `Becomes the sign-in email. Allowed domains: ${allowedDomains.join(', ')}.` : 'Becomes the sign-in email.')}
        />
        <TextInput label="Personal email" required type="email" value={value.personalEmail} onChange={(v) => onChange({ personalEmail: v })} maxLength={254} error={errors.personalEmail} locked={locks.personalEmail} helper="Used for bank-change alerts and post-exit contact." />
        <TextInput label="Mobile phone" required type="tel" value={value.mobilePhone} onChange={(v) => onChange({ mobilePhone: v })} maxLength={20} error={errors.mobilePhone} locked={locks.mobilePhone} helper="Malaysian mobile, e.g. +60 12-345 6789." inputMode="tel" />
        <TextInput label="Work phone / extension" value={value.workPhone} onChange={(v) => onChange({ workPhone: v })} maxLength={20} error={errors.workPhone} locked={locks.workPhone} inputMode="tel" />
      </FormGrid>
      <Typography variant="subtitle1" component="h3">
        Residential address
      </Typography>
      <AddressEditor value={value.residential} onChange={(a) => onChange({ residential: a })} errors={errors} prefix="residentialAddress." locked={locks.address} />
      <SwitchInput label="Mailing address same as residential" checked={value.mailingSame} onChange={(v) => onChange({ mailingSame: v })} locked={locks.address} />
      {!value.mailingSame && (
        <>
          <Typography variant="subtitle1" component="h3">
            Mailing address
          </Typography>
          <AddressEditor value={value.mailing} onChange={(a) => onChange({ mailing: a })} errors={errors} prefix="mailingAddress." locked={locks.address} />
        </>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// C — Emergency contacts (1–3, ≥ 1, priority unique, ≤ 1 next of kin)
// ---------------------------------------------------------------------------
export type EmergencyForm = { id?: string; name: string; relationship: string; mobilePhone: string; altPhone: string; email: string; isNextOfKin: boolean };
export const EMPTY_EMERGENCY: EmergencyForm = { name: '', relationship: '', mobilePhone: '', altPhone: '', email: '', isNextOfKin: false };
export const emergencyToForm = (rows: EmergencyContactView[]): EmergencyForm[] =>
  [...rows]
    .sort((a, b) => a.priority - b.priority)
    .map((r) => ({ id: r.id, name: r.name, relationship: r.relationship, mobilePhone: r.mobilePhone, altPhone: r.altPhone ?? '', email: r.email ?? '', isNextOfKin: Boolean(r.isNextOfKin) }));
/** Priority = row order (1–3). */
export const emergencyPayload = (rows: EmergencyForm[]): CreateEmployeeInput['emergencyContacts'] =>
  rows.map((r, i) => ({ id: r.id ?? null, priority: i + 1, name: r.name, relationship: r.relationship, mobilePhone: r.mobilePhone, altPhone: r.altPhone, email: r.email, isNextOfKin: r.isNextOfKin })) as CreateEmployeeInput['emergencyContacts'];

export function EmergencyContactsEditor({ rows, onChange, errors = {}, prefix = 'contacts.' }: { rows: EmergencyForm[]; onChange: (rows: EmergencyForm[]) => void; errors?: Errors; prefix?: string }) {
  const set = (i: number, patch: Partial<EmergencyForm>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : patch.isNextOfKin ? { ...r, isNextOfKin: false } : r)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...rows];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    onChange(next);
  };
  const e = (i: number, k: string) => errors[`${prefix}${i}.${k}`];
  return (
    <Stack spacing={2}>
      {errors[prefix.replace(/\.$/, '')] && <Alert severity="error">{errors[prefix.replace(/\.$/, '')]}</Alert>}
      {rows.map((r, i) => (
        <Box key={r.id ?? `new-${i}`} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
              Priority {i + 1}
            </Typography>
            <Tooltip title="Move up">
              <span>
                <IconButton size="small" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move contact ${i + 1} up`}>
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Move down">
              <span>
                <IconButton size="small" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={`Move contact ${i + 1} down`}>
                  <ArrowDownwardIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={rows.length <= 1 ? 'At least one emergency contact is required.' : 'Remove'}>
              <span>
                <IconButton size="small" disabled={rows.length <= 1} onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove contact ${i + 1}`}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
          <FormGrid>
            <TextInput label="Name" required value={r.name} onChange={(v) => set(i, { name: v })} maxLength={100} error={e(i, 'name')} />
            <SelectInput label="Relationship" required value={r.relationship} onChange={(v) => set(i, { relationship: v })} options={optionsOf(CONTACT_RELATIONSHIP_LABELS)} error={e(i, 'relationship')} />
            <TextInput label="Mobile phone" required type="tel" value={r.mobilePhone} onChange={(v) => set(i, { mobilePhone: v })} maxLength={20} error={e(i, 'mobilePhone')} helper="Malaysian or international format." />
            <TextInput label="Alternate phone" type="tel" value={r.altPhone} onChange={(v) => set(i, { altPhone: v })} maxLength={20} error={e(i, 'altPhone')} />
            <TextInput label="Email" type="email" value={r.email} onChange={(v) => set(i, { email: v })} maxLength={254} error={e(i, 'email')} />
            <CheckboxInput label="Next of kin" checked={r.isNextOfKin} onChange={(v) => set(i, { isNextOfKin: v })} error={e(i, 'isNextOfKin')} helper="At most one contact." />
          </FormGrid>
        </Box>
      ))}
      {rows.length < 3 && (
        <Box>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => onChange([...rows, { ...EMPTY_EMERGENCY }])}>
            Add contact
          </Button>
        </Box>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// F — Employment (E2 step 3, E9 step 3)
// ---------------------------------------------------------------------------
export type EmploymentForm = {
  joinDate: string;
  continuousServiceDate: string;
  probationMonths: string;
  departmentId: string;
  positionId: string;
  gradeId: string;
  manager: PickedEmployee | null;
  isTopOfOrg: boolean;
  leaveApprover: PickedEmployee | null;
  claimApprover: PickedEmployee | null;
  workLocationId: string;
  workingPatternId: string;
  phStateOverride: string;
  contractualNoticeValue: string;
  contractualNoticeUnit: string;
  costCentreId: string;
  offerContractRef: string;
  contractSignedDate: string;
  employeeGroupIds: string[];
  employeeNo: string;
};
export const emptyEmployment = (probation: number): EmploymentForm => ({
  joinDate: '', continuousServiceDate: '', probationMonths: String(probation), departmentId: '', positionId: '', gradeId: '', manager: null,
  isTopOfOrg: false, leaveApprover: null, claimApprover: null, workLocationId: '', workingPatternId: '', phStateOverride: '',
  contractualNoticeValue: '', contractualNoticeUnit: '', costCentreId: '', offerContractRef: '', contractSignedDate: '', employeeGroupIds: [], employeeNo: '',
});
export const employmentPayload = (v: EmploymentForm, isSuperAdmin: boolean): CreateEmployeeInput['employment'] => ({
  joinDate: v.joinDate,
  continuousServiceDate: v.continuousServiceDate || v.joinDate,
  probationMonths: v.probationMonths,
  departmentId: v.departmentId,
  positionId: v.positionId,
  gradeId: v.gradeId,
  managerId: v.isTopOfOrg ? null : v.manager?.id ?? null,
  isTopOfOrg: isSuperAdmin ? v.isTopOfOrg : false,
  leaveApproverId: v.leaveApprover?.id ?? null,
  claimApproverId: v.claimApprover?.id ?? null,
  workLocationId: v.workLocationId,
  workingPatternId: v.workingPatternId,
  phStateOverride: v.phStateOverride,
  contractualNoticeValue: v.contractualNoticeValue,
  contractualNoticeUnit: v.contractualNoticeUnit,
  costCentreId: v.costCentreId,
  offerContractRef: v.offerContractRef,
  contractSignedDate: v.contractSignedDate,
  employeeGroupIds: v.employeeGroupIds,
  ...(isSuperAdmin && v.employeeNo ? { employeeNo: v.employeeNo } : {}),
} as CreateEmployeeInput['employment']);

/** BR-EMP-12 probation end = join date + months − 1 day (display only; server computes F5). */
export function probationEnd(joinDate: string, months: string): string {
  const m = Number(months);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinDate) || !Number.isFinite(m) || m <= 0) return '';
  const [y, mo, d] = joinDate.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, mo - 1 + m, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const dt = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last)));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export type EmploymentFieldsOptions = { org: OrgOptions; employeeNoPreview?: string; maxProbationMonths?: number; positionDefaults?: Record<string, { departmentId: string | null; gradeId: string | null }> };

export function EmploymentFields({
  value,
  onChange,
  errors = {},
  opts,
  isSuperAdmin,
  include = 'all',
}: {
  value: EmploymentForm;
  onChange: (patch: Partial<EmploymentForm>) => void;
  errors?: Errors;
  opts: EmploymentFieldsOptions;
  isSuperAdmin: boolean;
  /** 'core' = E9 rehire step 3 (job fields + dates only) */
  include?: 'all' | 'core';
}) {
  const o = opts.org;
  const loc = o.locations.find((l) => l.id === value.workLocationId);
  const end = probationEnd(value.joinDate, value.probationMonths);
  const all = include === 'all';
  return (
    <FormGrid>
      <DateInput label="Join date" required value={value.joinDate} onChange={(v) => onChange({ joinDate: v, continuousServiceDate: !value.continuousServiceDate || value.continuousServiceDate === value.joinDate ? v : value.continuousServiceDate })} error={errors.joinDate} helper="Up to 12 months ahead. A future date makes the status Pending Join." />
      {all && <DateInput label="Continuous-service date" required value={value.continuousServiceDate || value.joinDate} onChange={(v) => onChange({ continuousServiceDate: v })} error={errors.continuousServiceDate} helper="Defaults to the join date; drives leave service bands." />}
      {all && <TextInput label="Employment type" value="Permanent – full time" onChange={() => undefined} locked="Fixed in Phase 1." />}
      <NumberInput label="Probation period (months)" required value={value.probationMonths} onChange={(v) => onChange({ probationMonths: v })} min={0} max={opts.maxProbationMonths ?? 12} error={errors.probationMonths} />
      <TextInput label="Probation end date" value={end ? end.split('-').reverse().join('/') : value.probationMonths === '0' ? 'No probation' : ''} onChange={() => undefined} locked="Computed: join date + probation − 1 day." />
      <SelectInput label="Department" required value={value.departmentId} onChange={(v) => onChange({ departmentId: v })} options={orgOptions(o.departments, [value.departmentId])} error={errors.departmentId} />
      <SelectInput
        label="Position"
        required
        value={value.positionId}
        onChange={(v) => {
          const def = opts.positionDefaults?.[v];
          onChange({ positionId: v, departmentId: value.departmentId || def?.departmentId || '', gradeId: value.gradeId || def?.gradeId || '' });
        }}
        options={orgOptions(o.positions, [value.positionId])}
        error={errors.positionId}
      />
      <SelectInput label="Grade" required value={value.gradeId} onChange={(v) => onChange({ gradeId: v })} options={orgOptions(o.grades, [value.gradeId])} error={errors.gradeId} />
      <Box>
        <EmployeePicker label="Reporting manager" required={!value.isTopOfOrg} value={value.manager} onChange={(v) => onChange({ manager: v })} disabled={value.isTopOfOrg} error={errors.managerId} />
      </Box>
      {all && (
        <SwitchInput
          label="Top of organisation"
          checked={value.isTopOfOrg}
          onChange={(v) => onChange({ isTopOfOrg: v, manager: v ? null : value.manager })}
          locked={isSuperAdmin ? false : 'Only a Super Admin can change this.'}
          helper="No reporting manager (Super Admin only)."
          error={errors.isTopOfOrg}
        />
      )}
      {all && <EmployeePicker label="Leave approver (override)" value={value.leaveApprover} onChange={(v) => onChange({ leaveApprover: v })} error={errors.leaveApproverId} helper="Blank = reporting manager." />}
      {all && <EmployeePicker label="Claim approver (override)" value={value.claimApprover} onChange={(v) => onChange({ claimApprover: v })} error={errors.claimApproverId} helper="Blank = reporting manager." />}
      <SelectInput
        label="Work location"
        required
        value={value.workLocationId}
        onChange={(v) => onChange({ workLocationId: v })}
        options={o.locations.filter((l) => l.isActive || l.id === value.workLocationId).map((l) => ({ value: l.id, label: `${l.label} (${MY_STATE_LABELS[l.state]})` }))}
        error={errors.workLocationId}
      />
      <TextInput label="Work state" value={loc ? MY_STATE_LABELS[loc.state] : ''} onChange={() => undefined} locked="From the work location; drives the public-holiday calendar." />
      <SelectInput label="Working-week pattern" required value={value.workingPatternId} onChange={(v) => onChange({ workingPatternId: v })} options={orgOptions(o.workingPatterns, [value.workingPatternId])} error={errors.workingPatternId} helper="Default from the work location." />
      {all && <SelectInput label="Public-holiday calendar override" value={value.phStateOverride} onChange={(v) => onChange({ phStateOverride: v })} options={ST} emptyLabel="— None (use work state) —" error={errors.phStateOverride} />}
      {all && (
        <Stack direction="row" spacing={1}>
          <NumberInput label="Contractual notice period" value={value.contractualNoticeValue} onChange={(v) => onChange({ contractualNoticeValue: v })} min={1} max={52} error={errors.contractualNoticeValue} helper="Blank = EA s12 default." />
          <SelectInput label="Unit" value={value.contractualNoticeUnit} onChange={(v) => onChange({ contractualNoticeUnit: v })} options={optionsOf(NOTICE_UNIT_LABELS)} emptyLabel="—" error={errors.contractualNoticeUnit} />
        </Stack>
      )}
      {all && <SelectInput label="Cost centre" value={value.costCentreId} onChange={(v) => onChange({ costCentreId: v })} options={orgOptions(o.costCentres, [value.costCentreId])} emptyLabel="— None —" error={errors.costCentreId} />}
      {all && <TextInput label="Offer / contract reference" value={value.offerContractRef} onChange={(v) => onChange({ offerContractRef: v })} maxLength={50} error={errors.offerContractRef} />}
      {all && <DateInput label="Contract / LOA signed date" value={value.contractSignedDate} onChange={(v) => onChange({ contractSignedDate: v })} error={errors.contractSignedDate} helper="On or before join date + 30 days." />}
      {all && (
        <MultiSelectGroups value={value.employeeGroupIds} onChange={(v) => onChange({ employeeGroupIds: v })} options={orgOptions(o.employeeGroups, value.employeeGroupIds)} error={errors.employeeGroupIds} />
      )}
      {all && (
        <TextInput
          label="Employee no."
          value={isSuperAdmin ? value.employeeNo : ''}
          onChange={(v) => onChange({ employeeNo: v.toUpperCase() })}
          maxLength={20}
          error={errors.employeeNo}
          locked={isSuperAdmin ? false : `Assigned on save${opts.employeeNoPreview ? `: ${opts.employeeNoPreview}` : ''}.`}
          helper={isSuperAdmin ? `Leave blank to assign automatically${opts.employeeNoPreview ? ` (${opts.employeeNoPreview})` : ''}.` : undefined}
        />
      )}
    </FormGrid>
  );
}

function MultiSelectGroups({ value, onChange, options, error }: { value: string[]; onChange: (v: string[]) => void; options: Option[]; error?: string }) {
  return <MultiSelectInput label="Employee groups" value={value} onChange={onChange} options={options} error={error} />;
}

// ---------------------------------------------------------------------------
// H — Statutory & payroll-deduction profile
// ---------------------------------------------------------------------------
export type StatutoryForm = {
  payPcb: boolean; incomeTaxNo: string; isTaxResident: boolean; lhdnBranchId: string;
  payEpf: boolean; epfNo: string; epfRateType: string; epfSpecificRate: string; epfExtraEmployeePct: string;
  paySocso: boolean; socsoNo: string; socsoCategory: string; socsoContributedBefore: string;
  payEis: string; payZakat: boolean; zakatMonthlyAmount: string; zakatAccountNo: string; zakatBodyId: string;
  ptptnMonthlyAmount: string; ptptnStartDate: string; ptptnEndDate: string;
};
export const EMPTY_STATUTORY: StatutoryForm = {
  payPcb: true, incomeTaxNo: '', isTaxResident: true, lhdnBranchId: '', payEpf: true, epfNo: '', epfRateType: 'statutory', epfSpecificRate: '',
  epfExtraEmployeePct: '', paySocso: true, socsoNo: '', socsoCategory: '', socsoContributedBefore: '', payEis: '', payZakat: false,
  zakatMonthlyAmount: '', zakatAccountNo: '', zakatBodyId: '', ptptnMonthlyAmount: '', ptptnStartDate: '', ptptnEndDate: '',
};
export const statutoryPayload = (v: StatutoryForm): StatutoryProfileInput => ({
  ...v,
  socsoContributedBefore: yesNoToBool(v.socsoContributedBefore),
  payEis: v.payEis === '' ? undefined : v.payEis === 'yes',
  zakatMonthlyAmount: v.payZakat ? v.zakatMonthlyAmount : '',
  zakatAccountNo: v.payZakat ? v.zakatAccountNo : '',
  zakatBodyId: v.payZakat ? v.zakatBodyId : '',
  epfSpecificRate: v.epfRateType === 'specific' ? v.epfSpecificRate : '',
} as StatutoryProfileInput);

export type FlagsForm = {
  pcbBorneByEmployer: boolean; returningExpertProgramme: boolean; knowledgeWorkerSpecifiedRegion: boolean; epfBorneByEmployer: boolean;
  epfExtraEmployerPct: string; socsoBorneByEmployer: boolean; paySkbbk: boolean; skbbkBorneByEmployer: boolean; eisBorneByEmployer: boolean; payHrdf: string;
};
export const EMPTY_FLAGS: FlagsForm = {
  pcbBorneByEmployer: false, returningExpertProgramme: false, knowledgeWorkerSpecifiedRegion: false, epfBorneByEmployer: false, epfExtraEmployerPct: '',
  socsoBorneByEmployer: false, paySkbbk: false, skbbkBorneByEmployer: false, eisBorneByEmployer: false, payHrdf: '',
};
export const flagsPayload = (v: FlagsForm): EmployerFlagsInput => ({ ...v, payHrdf: v.payHrdf === '' ? undefined : v.payHrdf === 'yes' });

const YN: Option[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

function Sub({ title, children, note }: { title: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Typography variant="subtitle1" component="h3" sx={{ mb: note ? 0.5 : 1.5 }}>
        {title}
      </Typography>
      {note && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {note}
        </Typography>
      )}
      {children}
    </Box>
  );
}

/** Statutory sub-cards PCB · EPF · SOCSO & SKBBK · EIS · Zakat · HRDF · PTPTN (employer flags inline, HR only). */
export function StatutoryFields({
  value,
  onChange,
  flags,
  onFlagsChange,
  errors = {},
  lhdnBranches,
  zakatBodies,
  pcbCategoryText,
  religionWarning,
  companyHrdfRegistered,
}: {
  value: StatutoryForm;
  onChange: (patch: Partial<StatutoryForm>) => void;
  flags: FlagsForm;
  onFlagsChange: (patch: Partial<FlagsForm>) => void;
  errors?: Errors;
  lhdnBranches: Ref[];
  zakatBodies: { id: string; name: string }[];
  pcbCategoryText?: string;
  religionWarning?: boolean;
  companyHrdfRegistered?: boolean;
}) {
  const e = (k: string) => errors[k] ?? errors[`profile.${k}`];
  const fe = (k: string) => errors[`employerFlags.${k}`] ?? errors[k];
  return (
    <Stack spacing={2}>
      <Sub title="PCB / income tax">
        <FormGrid>
          <SwitchInput label="Pay tax (PCB/MTD)" checked={value.payPcb} onChange={(v) => onChange({ payPcb: v })} />
          <SwitchInput label="Tax borne by employer (HR only)" checked={flags.pcbBorneByEmployer} onChange={(v) => onFlagsChange({ pcbBorneByEmployer: v })} />
          <TextInput label="Income tax no. (LHDN TIN)" value={value.incomeTaxNo} onChange={(v) => onChange({ incomeTaxNo: v.toUpperCase() })} maxLength={14} error={e('incomeTaxNo')} helper="IG + up to 11 digits (or legacy SG/OG)." />
          <SwitchInput label="Malaysian tax resident" checked={value.isTaxResident} onChange={(v) => onChange({ isTaxResident: v })} />
          <SelectInput label="LHDN state / branch" value={value.lhdnBranchId} onChange={(v) => onChange({ lhdnBranchId: v })} options={lhdnBranches.map((b) => ({ value: b.id, label: b.label }))} emptyLabel="— Not set —" error={e('lhdnBranchId')} />
          <SwitchInput label="Returning Expert Programme (HR only)" checked={flags.returningExpertProgramme} onChange={(v) => onFlagsChange({ returningExpertProgramme: v })} />
          <SwitchInput label="Knowledge worker at specified region (HR only)" checked={flags.knowledgeWorkerSpecifiedRegion} onChange={(v) => onFlagsChange({ knowledgeWorkerSpecifiedRegion: v })} />
          {pcbCategoryText !== undefined && <TextInput label="PCB category (derived)" value={pcbCategoryText} onChange={() => undefined} locked="Derived from marital status and spouse working status." />}
        </FormGrid>
      </Sub>
      <Sub title="EPF (KWSP)">
        <FormGrid>
          <SwitchInput label="Pay EPF" checked={value.payEpf} onChange={(v) => onChange({ payEpf: v })} />
          <SwitchInput label="EPF borne by employer (HR only)" checked={flags.epfBorneByEmployer} onChange={(v) => onFlagsChange({ epfBorneByEmployer: v })} />
          <TextInput label="EPF member no." value={value.epfNo} onChange={(v) => onChange({ epfNo: v.replace(/\D/g, '').slice(0, 9) })} inputMode="numeric" error={e('epfNo')} helper="Up to 9 digits." />
          <SelectInput label="Employee EPF rate" value={value.epfRateType} onChange={(v) => onChange({ epfRateType: v })} options={optionsOf(EPF_RATE_TYPE_LABELS)} error={e('epfRateType')} />
          {value.epfRateType === 'specific' && <NumberInput label="Specific EPF rate" required value={value.epfSpecificRate} onChange={(v) => onChange({ epfSpecificRate: v })} min={0} max={89} step={0.1} suffix="%" error={e('epfSpecificRate')} />}
          <NumberInput label="Extra employee EPF %" value={value.epfExtraEmployeePct} onChange={(v) => onChange({ epfExtraEmployeePct: v })} min={0} max={89} step={0.1} suffix="%" error={e('epfExtraEmployeePct')} />
          <NumberInput label="Extra employer EPF % (HR only)" value={flags.epfExtraEmployerPct} onChange={(v) => onFlagsChange({ epfExtraEmployerPct: v })} min={0} max={89} step={0.1} suffix="%" error={fe('epfExtraEmployerPct')} />
        </FormGrid>
      </Sub>
      <Sub title="SOCSO (PERKESO) & SKBBK">
        <FormGrid>
          <SwitchInput label="Pay SOCSO" checked={value.paySocso} onChange={(v) => onChange({ paySocso: v })} />
          <SwitchInput label="SOCSO borne by employer (HR only)" checked={flags.socsoBorneByEmployer} onChange={(v) => onFlagsChange({ socsoBorneByEmployer: v })} />
          <TextInput label="SOCSO no." value={value.socsoNo} onChange={(v) => onChange({ socsoNo: v })} maxLength={12} error={e('socsoNo')} helper="Blank = the MyKad number." />
          <SelectInput label="SOCSO category" value={value.socsoCategory} onChange={(v) => onChange({ socsoCategory: v })} options={optionsOf(SOCSO_CATEGORY_LABELS)} emptyLabel="— Default by age —" error={e('socsoCategory')} />
          <SelectInput label="Has contributed to SOCSO before" value={value.socsoContributedBefore} onChange={(v) => onChange({ socsoContributedBefore: v })} options={YN} emptyLabel="— Not set —" error={e('socsoContributedBefore')} />
          <SwitchInput label="Pay SKBBK (HR only)" checked={flags.paySkbbk} onChange={(v) => onFlagsChange({ paySkbbk: v })} />
          <SwitchInput label="SKBBK borne by employer (HR only)" checked={flags.skbbkBorneByEmployer} onChange={(v) => onFlagsChange({ skbbkBorneByEmployer: v })} />
        </FormGrid>
      </Sub>
      <Sub title="EIS">
        <FormGrid>
          <SelectInput label="Pay EIS" value={value.payEis} onChange={(v) => onChange({ payEis: v })} options={YN} emptyLabel="— Default by age —" error={e('payEis')} />
          <SwitchInput label="EIS borne by employer (HR only)" checked={flags.eisBorneByEmployer} onChange={(v) => onFlagsChange({ eisBorneByEmployer: v })} />
        </FormGrid>
      </Sub>
      <Sub title="Zakat">
        <FormGrid>
          <SwitchInput label="Pay zakat via payroll" checked={value.payZakat} onChange={(v) => onChange({ payZakat: v })} />
          <FullRow>{value.payZakat && religionWarning && <Alert severity="warning" variant="outlined">Zakat is usually for Muslim employees — check religion.</Alert>}</FullRow>
          {value.payZakat && <TextInput label="Zakat monthly amount (RM)" required value={value.zakatMonthlyAmount} onChange={(v) => onChange({ zakatMonthlyAmount: v })} inputMode="decimal" error={e('zakatMonthlyAmount')} />}
          {value.payZakat && <TextInput label="Zakat account / reference no." required value={value.zakatAccountNo} onChange={(v) => onChange({ zakatAccountNo: v })} maxLength={30} error={e('zakatAccountNo')} />}
          {value.payZakat && <SelectInput label="Zakat authority (state)" value={value.zakatBodyId} onChange={(v) => onChange({ zakatBodyId: v })} options={zakatBodies.map((z) => ({ value: z.id, label: z.name }))} emptyLabel="— Default: work state —" error={e('zakatBodyId')} />}
        </FormGrid>
      </Sub>
      <Sub title="HRDF">
        <SelectInput label="Pay HRDF levy for this employee (HR only)" value={flags.payHrdf} onChange={(v) => onFlagsChange({ payHrdf: v })} options={YN} emptyLabel={`— Company default (${companyHrdfRegistered ? 'Yes' : 'No'}) —`} />
      </Sub>
      <Sub title="PTPTN (study loan deduction)">
        <FormGrid>
          <TextInput label="PTPTN monthly deduction (RM)" value={value.ptptnMonthlyAmount} onChange={(v) => onChange({ ptptnMonthlyAmount: v })} inputMode="decimal" error={e('ptptnMonthlyAmount')} />
          <Box />
          {Number(value.ptptnMonthlyAmount) > 0 && <DateInput label="Deduction start date" required value={value.ptptnStartDate} onChange={(v) => onChange({ ptptnStartDate: v })} error={e('ptptnStartDate')} />}
          {Number(value.ptptnMonthlyAmount) > 0 && <DateInput label="Deduction end date" required value={value.ptptnEndDate} onChange={(v) => onChange({ ptptnEndDate: v })} error={e('ptptnEndDate')} />}
        </FormGrid>
      </Sub>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// I — Bank details & ASNB
// ---------------------------------------------------------------------------
export type BankForm = {
  paymentMethod: string; bankId: string; accountType: string; accountNo: string; accountHolderName: string;
  holderNameMismatchAck: boolean; proof: File | null; effectiveFrom: string; asnbAccountNo: string; sharedAccountRemarks: string;
};
export const emptyBank = (today: string, holder = ''): BankForm => ({
  paymentMethod: 'bank_transfer', bankId: '', accountType: '', accountNo: '', accountHolderName: holder, holderNameMismatchAck: false, proof: null,
  effectiveFrom: today, asnbAccountNo: '', sharedAccountRemarks: '',
});
export const bankFilled = (v: BankForm) => v.paymentMethod !== 'bank_transfer' || Boolean(v.bankId || v.accountNo || v.accountType || v.proof || v.asnbAccountNo);

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase();

export function BankFields({
  value,
  onChange,
  errors = {},
  banks,
  employeeFullName,
  showProof = true,
  showEffective = true,
  showSharedRemarks,
  proofRequired = true,
}: {
  value: BankForm;
  onChange: (patch: Partial<BankForm>) => void;
  errors?: Errors;
  banks: BankOption[];
  employeeFullName: string;
  showProof?: boolean;
  showEffective?: boolean;
  showSharedRemarks?: boolean;
  proofRequired?: boolean;
}) {
  const transfer = value.paymentMethod === 'bank_transfer';
  const mismatch = transfer && value.accountHolderName.trim() !== '' && employeeFullName.trim() !== '' && norm(value.accountHolderName) !== norm(employeeFullName);
  return (
    <FormGrid>
      <SelectInput label="Payment method" required value={value.paymentMethod} onChange={(v) => onChange({ paymentMethod: v })} options={optionsOf(PAYMENT_METHOD_LABELS)} error={errors.paymentMethod} />
      {transfer ? (
        <SelectInput label="Bank" required value={value.bankId} onChange={(v) => onChange({ bankId: v })} options={banks.map((b) => ({ value: b.id, label: b.name, secondary: b.code }))} error={errors.bankId} />
      ) : (
        <Box />
      )}
      {transfer && <SelectInput label="Account type" required value={value.accountType} onChange={(v) => onChange({ accountType: v })} options={optionsOf(BANK_ACCOUNT_TYPE_LABELS)} error={errors.accountType} />}
      {transfer && (
        <TextInput label="Account no." required value={value.accountNo} onChange={(v) => onChange({ accountNo: v.replace(/[^\d]/g, '').slice(0, 20) })} inputMode="numeric" autoComplete="off" error={errors.accountNo} helper="Digits only, 6–20." />
      )}
      {transfer && (
        <TextInput full label="Account holder name" required value={value.accountHolderName} onChange={(v) => onChange({ accountHolderName: v, holderNameMismatchAck: false })} maxLength={150} error={errors.accountHolderName} />
      )}
      {mismatch && (
        <FullRow>
          <Alert severity="warning" variant="outlined">
            Holder name differs from the employee&apos;s name — joint or third-party accounts are discouraged.
            <CheckboxInput label="Continue anyway" checked={value.holderNameMismatchAck} onChange={(v) => onChange({ holderNameMismatchAck: v })} error={errors.holderNameMismatchAck} />
          </Alert>
        </FullRow>
      )}
      {transfer && showProof && (
        <FileField
          label="Proof of account"
          required={proofRequired}
          file={value.proof}
          onChange={(f) => onChange({ proof: f })}
          accept=".pdf,.jpg,.jpeg,.png,.heic"
          error={errors.proofFileId}
          helper="Bank statement header or e-banking screenshot (PDF or image, ≤ 10 MB)."
        />
      )}
      {showEffective && <DateInput label="Effective from" required value={value.effectiveFrom} onChange={(v) => onChange({ effectiveFrom: v })} error={errors.effectiveFrom} />}
      <TextInput label="ASNB account no." value={value.asnbAccountNo} onChange={(v) => onChange({ asnbAccountNo: v.replace(/[^\d]/g, '').slice(0, 20) })} inputMode="numeric" autoComplete="off" error={errors.asnbAccountNo} helper="Optional — digits only." />
      {showSharedRemarks && (
        <FullRow>
          <Alert severity="warning" variant="outlined" sx={{ mb: 1 }}>
            Another employee already uses this account. Add remarks to continue (kept in the audit trail).
          </Alert>
          <TextInput label="Remarks" required value={value.sharedAccountRemarks} onChange={(v) => onChange({ sharedAccountRemarks: v })} maxLength={500} multiline minRows={2} error={errors.sharedAccountRemarks} />
        </FullRow>
      )}
    </FormGrid>
  );
}

export const bankPayload = (v: BankForm, proofFileId: string | null): BankDetailsInput => ({
  paymentMethod: v.paymentMethod,
  bankId: v.paymentMethod === 'bank_transfer' ? v.bankId : '',
  accountType: v.paymentMethod === 'bank_transfer' ? v.accountType : '',
  accountNo: v.paymentMethod === 'bank_transfer' ? v.accountNo : '',
  accountHolderName: v.paymentMethod === 'bank_transfer' ? v.accountHolderName : '',
  holderNameMismatchAck: v.holderNameMismatchAck,
  proofFileId,
  effectiveFrom: v.effectiveFrom,
  asnbAccountNo: v.asnbAccountNo,
  sharedAccountRemarks: v.sharedAccountRemarks,
} as BankDetailsInput);

