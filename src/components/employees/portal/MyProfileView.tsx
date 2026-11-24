'use client';

// P16 · My profile — S-PT-16 · /my/profile · F-PRT-08, F-EMP-03/06/07/20 · US-PORTAL-008, US-EMP-004/006/018.
// Header card: photo (CHANGE PHOTO ✎) · A2 · A3 · A1 · F11 · F10 · F13 · F9 ● · F1 · F24.
// Tabs (phone: scrollable chips). ✎ = inline EDIT → SAVE/CANCEL (toast "Saved. HR has been
// notified." — N-40) · CR = read-only + REQUEST CHANGE → P17 pre-filled · 🔒 read-only.
// Employer-only statutory flags are never part of this view. An Admin's own record also lands
// here (EC-EMP-10).
import * as React from 'react';
import NextLink from 'next/link';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import {
  CR_CATEGORY_LABELS,
  GENDER_LABELS,
  MARITAL_STATUS_LABELS,
  QUALIFICATION_LABELS,
  RACE_LABELS,
  RELIGION_LABELS,
  formatMykad,
  lengthOfServiceText,
  type CrCategory,
  type MyProfile,
  type PriorEmploymentView,
  type SpouseView,
} from '@/server/contracts/employees';
import { deletePriorEmployment, revealMyValue, updateMyContact, updateMyPersonal, updateMySpousePhone } from '@/server/actions/employees';
import FormDialog from '../../forms/FormDialog';
import ConfirmDialog from '../../dialogs/ConfirmDialog';
import { TextInput } from '../../forms/fields';
import { useActionRunner } from '../../forms/useActionRunner';
import { ContactFields, EMPTY_IDENTITY, IdentityFields, contactToForm, type ContactForm, type IdentityForm } from '../fieldGroups';
import { ProfileTabs, SectionCard, TabPlaceholder, KVGrid, useTabParam, type TabDef } from '../ui';
import { EmploymentStatusChip, dateOr } from '../labels';
import { ContactReadOnly, EmergencyCard } from '../profile/ContactTab';
import { ChildrenTable, DerivedCounts, FamilyFlags, SpousesTable } from '../profile/FamilyTab';
import { EmploymentFacts, JobHistoryTable, PriorEmploymentCard, PriorEmploymentDialog, SeparationFacts } from '../profile/EmploymentTab';
import { StatutoryReadOnly } from '../profile/StatutoryTab';
import { BankFacts } from '../profile/BankTab';
import { PhotoDialog } from '../profile/dialogs';
import type { RevealReason } from '../MaskedValue';

function ownReveal(field: 'bank_account_no' | 'asnb_account_no' | 'spouse_nric' | 'child_nric', rowId?: string) {
  return async (_r: RevealReason | null) => {
    const res = await revealMyValue({ field, rowId: rowId ?? undefined });
    return res.ok ? { ok: true as const, value: res.value } : { ok: false as const, error: res.error };
  };
}

function RequestChange({ category, open }: { category: CrCategory; open: Partial<Record<CrCategory, string>> }) {
  const crNo = open[category];
  if (crNo)
    return (
      <Link component={NextLink} href={`/my/profile/change-requests/${encodeURIComponent(crNo)}`} variant="body2">
        Open request {crNo} ›
      </Link>
    );
  return (
    <Button size="small" variant="outlined" component={NextLink} href={`/my/profile/change-requests/new?category=${category}`}>
      Request change{category === 'statutory_numbers' || category === 'bank_details' ? '' : ` (${CR_CATEGORY_LABELS[category].toLowerCase()})`}
    </Button>
  );
}

