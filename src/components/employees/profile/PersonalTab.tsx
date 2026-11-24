'use client';

// E3 tab 2 · Personal (group A) + E4 inline edit. ✎ ADM/SA · A1 SA only (logged) ·
// A4 reveal (E10) · A2, A4, A9/A10, A11, A12/A13, A14/A15 not on own record (E→CR).
// Religion / OKU (T4 special category) are read through a logged call — shown only after
// SHOW SENSITIVE DETAILS (?sensitive=1), never fetched on every profile view.
import * as React from 'react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LockIcon from '@mui/icons-material/Lock';
import {
  GENDER_LABELS,
  MARITAL_STATUS_LABELS,
  QUALIFICATION_LABELS,
  RACE_LABELS,
  RELIGION_LABELS,
  type SensitiveView,
} from '@/server/contracts/employees';
import { updateMykad, updatePersonal, updateSensitive } from '@/server/actions/employees';
import FormDialog from '../../forms/FormDialog';
import { useActionRunner } from '../../forms/useActionRunner';
import MaskedValue from '../MaskedValue';
import { IdentityFields, MykadInput, EMPTY_IDENTITY, type IdentityForm } from '../fieldGroups';
import { KVGrid, SectionCard } from '../ui';
import { dateOr } from '../labels';
import { OWN_LOCK, revealer, type ProfileCtx } from './context';
import { ChangeEmployeeNoDialog, PhotoDialog } from './dialogs';

function toForm(ctx: ProfileCtx): IdentityForm {
  const p = ctx.profile.personal;
  return {
    ...EMPTY_IDENTITY,
    fullName: p.fullName,
    preferredName: p.preferredName ?? '',
    dateOfBirth: p.dateOfBirth,
    gender: p.gender,
    race: p.race ?? '',
    raceOther: p.raceOther ?? '',
    maritalStatus: p.maritalStatus ?? '',
    maritalEffectiveDate: p.maritalEffectiveDate ?? '',
    passportNo: p.passportNo ?? '',
    passportExpiry: p.passportExpiry ?? '',
    highestQualification: p.highestQualification ?? '',
  };
}

