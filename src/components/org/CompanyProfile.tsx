'use client';

// O1 · Company profile — S-OR-01 · /organisation/company · F-ORG-01 · US-ORG-001.
// Section cards, SAVE per card. SA edits registration, statutory numbers, paying account,
// zakat, signatories and logo; ADM edits contact and GL mapping and sees the rest read-only
// with "Only a Super Admin can change this." Bank account masked ••••4321; reveal is logged.
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LockIcon from '@mui/icons-material/Lock';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import type { Address, CompanyProfileView, GlPurpose, MyState, ZakatBodyOption } from '@/server/contracts/org';
import {
  confirmCompanyAssetUpload,
  requestCompanyAssetUpload,
  revealPayingAccount,
  saveCompanyRegistration,
  saveCompanyStatutory,
  saveGlMappings,
  savePayingAccount,
  saveSignatories,
  saveZakatRegistrations,
  setCompanyLogo,
  updateCompanyContact,
} from '@/server/actions/org';
import FormCard from '../forms/FormCard';
import { FormGrid, FullRow, KeyValue, SelectInput, SwitchInput, TextInput } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import ResponsiveDialog from '../dialogs/ResponsiveDialog';
import { useToast } from '../ToastProvider';
import AddressFields, { EMPTY_ADDRESS, type AddressValue } from './AddressFields';
import { MY_STATE_LABELS } from './labels';
import { stampsMeta } from './common';
import { MAX_UPLOAD_BYTES, putToSignedUrl } from '@/lib/upload';

const SA_ONLY = 'Only a Super Admin can change this.';

const toAddr = (a: Address | null | undefined): AddressValue =>
  a ? { line1: a.line1, line2: a.line2 ?? '', line3: a.line3 ?? '', postcode: a.postcode, city: a.city, state: a.state } : { ...EMPTY_ADDRESS };
const fromAddr = (a: AddressValue) => ({ ...a, state: a.state as MyState, country: 'Malaysia' });

/** Upload a PNG/JPEG company asset (logo / signature) through the signed-upload flow. */
async function uploadAsset(kind: 'logo' | 'signature', file: File): Promise<{ ok: true; fileId: string } | { ok: false; error: string }> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) return { ok: false, error: 'Upload a PNG or JPEG image.' };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: 'The file must be 10 MB or smaller.' };
  const intent = await requestCompanyAssetUpload({ kind, fileName: file.name, mimeType: file.type as 'image/png' | 'image/jpeg', sizeBytes: file.size });
  if (!intent.ok) return { ok: false, error: intent.error };
  if (!(await putToSignedUrl(intent.signedUrl, file))) return { ok: false, error: 'Upload failed. Please try again.' };
  const done = await confirmCompanyAssetUpload({ fileId: intent.fileId });
  return done.ok ? { ok: true, fileId: done.fileId } : { ok: false, error: done.error };
}

function FilePickButton({ label, accept, onFile, disabled }: { label: string; accept: string; onFile: (f: File) => void; disabled?: boolean }) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <Button variant="outlined" color="inherit" startIcon={<UploadFileOutlinedIcon />} onClick={() => ref.current?.click()} disabled={disabled}>
        {label}
      </Button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </>
  );
}

