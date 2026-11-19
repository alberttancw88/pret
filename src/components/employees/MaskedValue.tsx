'use client';

// Masked sensitive value (MyKad, bank / ASNB account, spouse/child MyKad) with a text
// `Show` button — components.md §2, interaction-notes §9, E10 · S-EM-10.
//   * Owner (P16): `Show` without a dialog (still logged by the server).
//   * SA: confirmation without a reason (logged).
//   * ADM: reason required — Statutory submission / Payroll / Bank verification /
//     Employee request / Other + text.
// The revealed value lives only in this component's state: it re-masks on navigation or
// refresh (never cached, never put in the URL).
import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ResponsiveDialog from '../dialogs/ResponsiveDialog';
import { SelectInput, TextInput } from '../forms/fields';
import { useToast } from '../ToastProvider';
import { REVEAL_REASONS, REVEAL_REASON_LABELS } from '@/server/contracts/employees';

export type RevealMode = 'owner' | 'sa' | 'adm' | 'none';
export type RevealReason = { reasonCode: string; reasonText: string | null };

export const REVEAL_REASON_OPTIONS = REVEAL_REASONS.map((r) => ({ value: r, label: REVEAL_REASON_LABELS[r] }));

export default function MaskedValue({
  masked,
  fieldLabel,
  subject,
  mode,
  onReveal,
}: {
  /** Already-masked text from the server, e.g. "******-**-5678" / "••••••1234". */
  masked: string | null | undefined;
  /** "MyKad" / "account number" — used in the dialog and aria labels. */
  fieldLabel: string;
  /** "INT-004" — dialog title "Reveal MyKad for INT-004?". */
  subject?: string;
  mode: RevealMode;
  /** Calls the contract reveal action; returns the plain value or an error message. */
  onReveal: (reason: RevealReason | null) => Promise<{ ok: true; value: string } | { ok: false; error: string }>;
}) {
  const toast = useToast();
  const [value, setValue] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [reasonCode, setReasonCode] = React.useState('');
  const [reasonText, setReasonText] = React.useState('');
  const [err, setErr] = React.useState<Record<string, string>>({});

  if (!masked) return <>—</>;

  const doReveal = async (reason: RevealReason | null) => {
    setBusy(true);
    try {
      const res = await onReveal(reason);
      if (res.ok) {
        setValue(res.value);
        setOpen(false);
      } else toast.info(res.error);
    } catch {
      toast.info('Could not reveal the value. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const onShow = () => {
    if (mode === 'owner') void doReveal(null);
    else {
      setReasonCode('');
      setReasonText('');
      setErr({});
      setOpen(true);
    }
  };

  const confirm = () => {
    if (mode === 'adm') {
      const e: Record<string, string> = {};
      if (!reasonCode) e.reasonCode = 'Choose a reason.';
      if (reasonCode === 'other' && !reasonText.trim()) e.reasonText = 'Describe the reason.';
      setErr(e);
      if (Object.keys(e).length) return;
      void doReveal({ reasonCode, reasonText: reasonText.trim() || null });
    } else void doReveal(null);
  };

  return (
    <>
      <Stack direction="row" spacing={1} alignItems="center" component="span" sx={{ display: 'inline-flex' }}>
        <Box component="span" className="pret-tnum" sx={{ fontFamily: value ? undefined : 'inherit', letterSpacing: value ? 0 : 0.5 }}>
          {value ?? masked}
        </Box>
        {mode !== 'none' && (
          <Button
            size="small"
            variant="text"
            aria-pressed={value !== null}
            aria-label={value ? `Hide ${fieldLabel}` : `Show ${fieldLabel}`}
            onClick={() => (value ? setValue(null) : onShow())}
            loading={busy && mode === 'owner'}
            sx={{ minWidth: 0, px: 1 }}
          >
            {value ? 'Hide' : 'Show'}
          </Button>
        )}
      </Stack>
      <ResponsiveDialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={`Reveal ${fieldLabel}${subject ? ` for ${subject}` : ''}?`}
        maxWidth="xs"
        actions={
          <>
            <Button variant="outlined" color="inherit" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="contained" onClick={confirm} loading={busy}>
              Reveal
            </Button>
          </>
        }
      >
        <Typography sx={{ mb: 2 }}>This is logged. The value is shown for this view only and is hidden again when you leave or refresh.</Typography>
        {mode === 'adm' && (
          <Stack spacing={2}>
            <SelectInput label="Why do you need to see this?" required value={reasonCode} onChange={setReasonCode} options={REVEAL_REASON_OPTIONS} error={err.reasonCode} />
            {reasonCode && (
              <TextInput label="Reason details" required={reasonCode === 'other'} value={reasonText} onChange={setReasonText} maxLength={200} error={err.reasonText} />
            )}
          </Stack>
        )}
      </ResponsiveDialog>
    </>
  );
}