export default function MyProfileView({ me }: { me: MyProfile }) {
  const p = me.personal;
  const e = me.employment;
  const tabs: TabDef[] = [
    { value: 'personal', label: 'Personal' },
    { value: 'contact', label: 'Contact & emergency' },
    { value: 'family', label: 'Family' },
    { value: 'employment', label: 'Employment' },
    { value: 'statutory', label: 'Statutory & tax' },
    { value: 'bank', label: 'Bank' },
    { value: 'leave', label: 'Leave' },
    { value: 'claims', label: 'Claims' },
    { value: 'documents', label: 'Documents' },
    { value: 'change_requests', label: 'Change requests' },
    { value: 'compensation', label: 'Compensation', hint: 'Release 1.1' },
  ];
  const [tab, setTab] = useTabParam(tabs, 'personal');
  const [photo, setPhoto] = React.useState(false);
  const open = me.openChangeRequests;

  return (
    <Box>
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Box sx={{ position: 'relative' }}>
              <Avatar src={p.photoUrl ?? undefined} alt="" sx={{ width: 72, height: 72, fontSize: 28 }}>
                {p.fullName.charAt(0)}
              </Avatar>
              <IconButton size="small" aria-label="Change photo" onClick={() => setPhoto(true)} sx={{ position: 'absolute', right: -8, bottom: -8, bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'background.paper' } }}>
                <EditOutlinedIcon fontSize="small" />
              </IconButton>
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="h4" component="p">
                  {p.fullName}
                </Typography>
                <EmploymentStatusChip status={e.status} />
              </Stack>
              <Typography color="text.secondary">
                {p.preferredName ? `${p.preferredName} · ` : ''}
                {p.employeeNo}
              </Typography>
              <Typography color="text.secondary">
                {e.position.label} · {e.department.label} · Manager: {e.manager?.name ?? '—'}
              </Typography>
              <Typography color="text.secondary">
                Joined {dateOr(e.joinDate)} · {lengthOfServiceText(e.lengthOfService)}
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>
      <ProfileTabs tabs={tabs} value={tab} onChange={setTab} label="My profile sections" />
      {tab === 'personal' && <PersonalSection me={me} />}
      {tab === 'contact' && (
        <Stack spacing={2}>
          <ContactSection me={me} />
          <EmergencyCard employeeId={me.id} rows={me.emergencyContacts} canEdit self />
        </Stack>
      )}
      {tab === 'family' && <FamilySection me={me} />}
      {tab === 'employment' && <EmploymentSection me={me} />}
      {tab === 'statutory' && (
        <SectionCard title="Statutory & tax" subtitle="Used by payroll from Release 1.1. Employer-only settings are not shown." headerActions={<RequestChange category="statutory_numbers" open={open} />}>
          <StatutoryReadOnly s={me.statutory} />
        </SectionCard>
      )}
      {tab === 'bank' && (
        <SectionCard title="Bank details & ASNB" subtitle="Showing your full account number is logged." headerActions={<RequestChange category="bank_details" open={open} />}>
          {me.bank.current ? <BankFacts b={me.bank.current} revealMode="owner" onReveal={(f) => ownReveal(f, me.bank.current?.id)} /> : <Typography color="text.secondary">No bank details recorded. Use REQUEST CHANGE to add them.</Typography>}
        </SectionCard>
      )}
      {tab === 'leave' && (
        <TabPlaceholder
          title="My leave"
          body="Your leave balances, applications and replacement credits."
          links={[
            { label: 'My balances', href: '/my/leave/balances' },
            { label: 'My applications', href: '/my/leave' },
            { label: 'Apply leave', href: '/my/leave/apply' },
          ]}
        />
      )}
      {tab === 'claims' && (
        <TabPlaceholder
          title="My claims"
          body="Your claims, their status and your limit utilisation are on My claims."
          links={[
            { label: 'My claims', href: '/my/claims' },
            { label: 'New claim', href: '/my/claims/new' },
          ]}
        />
      )}
      {tab === 'documents' && <TabPlaceholder title="My documents" body="Documents HR has shared with you." links={[{ label: 'Open my documents', href: '/my/documents' }]} />}
      {tab === 'change_requests' && (
        <TabPlaceholder title="My change requests" body="Requests to change legal name, MyKad, family, OKU, religion, race, bank or statutory numbers." links={[{ label: 'View my requests', href: '/my/profile/change-requests' }, { label: 'New request', href: '/my/profile/change-requests/new' }]} />
      )}
      {tab === 'compensation' && <TabPlaceholder title="Compensation arrives with payroll" body="Your basic salary and recurring pay items are shown from Release 1.1." />}
      <PhotoDialog open={photo} onClose={() => setPhoto(false)} employeeId={me.id} hasPhoto={Boolean(p.photoFileId)} />
    </Box>
  );
}

