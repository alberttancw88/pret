'use client';

// E3 tab 9 · Bank (group I) + E17 · S-EM-17 Edit bank details (D15: no confirmation step).
// I4 / I9 masked with logged reveal (E10) · I6 proof (view, logged) · I8 verified by/at ·
// bank history (effective from · bank · account ••••1234 · changed by · at · source).
// Not available on the Admin's own record (FR-EMP-12) — use a change request.
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import {
  BANK_ACCOUNT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  type BankAccountView,
  type BankOption,
  type EmployeeProfile,
} from '@/server/contracts/employees';
import { getEmployeeFileUrl, saveBankDetails } from '@/server/actions/employees';
import FormDialog from '../../forms/FormDialog';
import { useActionRunner } from '../../forms/useActionRunner';
import { useToast } from '../../ToastProvider';
import MaskedValue, { type RevealMode } from '../MaskedValue';
import { BankFields, bankPayload, emptyBank, type BankForm } from '../fieldGroups';
import { uploadEmployeeFile } from '../upload';
import { KVGrid, MiniTable, SectionCard } from '../ui';
import { ScheduledChip, dateOr } from '../labels';
import { OWN_LOCK, revealer } from './context';
import { formatDateTime, todayMyt } from '@/lib/format';

export function BankFacts({
  b,
  revealMode,
  onReveal,
  onViewProof,
}: {
  b: Omit<BankAccountView, 'proofFileId' | 'verifiedByName'> & Partial<Pick<BankAccountView, 'proofFileId' | 'verifiedByName'>>;
  revealMode: RevealMode;
  onReveal: (field: 'bank_account_no' | 'asnb_account_no') => Parameters<typeof MaskedValue>[0]['onReveal'];
  onViewProof?: () => void;
}) {
  const transfer = b.paymentMethod === 'bank_transfer';
  return (
    <KVGrid
      items={[
        { label: 'Payment method', value: PAYMENT_METHOD_LABELS[b.paymentMethod] },
        { label: 'Bank', value: b.bank ? `${b.bank.name} (${b.bank.code})` : '', hidden: !transfer },
        { label: 'Account type', value: b.accountType ? BANK_ACCOUNT_TYPE_LABELS[b.accountType] : '', hidden: !transfer },
        { label: 'Account no.', value: <MaskedValue masked={b.accountNoMasked} fieldLabel="account number" mode={revealMode} onReveal={onReveal('bank_account_no')} />, hidden: !transfer },
        { label: 'Account holder name', value: b.accountHolderName, hidden: !transfer },
        {
          label: 'Proof of account',
          value: b.proofFileId ? (
            <Button size="small" onClick={onViewProof}>
              View (logged)
            </Button>
          ) : (
            '—'
          ),
          hidden: b.proofFileId === undefined,
        },
        { label: 'Effective from', value: dateOr(b.effectiveFrom) },
        { label: 'Verified by HR', value: b.verifiedByName !== undefined ? `${b.verifiedByName ?? 'System'} at ${formatDateTime(b.verifiedAt)}` : formatDateTime(b.verifiedAt), hidden: b.verifiedByName === undefined },
        { label: 'ASNB account no.', value: <MaskedValue masked={b.asnbMasked} fieldLabel="ASNB account number" mode={revealMode} onReveal={onReveal('asnb_account_no')} /> },
      ]}
    />
  );
}