export default function PersonalTab({ ctx, sensitive }: { ctx: ProfileCtx; sensitive: SensitiveView | null }) {
  const { profile } = ctx;
  const p = profile.personal;
  const can = profile.can;
  const own = profile.isOwnRecord;
  const pathname = usePathname();
  const r = useActionRunner();
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState<IdentityForm>(() => toForm(ctx));
  const [dlg, setDlg] = React.useState<'no' | 'photo' | 'mykad' | null>(null);

  const startEdit = () => {
    setForm(toForm(ctx));
    r.reset();
    setEditing(true);
  };
  const save = async () => {
    const res = await r.run(
      () =>
        updatePersonal({
          employeeId: profile.id,
          fullName: form.fullName,
          preferredName: form.preferredName,
          dateOfBirth: form.dateOfBirth,
          dobOverrideConfirmed: form.dobOverrideConfirmed,
          gender: form.gender as 'male',
          genderOverrideConfirmed: form.genderOverrideConfirmed,
          race: form.race,
          raceOther: form.race === 'others' ? form.raceOther : '',
          maritalStatus: form.maritalStatus as 'single',
          maritalEffectiveDate: form.maritalStatus !== (p.maritalStatus ?? '') ? form.maritalEffectiveDate : p.maritalEffectiveDate ?? '',
          passportNo: form.passportNo,
          passportExpiry: form.passportNo ? form.passportExpiry : '',
          highestQualification: form.highestQualification,
        }),
      { success: 'Personal details saved.' },
    );
    if (res?.ok) setEditing(false);
  };

  const locks = own ? { fullName: OWN_LOCK, race: OWN_LOCK, maritalStatus: OWN_LOCK } : {};
  const maritalChanged = form.maritalStatus !== (p.maritalStatus ?? '');

  return (
    <Stack spacing={2}>
      <SectionCard
        title="Personal details"
        canEdit={can.editPersonal}
        editing={editing}
        onEdit={startEdit}
        onCancel={() => setEditing(false)}
        onSave={save}
        saving={r.saving}
        error={r.error}
        fieldErrors={r.fieldErrors}
        fieldLabels={{ fullName: 'Full name', dateOfBirth: 'Date of birth', maritalEffectiveDate: 'Marital status effective date', raceOther: 'Race (other)', passportExpiry: 'Passport expiry' }}
        subtitle={own ? 'This is your own record: legal name, race and marital status need a change request (approved by another Admin or Super Admin).' : undefined}
      >
        {editing ? (
          <IdentityFields
            value={{ ...form, maritalEffectiveDate: maritalChanged ? form.maritalEffectiveDate : form.maritalEffectiveDate }}
            onChange={(patch) => setForm((v) => ({ ...v, ...patch }))}
            errors={r.fieldErrors}
            locks={locks}
            derived={{ dateOfBirth: p.dobOverridden ? null : p.dateOfBirth, gender: p.gender }}
            include={['fullName', 'preferredName', 'dateOfBirth', 'gender', 'race', 'maritalStatus', 'passportNo', 'highestQualification']}
          />
        ) : (
          <KVGrid
            items={[
              {
                label: 'Employee no.',
                value: (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <span>{p.employeeNo}</span>
                    {can.editEmployeeNo && (
                      <Button size="small" onClick={() => setDlg('no')}>
                        Change
                      </Button>
                    )}
                  </Stack>
                ),
              },
              { label: 'Full name (as per MyKad)', value: p.fullName },
              { label: 'Preferred name', value: p.preferredName },
              {
                label: 'MyKad (NRIC) no.',
                value: (
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <MaskedValue masked={p.nricMasked} fieldLabel="MyKad" subject={p.employeeNo} mode={can.reveal ? ctx.revealMode : 'none'} onReveal={revealer(profile.id, 'nric')} />
                    {can.editMykad && !own && (
                      <Button size="small" onClick={() => setDlg('mykad')}>
                        Change
                      </Button>
                    )}
                    {own && <LockIcon fontSize="inherit" titleAccess={OWN_LOCK} sx={{ color: 'text.secondary' }} />}
                  </Stack>
                ),
              },
              { label: 'Date of birth', value: `${dateOr(p.dateOfBirth)}${p.dobOverridden ? ' (overridden — differs from MyKad)' : ''}` },
              { label: 'Age', value: p.age },
              { label: 'Gender', value: GENDER_LABELS[p.gender] },
              { label: 'Nationality', value: p.nationality },
              { label: 'Race', value: p.race ? `${RACE_LABELS[p.race]}${p.raceOther ? ` (${p.raceOther})` : ''}` : '' },
              { label: 'Marital status', value: p.maritalStatus ? `${MARITAL_STATUS_LABELS[p.maritalStatus]}${p.maritalEffectiveDate ? ` since ${dateOr(p.maritalEffectiveDate)}` : ''}` : '' },
              {
                label: 'Marital history',
                value: p.maritalHistory.length > 1 ? p.maritalHistory.map((h) => `${MARITAL_STATUS_LABELS[h.maritalStatus]} from ${dateOr(h.effectiveDate)}`).join(' · ') : '',
                hidden: p.maritalHistory.length <= 1,
              },
              {
                label: 'Photo',
                value: (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Avatar src={p.photoUrl ?? undefined} alt="" sx={{ width: 40, height: 40 }} />
                    {can.editPhoto && (
                      <Button size="small" onClick={() => setDlg('photo')}>
                        Change photo
                      </Button>
                    )}
                  </Stack>
                ),
              },
              { label: 'Passport no.', value: p.passportNo },
              { label: 'Passport expiry', value: dateOr(p.passportExpiry) },
              { label: 'Highest qualification', value: p.highestQualification ? QUALIFICATION_LABELS[p.highestQualification] : '' },
            ]}
          />
        )}
      </SectionCard>

      <SensitiveCard ctx={ctx} sensitive={sensitive} showHref={`${pathname}?tab=personal&sensitive=1`} />

      <ChangeEmployeeNoDialog open={dlg === 'no'} onClose={() => setDlg(null)} profile={profile} />
      <PhotoDialog open={dlg === 'photo'} onClose={() => setDlg(null)} employeeId={profile.id} hasPhoto={Boolean(p.photoFileId)} />
      <MykadDialog open={dlg === 'mykad'} onClose={() => setDlg(null)} employeeId={profile.id} employeeNo={p.employeeNo} />
    </Stack>
  );
}