function PersonalSection({ me }: { me: MyProfile }) {
  const p = me.personal;
  const open = me.openChangeRequests;
  const r = useActionRunner();
  const [editing, setEditing] = React.useState(false);
  const [f, setF] = React.useState<IdentityForm>(EMPTY_IDENTITY);
  return (
    <Stack spacing={2}>
      <SectionCard
        title="Personal details"
        canEdit
        editLabel="Edit"
        subtitle="You can update your preferred name, passport and qualification. Other details need a change request."
        editing={editing}
        onEdit={() => {
          r.reset();
          setF({ ...EMPTY_IDENTITY, preferredName: p.preferredName ?? '', passportNo: p.passportNo ?? '', passportExpiry: p.passportExpiry ?? '', highestQualification: p.highestQualification ?? '' });
          setEditing(true);
        }}
        onCancel={() => setEditing(false)}
        onSave={async () => {
          const res = await r.run(() => updateMyPersonal({ preferredName: f.preferredName, passportNo: f.passportNo, passportExpiry: f.passportNo ? f.passportExpiry : '', highestQualification: f.highestQualification }), {
            success: 'Saved. HR has been notified.',
          });
          if (res?.ok) setEditing(false);
        }}
        saving={r.saving}
        error={r.error}
        fieldErrors={r.fieldErrors}
      >
        {editing ? (
          <IdentityFields value={f} onChange={(x) => setF((v) => ({ ...v, ...x }))} errors={r.fieldErrors} include={['preferredName', 'passportNo', 'highestQualification']} />
        ) : (
          <KVGrid
            items={[
              { label: 'Employee no.', value: p.employeeNo },
              { label: 'Full name (as per MyKad)', value: p.fullName },
              { label: 'Preferred name', value: p.preferredName },
              { label: 'MyKad (NRIC) no.', value: formatMykad(p.nric) },
              { label: 'Date of birth', value: dateOr(p.dateOfBirth) },
              { label: 'Age', value: p.age },
              { label: 'Gender', value: GENDER_LABELS[p.gender] },
              { label: 'Nationality', value: p.nationality },
              { label: 'Race', value: p.race ? `${RACE_LABELS[p.race]}${p.raceOther ? ` (${p.raceOther})` : ''}` : '' },
              { label: 'Religion', value: p.religion ? RELIGION_LABELS[p.religion] : '' },
              { label: 'Marital status', value: p.maritalStatus ? `${MARITAL_STATUS_LABELS[p.maritalStatus]}${p.maritalEffectiveDate ? ` since ${dateOr(p.maritalEffectiveDate)}` : ''}` : '' },
              { label: 'Person with disability (OKU)', value: p.isOku ? 'Yes' : 'No' },
              { label: 'OKU card no.', value: p.okuCardNo, hidden: !p.isOku },
              { label: 'Passport no.', value: p.passportNo },
              { label: 'Passport expiry', value: dateOr(p.passportExpiry) },
              { label: 'Highest qualification', value: p.highestQualification ? QUALIFICATION_LABELS[p.highestQualification] : '' },
            ]}
          />
        )}
      </SectionCard>
      <SectionCard title="Request a change" subtitle="These details are checked by HR before they change. Attach the supporting document asked for.">
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {(['legal_name', 'mykad', 'race', 'religion', 'marital_spouse', 'oku'] as CrCategory[]).map((c) => (
            <RequestChange key={c} category={c} open={open} />
          ))}
        </Stack>
      </SectionCard>
    </Stack>
  );
}

function ContactSection({ me }: { me: MyProfile }) {
  const r = useActionRunner();
  const [editing, setEditing] = React.useState(false);
  const [f, setF] = React.useState<ContactForm>(() => contactToForm(me.contact));
  return (
    <SectionCard
      title="Contact & address"
      canEdit
      editing={editing}
      onEdit={() => {
        r.reset();
        setF(contactToForm(me.contact));
        setEditing(true);
      }}
      onCancel={() => setEditing(false)}
      onSave={async () => {
        const res = await r.run(
          () => updateMyContact({ personalEmail: f.personalEmail, mobilePhone: f.mobilePhone, residentialAddress: f.residential, mailingSameAsResidential: f.mailingSame, mailingAddress: f.mailingSame ? null : f.mailing } as Parameters<typeof updateMyContact>[0]),
          { success: 'Saved. HR has been notified.' },
        );
        if (res?.ok) setEditing(false);
      }}
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
    >
      {editing ? (
        <ContactFields value={f} onChange={(x) => setF((v) => ({ ...v, ...x }))} errors={r.fieldErrors} locks={{ workEmail: 'Set by HR — your sign-in email.', workPhone: 'Set by HR.' }} />
      ) : (
        <ContactReadOnly c={me.contact} />
      )}
    </SectionCard>
  );
}