export default function BankTab({ profile, banks, revealMode }: { profile: EmployeeProfile; banks: BankOption[]; revealMode: RevealMode }) {
  const toast = useToast();
  const own = profile.isOwnRecord;
  const [open, setOpen] = React.useState(false);
  const cur = profile.bank.current;
  const viewProof = async (fileId: string) => {
    try {
      const res = await getEmployeeFileUrl({ employeeId: profile.id, fileId });
      if (res.ok) window.open(res.url, '_blank', 'noopener');
      else toast.info(res.error);
    } catch {
      toast.info('Could not open the file.');
    }
  };
  return (
    <Stack spacing={2}>
      <SectionCard
        title="Bank details & ASNB"
        lockedReason={own ? OWN_LOCK : null}
        headerActions={
          profile.can.editBank &&
          !own && (
            <Button size="small" variant="contained" startIcon={<EditOutlinedIcon />} onClick={() => setOpen(true)}>
              Edit bank details
            </Button>
          )
        }
      >
        {cur ? (
          <BankFacts
            b={cur}
            revealMode={profile.can.reveal ? revealMode : 'none'}
            onReveal={(field) => revealer(profile.id, field, cur.id)}
            onViewProof={cur.proofFileId ? () => viewProof(cur.proofFileId!) : undefined}
          />
        ) : (
          <Typography color="text.secondary">No bank details recorded.</Typography>
        )}
      </SectionCard>
      <SectionCard title="Bank history">
        <MiniTable
          caption="Bank history"
          rows={profile.bank.history}
          getRowId={(x) => x.id}
          empty="No earlier bank details."
          columns={[
            {
              key: 'e',
              header: 'Effective from',
              render: (x) => (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <span>{dateOr(x.effectiveFrom)}</span>
                  {x.isScheduled && <ScheduledChip />}
                </Stack>
              ),
            },
            { key: 'm', header: 'Method', render: (x) => PAYMENT_METHOD_LABELS[x.paymentMethod] },
            { key: 'b', header: 'Bank', render: (x) => x.bank?.name ?? '—' },
            { key: 'a', header: 'Account', render: (x) => x.accountNoMasked ?? '—' },
            { key: 'by', header: 'Changed by', render: (x) => x.verifiedByName ?? '—' },
            { key: 'at', header: 'At', render: (x) => formatDateTime(x.verifiedAt) },
            { key: 's', header: 'Source', render: (x) => (x.source === 'change_request' ? x.changeRequestNo ?? 'Change request' : 'Direct') },
          ]}
        />
      </SectionCard>
      <BankDetailsDialog open={open} onClose={() => setOpen(false)} profile={profile} banks={banks} />
    </Stack>
  );
}

function BankDetailsDialog({ open, onClose, profile, banks }: { open: boolean; onClose: () => void; profile: EmployeeProfile; banks: BankOption[] }) {
  const r = useActionRunner();
  const toast = useToast();
  const [f, setF] = React.useState<BankForm>(() => emptyBank(todayMyt(), profile.personal.fullName));
  const [shared, setShared] = React.useState(false);
  const [proofId, setProofId] = React.useState<{ file: File; id: string } | null>(null);
  React.useEffect(() => {
    if (!open) return;
    r.reset();
    setShared(false);
    setProofId(null);
    const c = profile.bank.current;
    setF({ ...emptyBank(todayMyt(), profile.personal.fullName), paymentMethod: c?.paymentMethod ?? 'bank_transfer', bankId: c?.bank?.id ?? '', accountType: c?.accountType ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const cur = profile.bank.current;
  return (
    <FormDialog
      open={open}
      title={`Edit bank details — ${profile.personal.employeeNo}`}
      onClose={onClose}
      submitLabel="Save bank details"
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty
      maxWidth="md"
      onSubmit={async () => {
        if (f.paymentMethod === 'bank_transfer' && !f.proof) {
          r.setFieldErrors({ proofFileId: 'Upload proof of the account.' });
          return;
        }
        const res = await r.run(
          async () => {
            let fileId = proofId && proofId.file === f.proof ? proofId.id : null;
            if (f.proof && !fileId) {
              const up = await uploadEmployeeFile(profile.id, 'bank_proof', f.proof);
              if (!up.ok) return { ok: false as const, error: up.error, fieldErrors: { proofFileId: up.error } };
              fileId = up.fileId;
              setProofId({ file: f.proof, id: up.fileId });
            }
            return saveBankDetails({ employeeId: profile.id, bank: bankPayload(f, fileId) });
          },
          { success: 'Bank details saved. The employee and the Super Admin have been notified.' },
        );
        if (res?.ok) {
          const w = (res as unknown as { warnings?: string[] }).warnings ?? [];
          if (w.length) toast.info(w.join(' '));
          onClose();
        } else if (res && !res.ok && res.fieldErrors?.sharedAccountRemarks) setShared(true);
      }}
    >
      {cur && (
        <Box sx={{ mb: 2, p: 1.5, bgcolor: '#F7F7F9', borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Current
          </Typography>
          <Typography variant="body2">
            {PAYMENT_METHOD_LABELS[cur.paymentMethod]}
            {cur.bank ? ` · ${cur.bank.name}` : ''}
            {cur.accountNoMasked ? ` · ${cur.accountNoMasked}` : ''}
            {cur.accountHolderName ? ` · ${cur.accountHolderName}` : ''} · effective {dateOr(cur.effectiveFrom)}
          </Typography>
        </Box>
      )}
      <BankFields value={f} onChange={(p) => setF((v) => ({ ...v, ...p }))} errors={r.fieldErrors} banks={banks} employeeFullName={profile.personal.fullName} showSharedRemarks={shared} />
      <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
        Saving notifies the employee (work and personal email) and the Super Admin. Before/after values are logged (masked).
      </Alert>
    </FormDialog>
  );
}