function SensitiveCard({ ctx, sensitive, showHref }: { ctx: ProfileCtx; sensitive: SensitiveView | null; showHref: string }) {
  const { profile } = ctx;
  const own = profile.isOwnRecord;
  const r = useActionRunner();
  const [editing, setEditing] = React.useState(false);
  const [religion, setReligion] = React.useState('');
  const [isOku, setIsOku] = React.useState(false);
  const [okuCardNo, setOkuCardNo] = React.useState('');
  return (
    <SectionCard
      title="Sensitive details"
      subtitle="Religion and disability (OKU) are special-category data — visible only to the employee, Admin and Super Admin. Viewing is logged."
      canEdit={Boolean(sensitive) && profile.can.editSensitive && !own}
      lockedReason={own ? OWN_LOCK : null}
      editing={editing}
      onEdit={() => {
        setReligion(sensitive?.religion ?? '');
        setIsOku(sensitive?.isOku ?? false);
        setOkuCardNo(sensitive?.okuCardNo ?? '');
        r.reset();
        setEditing(true);
      }}
      onCancel={() => setEditing(false)}
      onSave={async () => {
        const res = await r.run(() => updateSensitive({ employeeId: profile.id, religion, isOku, okuCardNo: isOku ? okuCardNo : '' }), { success: 'Sensitive details saved.' });
        if (res?.ok) setEditing(false);
      }}
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
    >
      {!sensitive ? (
        <Stack spacing={1} alignItems="flex-start">
          <Typography variant="body2" color="text.secondary">
            Religion · Person with disability (OKU) · OKU card no. are hidden.
          </Typography>
          <Button variant="outlined" component={NextLink} href={showHref} scroll={false}>
            Show sensitive details
          </Button>
        </Stack>
      ) : editing ? (
        <IdentityFields
          value={{ ...EMPTY_IDENTITY, religion, isOku, okuCardNo }}
          onChange={(p) => {
            if (p.religion !== undefined) setReligion(p.religion);
            if (p.isOku !== undefined) setIsOku(p.isOku);
            if (p.okuCardNo !== undefined) setOkuCardNo(p.okuCardNo);
          }}
          errors={r.fieldErrors}
          include={['religion', 'isOku']}
        />
      ) : (
        <KVGrid
          items={[
            { label: 'Religion', value: sensitive.religion ? RELIGION_LABELS[sensitive.religion] : '' },
            { label: 'Person with disability (OKU)', value: sensitive.isOku ? 'Yes' : 'No' },
            { label: 'OKU card no.', value: sensitive.okuCardNo, hidden: !sensitive.isOku },
          ]}
        />
      )}
    </SectionCard>
  );
}

function MykadDialog({ open, onClose, employeeId, employeeNo }: { open: boolean; onClose: () => void; employeeId: string; employeeNo: string }) {
  const r = useActionRunner();
  const [v, setV] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setV('');
      r.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <FormDialog
      open={open}
      title={`Change MyKad — ${employeeNo}`}
      onClose={onClose}
      submitLabel="Save MyKad"
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty={v !== ''}
      onSubmit={async () => {
        const res = await r.run(() => updateMykad({ employeeId, mykad: v }), { success: 'MyKad updated.' });
        if (res?.ok) onClose();
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Enter the new number in full. Date of birth and gender stay as recorded — update them separately if needed. The change is logged (masked).
      </Typography>
      <MykadInput value={v} onChange={setV} error={r.fieldErrors.mykad} label="New MyKad no." />
    </FormDialog>
  );
}