export default function CompanyProfile({
  view,
  logoUrl,
  zakatBodies,
  isSuperAdmin,
}: {
  view: CompanyProfileView;
  logoUrl: string | null;
  zakatBodies: ZakatBodyOption[];
  isSuperAdmin: boolean;
}) {
  const { profile, statutory, can } = view;
  const toast = useToast();

  // ---- Company + addresses (CO1–CO4, CO6) — SA ----------------------------------
  const regInit = React.useMemo(
    () => ({
      legalName: profile.legalName,
      ssmNoNew: statutory?.ssmNoNew ?? '',
      ssmNoOld: statutory?.ssmNoOld ?? '',
      registeredAddress: toAddr(statutory?.registeredAddress),
      businessAddress: toAddr(profile.businessAddress),
    }),
    [profile, statutory],
  );
  const [reg, setReg] = React.useState(regInit);
  React.useEffect(() => setReg(regInit), [regInit]);
  const regRun = useActionRunner();
  const nestedErrors = (prefix: string) =>
    Object.fromEntries(Object.entries(regRun.fieldErrors).filter(([k]) => k.startsWith(prefix + '.')).map(([k, v]) => [k.slice(prefix.length + 1), v]));
  const [logoBusy, setLogoBusy] = React.useState(false);
  const regLock = can.editRegistration ? null : SA_ONLY;

  // ---- Contact (CO5) — ADM + SA ---------------------------------------------------
  const contactInit = React.useMemo(() => ({ phone: profile.phone ?? '', email: profile.email ?? '', website: profile.website ?? '' }), [profile]);
  const [contact, setContact] = React.useState(contactInit);
  React.useEffect(() => setContact(contactInit), [contactInit]);
  const contactRun = useActionRunner();

  // ---- Statutory (CO7–CO11) — SA --------------------------------------------------
  const statInit = React.useMemo(
    () => ({
      epfEmployerNo: statutory?.epfEmployerNo ?? '',
      socsoEmployerCode: statutory?.socsoEmployerCode ?? '',
      lhdnENo: statutory?.lhdnENo ?? '',
      companyTaxNo: statutory?.companyTaxNo ?? '',
      hrdfRegistered: statutory?.hrdfRegistered ?? false,
      hrdfLevyRatePct: statutory?.hrdfLevyRatePct == null ? '' : String(statutory.hrdfLevyRatePct),
      hrdfMycoid: statutory?.hrdfMycoid ?? '',
    }),
    [statutory],
  );
  const [stat, setStat] = React.useState(statInit);
  React.useEffect(() => setStat(statInit), [statInit]);
  const statRun = useActionRunner();
  const statLock = can.editStatutory ? (statutory ? null : 'Save the company registration first.') : SA_ONLY;

  // ---- Zakat (CO12) — SA -----------------------------------------------------------
  const zakatInit = React.useMemo(() => view.zakatRegistrations.map((z) => ({ zakatBodyId: z.zakatBodyId, employerRef: z.employerRef })), [view.zakatRegistrations]);
  const [zakat, setZakat] = React.useState(zakatInit);
  React.useEffect(() => setZakat(zakatInit), [zakatInit]);
  const zakatRun = useActionRunner();

  // ---- Paying account (CO13) — SA ---------------------------------------------------
  const [acct, setAcct] = React.useState({ accountName: statutory?.hlbAccountName ?? '', accountNo: '' });
  React.useEffect(() => setAcct({ accountName: statutory?.hlbAccountName ?? '', accountNo: '' }), [statutory?.hlbAccountName, statutory?.hlbAccountNoMasked]);
  const acctRun = useActionRunner();
  const [revealOpen, setRevealOpen] = React.useState(false);
  const [revealReason, setRevealReason] = React.useState('');
  const [revealed, setRevealed] = React.useState<string | null>(null);
  const revealRun = useActionRunner();

  // ---- Signatories (CO14) — SA --------------------------------------------------------
  const sigInit = React.useMemo(
    () =>
      view.signatories
        .filter((s) => s.isActive)
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((s) => ({ id: s.id as string | null, name: s.name, designation: s.designation, signatureFileId: s.signatureFileId, isActive: true })),
    [view.signatories],
  );
  const [sigs, setSigs] = React.useState(sigInit);
  React.useEffect(() => setSigs(sigInit), [sigInit]);
  const [removedSigs, setRemovedSigs] = React.useState<string[]>([]);
  const sigRun = useActionRunner();
  const [sigUploading, setSigUploading] = React.useState<number | null>(null);

  // ---- GL mapping (CO15) — ADM + SA -------------------------------------------------
  const glInit = React.useMemo(() => Object.fromEntries(view.glMappings.map((g) => [g.purpose, g.glAccountCode ?? ''])) as Record<GlPurpose, string>, [view.glMappings]);
  const [gl, setGl] = React.useState(glInit);
  React.useEffect(() => setGl(glInit), [glInit]);
  const glRun = useActionRunner();

  const zakatOptions = zakatBodies.map((z) => ({ value: z.id, label: `${z.name} (${MY_STATE_LABELS[z.state]})` }));

  return (
    <Stack spacing={2}>
      {/* Company + Addresses */}
      <FormCard
        title="Company"
        subtitle="Legal name, SSM registration and logo appear on the login page, payslips and EA forms."
        lockedReason={regLock}
        onSave={() =>
          regRun.run(
            () =>
              saveCompanyRegistration({
                legalName: reg.legalName,
                ssmNoNew: reg.ssmNoNew,
                ssmNoOld: reg.ssmNoOld,
                registeredAddress: fromAddr(reg.registeredAddress),
                businessAddress: fromAddr(reg.businessAddress),
              }),
            { success: 'Company registration and addresses saved.' },
          )
        }
        saving={regRun.saving}
        dirty={JSON.stringify(reg) !== JSON.stringify(regInit)}
        error={regRun.error}
        fieldErrors={regRun.fieldErrors}
        fieldLabels={{ legalName: 'Legal name', ssmNoNew: 'SSM registration no. (new)', ssmNoOld: 'SSM registration no. (old)' }}
        meta={stampsMeta(profile)}
      >
        <FormGrid>
          <TextInput full label="Legal name" required value={reg.legalName} onChange={(v) => setReg({ ...reg, legalName: v })} maxLength={150} error={regRun.fieldErrors.legalName} locked={regLock ?? false} />
          <TextInput
            label="SSM registration no. (new)"
            required
            value={reg.ssmNoNew}
            onChange={(v) => setReg({ ...reg, ssmNoNew: v.replace(/\D/g, '') })}
            maxLength={12}
            inputMode="numeric"
            helper="12 digits"
            error={regRun.fieldErrors.ssmNoNew}
            locked={regLock ?? false}
          />
          <TextInput label="SSM registration no. (old)" value={reg.ssmNoOld} onChange={(v) => setReg({ ...reg, ssmNoOld: v })} maxLength={10} helper="e.g. 123456-X" error={regRun.fieldErrors.ssmNoOld} locked={regLock ?? false} />
          <FullRow>
            <Typography variant="subtitle2" component="p" sx={{ mb: 1 }}>
              Logo *
            </Typography>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <Box
                sx={{ width: 160, height: 64, border: '1px solid', borderColor: 'divider', borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#F7F7F9', overflow: 'hidden' }}
              >
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Company logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    No logo yet
                  </Typography>
                )}
              </Box>
              {can.editRegistration && (
                <FilePickButton
                  label={logoBusy ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
                  accept="image/png,image/jpeg"
                  disabled={logoBusy}
                  onFile={async (f) => {
                    setLogoBusy(true);
                    const up = await uploadAsset('logo', f);
                    if (!up.ok) {
                      regRun.setError(up.error);
                      setLogoBusy(false);
                      return;
                    }
                    await regRun.run(() => setCompanyLogo({ fileId: up.fileId }), { success: 'Logo updated.' });
                    setLogoBusy(false);
                  }}
                />
              )}
              <Typography variant="caption" color="text.secondary">
                PNG or JPEG, up to 10 MB. Used on login, the app shell, payslips and EA forms.
              </Typography>
            </Stack>
          </FullRow>
        </FormGrid>
      </FormCard>

      <FormCard
        title="Addresses"
        lockedReason={regLock}
        onSave={() =>
          regRun.run(
            () =>
              saveCompanyRegistration({
                legalName: reg.legalName,
                ssmNoNew: reg.ssmNoNew,
                ssmNoOld: reg.ssmNoOld,
                registeredAddress: fromAddr(reg.registeredAddress),
                businessAddress: fromAddr(reg.businessAddress),
              }),
            { success: 'Company registration and addresses saved.' },
          )
        }
        saving={regRun.saving}
        dirty={JSON.stringify(reg) !== JSON.stringify(regInit)}
        fieldErrors={Object.fromEntries(Object.entries(regRun.fieldErrors).filter(([k]) => /Address/.test(k)))}
        fieldLabels={{ registeredAddress: 'Registered address', businessAddress: 'Business address' }}
      >
        <Stack spacing={3}>
          <AddressFields legend="Registered address" value={reg.registeredAddress} onChange={(a) => setReg({ ...reg, registeredAddress: a })} errors={nestedErrors('registeredAddress')} locked={regLock ?? false} />
          <AddressFields legend="Business address" value={reg.businessAddress} onChange={(a) => setReg({ ...reg, businessAddress: a })} errors={nestedErrors('businessAddress')} locked={regLock ?? false} />
        </Stack>
      </FormCard>

      {/* Contact */}
      <FormCard
        title="Contact"
        lockedReason={can.editContact ? null : 'Read only'}
        onSave={() =>
          contactRun.run(() => updateCompanyContact({ ...contact, version: profile.version }), {
            success: 'Company contact details saved.',
          })
        }
        saving={contactRun.saving}
        dirty={JSON.stringify(contact) !== JSON.stringify(contactInit)}
        error={contactRun.error}
        fieldErrors={contactRun.fieldErrors}
        fieldLabels={{ phone: 'Phone', email: 'Email', website: 'Website', version: 'Record' }}
      >
        <FormGrid>
          <TextInput label="Phone" value={contact.phone} onChange={(v) => setContact({ ...contact, phone: v })} maxLength={30} inputMode="tel" error={contactRun.fieldErrors.phone} locked={!can.editContact && 'Read only'} />
          <TextInput label="Email" type="email" value={contact.email} onChange={(v) => setContact({ ...contact, email: v })} maxLength={254} error={contactRun.fieldErrors.email} locked={!can.editContact && 'Read only'} />
          <TextInput full label="Website" value={contact.website} onChange={(v) => setContact({ ...contact, website: v })} maxLength={200} helper="Starts with http:// or https://" error={contactRun.fieldErrors.website} locked={!can.editContact && 'Read only'} />
        </FormGrid>
      </FormCard>

      {/* Statutory employer numbers */}
      <FormCard
        title="Statutory employer numbers"
        subtitle="Numbers marked (R1.1) are needed for payroll in Release 1.1."
        lockedReason={statLock}
        onSave={() =>
          statRun.run(
            () =>
              saveCompanyStatutory({
                ...stat,
                hrdfLevyRatePct: stat.hrdfRegistered ? stat.hrdfLevyRatePct : '',
              }),
            { success: 'Statutory employer numbers saved.' },
          )
        }
        saving={statRun.saving}
        dirty={JSON.stringify(stat) !== JSON.stringify(statInit)}
        error={statRun.error}
        fieldErrors={statRun.fieldErrors}
        fieldLabels={{ epfEmployerNo: 'EPF employer no.', socsoEmployerCode: 'SOCSO / EIS employer code', lhdnENo: 'LHDN E-number', companyTaxNo: 'Company income tax no.', hrdfLevyRatePct: 'HRDF levy rate', hrdfMycoid: 'MyCoID' }}
        meta={statutory ? stampsMeta(statutory) : null}
      >
        <FormGrid>
          <TextInput label="EPF employer no. (R1.1)" value={stat.epfEmployerNo} onChange={(v) => setStat({ ...stat, epfEmployerNo: v.replace(/\D/g, '') })} maxLength={9} inputMode="numeric" helper="Digits, up to 9" error={statRun.fieldErrors.epfEmployerNo} locked={statLock ?? false} />
          <TextInput label="SOCSO / EIS employer code (R1.1)" value={stat.socsoEmployerCode} onChange={(v) => setStat({ ...stat, socsoEmployerCode: v })} maxLength={12} error={statRun.fieldErrors.socsoEmployerCode} locked={statLock ?? false} />
          <TextInput label="LHDN employer no. (E-number) (R1.1)" value={stat.lhdnENo} onChange={(v) => setStat({ ...stat, lhdnENo: v.toUpperCase() })} maxLength={11} helper='"E" followed by digits' error={statRun.fieldErrors.lhdnENo} locked={statLock ?? false} />
          <TextInput label="Company income tax no." value={stat.companyTaxNo} onChange={(v) => setStat({ ...stat, companyTaxNo: v })} maxLength={14} error={statRun.fieldErrors.companyTaxNo} locked={statLock ?? false} />
          <SwitchInput label="HRDF registered" checked={stat.hrdfRegistered} onChange={(v) => setStat({ ...stat, hrdfRegistered: v, hrdfLevyRatePct: v ? stat.hrdfLevyRatePct || '1' : '' })} helper="Registration is optional below 10 employees (verify, Q2)" locked={statLock ?? false} />
          <SelectInput
            label="HRDF levy rate"
            required={stat.hrdfRegistered}
            value={stat.hrdfRegistered ? stat.hrdfLevyRatePct : ''}
            onChange={(v) => setStat({ ...stat, hrdfLevyRatePct: v })}
            options={[
              { value: '1', label: '1%' },
              { value: '0.5', label: '0.5%' },
            ]}
            emptyLabel="n.a."
            disabled={!stat.hrdfRegistered}
            error={statRun.fieldErrors.hrdfLevyRatePct}
            locked={statLock ?? false}
          />
          <TextInput label="MyCoID" value={stat.hrdfMycoid} onChange={(v) => setStat({ ...stat, hrdfMycoid: v })} maxLength={30} error={statRun.fieldErrors.hrdfMycoid} locked={statLock ?? false} />
        </FormGrid>
      </FormCard>

      {/* Zakat employer registrations */}
      <FormCard
        title="Zakat employer registrations"
        subtitle="(R1.1) Used for zakat deductions and the zakat report."
        lockedReason={can.editStatutory ? null : SA_ONLY}
        onSave={() => zakatRun.run(() => saveZakatRegistrations({ rows: zakat }), { success: 'Zakat registrations saved.' })}
        saving={zakatRun.saving}
        dirty={JSON.stringify(zakat) !== JSON.stringify(zakatInit)}
        error={zakatRun.error}
        fieldErrors={zakatRun.fieldErrors}
        fieldLabels={{ rows: 'Rows' }}
        actions={
          can.editStatutory ? (
            <Button variant="outlined" color="inherit" startIcon={<AddIcon />} onClick={() => setZakat([...zakat, { zakatBodyId: '', employerRef: '' }])} disabled={zakat.length >= 16}>
              Add row
            </Button>
          ) : undefined
        }
      >
        {zakat.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No zakat registrations.
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {zakat.map((z, i) => (
              <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }}>
                <Box sx={{ flex: 2 }}>
                  <SelectInput
                    label="Zakat body"
                    required
                    value={z.zakatBodyId}
                    onChange={(v) => setZakat(zakat.map((r, j) => (j === i ? { ...r, zakatBodyId: v } : r)))}
                    options={zakatOptions}
                    error={zakatRun.fieldErrors[`rows.${i}.zakatBodyId`]}
                    locked={!can.editStatutory && SA_ONLY}
                  />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <TextInput
                    label="Employer ref"
                    required
                    value={z.employerRef}
                    onChange={(v) => setZakat(zakat.map((r, j) => (j === i ? { ...r, employerRef: v } : r)))}
                    maxLength={30}
                    error={zakatRun.fieldErrors[`rows.${i}.employerRef`]}
                    locked={!can.editStatutory && SA_ONLY}
                  />
                </Box>
                {can.editStatutory && (
                  <IconButton aria-label={`Remove zakat row ${i + 1}`} onClick={() => setZakat(zakat.filter((_, j) => j !== i))} sx={{ mt: { sm: 0.5 } }}>
                    <DeleteOutlineIcon />
                  </IconButton>
                )}
              </Stack>
            ))}
          </Stack>
        )}
      </FormCard>

      {/* Paying bank account */}
      <FormCard
        title="Paying bank account"
        subtitle="Used on HLB payment-list headers only."
        lockedReason={can.editStatutory ? (statutory ? null : 'Save the company registration first.') : SA_ONLY}
        onSave={() =>
          acctRun.run(() => savePayingAccount(acct), {
            success: 'Paying bank account saved.',
          })
        }
        saving={acctRun.saving}
        dirty={acct.accountName !== (statutory?.hlbAccountName ?? '') || acct.accountNo !== ''}
        error={acctRun.error}
        fieldErrors={acctRun.fieldErrors}
        fieldLabels={{ accountName: 'Account name', accountNo: 'Account no.' }}
      >
        <FormGrid>
          <TextInput label="Bank" value="Hong Leong Bank" onChange={() => undefined} locked="Fixed: HLB Connect First" />
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Box sx={{ flex: 1 }}>
                <KeyValue label="Account no." value={<span className="pret-tnum">{revealed ?? statutory?.hlbAccountNoMasked ?? 'Not set'}</span>} />
              </Box>
              {statutory?.hlbAccountNoMasked && can.revealAccount && (
                <Button
                  variant="text"
                  aria-pressed={Boolean(revealed)}
                  aria-label={revealed ? 'Hide account number' : 'Show account number'}
                  onClick={() => (revealed ? setRevealed(null) : (revealRun.reset(), setRevealReason(''), setRevealOpen(true)))}
                >
                  {revealed ? 'Hide' : 'Show'}
                </Button>
              )}
            </Stack>
          </Box>
          {can.editStatutory && (
            <TextInput
              label="New account no."
              value={acct.accountNo}
              onChange={(v) => setAcct({ ...acct, accountNo: v.replace(/[^\d\s-]/g, '') })}
              maxLength={24}
              inputMode="numeric"
              helper="6–20 digits. Leave blank to keep the stored number."
              error={acctRun.fieldErrors.accountNo}
              autoComplete="off"
            />
          )}
          <TextInput
            label="Account name"
            required
            value={acct.accountName}
            onChange={(v) => setAcct({ ...acct, accountName: v })}
            maxLength={100}
            error={acctRun.fieldErrors.accountName}
            locked={!can.editStatutory && SA_ONLY}
          />
        </FormGrid>
      </FormCard>

      {/* Signatories */}
      <FormCard
        title="Signatories"
        subtitle="Used on EA forms and letters."
        lockedReason={can.editStatutory ? null : SA_ONLY}
        onSave={() =>
          sigRun.run(
            () =>
              saveSignatories({
                rows: [
                  ...sigs.map((s, i) => ({ id: s.id, name: s.name, designation: s.designation, signatureFileId: s.signatureFileId, displayOrder: i + 1, isActive: true })),
                  ...view.signatories
                    .filter((s) => removedSigs.includes(s.id))
                    .map((s) => ({ id: s.id, name: s.name, designation: s.designation, signatureFileId: s.signatureFileId, displayOrder: s.displayOrder, isActive: false })),
                ],
              }),
            { success: 'Signatories saved.' },
          ).then((r) => {
            if (r?.ok) setRemovedSigs([]);
          })
        }
        saving={sigRun.saving}
        dirty={JSON.stringify(sigs) !== JSON.stringify(sigInit) || removedSigs.length > 0}
        error={sigRun.error}
        fieldErrors={sigRun.fieldErrors}
        actions={
          can.editStatutory ? (
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<AddIcon />}
              onClick={() => setSigs([...sigs, { id: null, name: '', designation: '', signatureFileId: null, isActive: true }])}
              disabled={sigs.length >= 10}
            >
              Add row
            </Button>
          ) : undefined
        }
      >
        {sigs.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No signatories.
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {sigs.map((s, i) => (
              <Grid key={s.id ?? `new-${i}`} container spacing={1.5} alignItems="center">
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextInput label="Name" required value={s.name} onChange={(v) => setSigs(sigs.map((r, j) => (j === i ? { ...r, name: v } : r)))} maxLength={100} error={sigRun.fieldErrors[`rows.${i}.name`]} locked={!can.editStatutory && SA_ONLY} />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextInput label="Designation" required value={s.designation} onChange={(v) => setSigs(sigs.map((r, j) => (j === i ? { ...r, designation: v } : r)))} maxLength={100} error={sigRun.fieldErrors[`rows.${i}.designation`]} locked={!can.editStatutory && SA_ONLY} />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                      {s.signatureFileId ? 'Signature image on file' : 'No signature image'}
                    </Typography>
                    {can.editStatutory && (
                      <FilePickButton
                        label={sigUploading === i ? 'Uploading…' : 'Image'}
                        accept="image/png,image/jpeg"
                        disabled={sigUploading !== null}
                        onFile={async (f) => {
                          setSigUploading(i);
                          const up = await uploadAsset('signature', f);
                          setSigUploading(null);
                          if (!up.ok) return sigRun.setError(up.error);
                          setSigs((cur) => cur.map((r, j) => (j === i ? { ...r, signatureFileId: up.fileId } : r)));
                          toast.info('Signature uploaded — press SAVE to keep it.');
                        }}
                      />
                    )}
                    {can.editStatutory && (
                      <Tooltip title="Remove signatory">
                        <IconButton
                          aria-label={`Remove signatory ${s.name || i + 1}`}
                          onClick={() => {
                            if (s.id) setRemovedSigs([...removedSigs, s.id]);
                            setSigs(sigs.filter((_, j) => j !== i));
                          }}
                        >
                          <DeleteOutlineIcon />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </Grid>
              </Grid>
            ))}
          </Stack>
        )}
      </FormCard>

      {/* AutoCount GL mapping */}
      <FormCard
        title="AutoCount GL mapping"
        subtitle="GL account codes used in the AutoCount .xlsx exports. R1.0 needs Claims payable; rows marked (payroll) are used from R1.1."
        lockedReason={can.editGl ? null : 'Read only'}
        onSave={() =>
          glRun.run(() => saveGlMappings({ rows: (Object.keys(gl) as GlPurpose[]).map((purpose) => ({ purpose, glAccountCode: gl[purpose] })) }), {
            success: 'GL mapping saved.',
          })
        }
        saving={glRun.saving}
        dirty={JSON.stringify(gl) !== JSON.stringify(glInit)}
        error={glRun.error}
        fieldErrors={glRun.fieldErrors}
        actions={
          <Tooltip title="Importing the AutoCount GL account list arrives with Imports (M9).">
            <span>
              <Button variant="outlined" color="inherit" startIcon={<UploadFileOutlinedIcon />} disabled>
                Import GL list (.xlsx)
              </Button>
            </span>
          </Tooltip>
        }
      >
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="AutoCount GL mapping">
            <TableHead>
              <TableRow>
                <TableCell>Purpose</TableCell>
                <TableCell sx={{ minWidth: 200 }}>GL account code</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {view.glMappings.map((g) => (
                <TableRow key={g.purpose}>
                  <TableCell>
                    {g.label}
                    {g.release === 'R1.1' ? ' (payroll)' : ''}
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      fullWidth
                      value={gl[g.purpose] ?? ''}
                      onChange={(e) => setGl({ ...gl, [g.purpose]: e.target.value.slice(0, 20) })}
                      slotProps={{ htmlInput: { 'aria-label': `GL account code for ${g.label}`, maxLength: 20 }, input: { readOnly: !can.editGl } }}
                      error={Boolean(glRun.fieldErrors[`rows.${view.glMappings.indexOf(g)}.glAccountCode`])}
                      helperText={glRun.fieldErrors[`rows.${view.glMappings.indexOf(g)}.glAccountCode`]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </FormCard>

      {!isSuperAdmin && (
        <Alert severity="info" variant="outlined" icon={<LockIcon fontSize="inherit" />}>
          Statutory employer numbers, the paying account, signatories and the company registration can only be changed by a Super Admin.
        </Alert>
      )}

      {/* Reveal paying account (logged) */}
      <ResponsiveDialog
        open={revealOpen}
        onClose={() => !revealRun.saving && setRevealOpen(false)}
        title="Show the paying account number?"
        actions={
          <>
            <Button variant="outlined" color="inherit" onClick={() => setRevealOpen(false)} disabled={revealRun.saving}>
              Cancel
            </Button>
            <Button
              variant="contained"
              loading={revealRun.saving}
              disabled={!isSuperAdmin && revealReason.trim() === ''}
              onClick={async () => {
                const r = await revealRun.run(() => revealPayingAccount({ reason: revealReason.trim() || undefined }), { refresh: false });
                if (r?.ok) {
                  setRevealed((r as unknown as { accountNo: string }).accountNo);
                  setRevealOpen(false);
                }
              }}
            >
              Show
            </Button>
          </>
        }
      >
        <Typography sx={{ mb: 2 }}>Viewing is logged.</Typography>
        {revealRun.error && <Alert severity="error" sx={{ mb: 2 }}>{revealRun.error}</Alert>}
        <TextField
          fullWidth
          multiline
          minRows={2}
          label={isSuperAdmin ? 'Why do you need to see this?' : 'Why do you need to see this? *'}
          required={!isSuperAdmin}
          value={revealReason}
          onChange={(e) => setRevealReason(e.target.value.slice(0, 500))}
          autoFocus
        />
      </ResponsiveDialog>
    </Stack>
  );
}