function FamilySection({ me }: { me: MyProfile }) {
  const [phoneFor, setPhoneFor] = React.useState<SpouseView | null>(null);
  const reveal = (field: 'spouse_nric' | 'child_nric', rowId: string) => ownReveal(field, rowId);
  return (
    <Stack spacing={2}>
      <FamilyFlags flags={me.family.flags} />
      <SectionCard title="Spouses" headerActions={<RequestChange category="marital_spouse" open={me.openChangeRequests} />}>
        <SpousesTable
          rows={me.family.spouses}
          revealMode="owner"
          reveal={reveal}
          actions={(s) => (
            <Button size="small" onClick={() => setPhoneFor(s)}>
              Edit phone
            </Button>
          )}
        />
      </SectionCard>
      <SectionCard title="Children" headerActions={<RequestChange category="children" open={me.openChangeRequests} />}>
        <ChildrenTable rows={me.family.children} revealMode="owner" reveal={reveal} />
      </SectionCard>
      <SectionCard title="Derived counts">
        <DerivedCounts family={me.family} showRelief={false} />
      </SectionCard>
      <SpousePhoneDialog spouse={phoneFor} onClose={() => setPhoneFor(null)} />
    </Stack>
  );
}

function SpousePhoneDialog({ spouse, onClose }: { spouse: SpouseView | null; onClose: () => void }) {
  const r = useActionRunner();
  const [v, setV] = React.useState('');
  React.useEffect(() => {
    if (spouse) {
      r.reset();
      setV(spouse.phone ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spouse]);
  return (
    <FormDialog
      open={spouse !== null}
      title="Spouse phone"
      onClose={onClose}
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty={v !== (spouse?.phone ?? '')}
      onSubmit={async () => {
        if (!spouse) return;
        const res = await r.run(() => updateMySpousePhone({ spouseId: spouse.id, phone: v }), { success: 'Saved. HR has been notified.' });
        if (res?.ok) onClose();
      }}
    >
      <TextInput label={`Phone — ${spouse?.fullName ?? ''}`} type="tel" value={v} onChange={setV} maxLength={20} error={r.fieldErrors.phone} />
    </FormDialog>
  );
}

function EmploymentSection({ me }: { me: MyProfile }) {
  const [prior, setPrior] = React.useState<PriorEmploymentView | 'new' | null>(null);
  const [del, setDel] = React.useState<PriorEmploymentView | null>(null);
  const r = useActionRunner();
  return (
    <Stack spacing={2}>
      <SectionCard title="Employment">
        <EmploymentFacts e={me.employment} />
      </SectionCard>
      <SectionCard title="Job history">
        <JobHistoryTable rows={me.jobHistory} showRemarks={false} />
      </SectionCard>
      {me.separation && (
        <SectionCard title="Separation">
          <SeparationFacts s={me.separation} />
        </SectionCard>
      )}
      <PriorEmploymentCard rows={me.priorEmployments} canEdit onAdd={() => setPrior('new')} onEdit={(x) => setPrior(x)} onDelete={(x) => setDel(x)} />
      <PriorEmploymentDialog open={prior !== null} onClose={() => setPrior(null)} employeeId={me.id} row={prior === 'new' ? null : prior} joinDate={me.employment.joinDate} />
      <ConfirmDialog
        open={del !== null}
        title="Delete this prior employment?"
        body={del ? `${del.employer} · ${del.position}` : undefined}
        confirmLabel="Delete"
        destructive
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (del) await r.run(() => deletePriorEmployment({ id: del.id }), { success: 'Deleted.' });
          setDel(null);
        }}
      />
    </Stack>
  );
}

export function NoEmployeeRecord() {
  return (
    <Grid container justifyContent="center">
      <Grid size={{ xs: 12, md: 8 }}>
        <TabPlaceholder title="Your employee record has not been created yet." body="HR will create it. Until then, the self-service profile, change requests and documents are not available for your account." />
      </Grid>
    </Grid>
  );
}
