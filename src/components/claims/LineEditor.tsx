'use client';

// P14 · Claim line editor — S-PT-14 · dialog (desktop) / full-screen sheet (phone) · F-CLM-04/05/06 · US-CLAIM-005–007
// Fields appear from the category (CC5–CC13): CLN2 Category * (grouped, CC4 policy text + limits summary) · CLN3 Date * ·
// CLN14 Claimant (dependants allowed) · CLN10 From * / To * / Purpose * (mileage or CC12) · CLN11 Distance km * ·
// CLN12 Rate 🔒 · CLN8 Amount incl. SST * (🔒 = km × rate for mileage) · CLN9 SST "To include SST" (CC9) · CLN5 Merchant ·
// CLN6 Receipt / e-Invoice no. (CC7) · CLN7 MyInvois UUID (CC8) · CLN13 Client / attendees · Travel destination ·
// CLN4 Description (CC6 *; foreign-currency hint) · CLN15 Receipts (TAKE PHOTO / CHOOSE FILE, ≤ 5) · CLN16 limit chip ·
// CLN18 Cost centre (only when cost centres exist). Live checks via the registered actions checkClaimLine +
// fetchMileageAmount ("…" while checking; "Couldn't check — RETRY"). Category change clears fields that no longer apply
// (confirm when values would be lost). [CANCEL] [SAVE & ADD ANOTHER] [SAVE LINE].
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import ListSubheader from '@mui/material/ListSubheader';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import {
  CLAIM_GROUP_LABELS,
  CLAIM_GROUPS,
  claimLineSchema,
  distanceError,
  mileageAmount,
  type ClaimForm,
  type ClaimFormCategory,
  type ClaimLineCheck,
} from '@/server/contracts/claims';
import { checkClaimLine, fetchMileageAmount } from '@/server/actions/claims';
import { DateInput, FormGrid, FullRow, SelectInput, TextInput } from '../forms/fields';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import { AttachmentPicker, type UploadedFile } from '../leave/upload';
import { LimitChip, uploadClaimFile } from './common';
import { formatMoney, formatRatePerKm, parseMoney } from '@/lib/format';

/** One line as held by the form (strings as typed). */
export type LineDraft = {
  key: string;
  id?: string;
  categoryId: string;
  transactionDate: string;
  description: string;
  merchant: string;
  receiptNo: string;
  myinvoisUuid: string;
  amountInclSst: string;
  sstAmount: string;
  fromPlace: string;
  toPlace: string;
  purpose: string;
  distanceKm: string;
  clientAttendees: string;
  travelDestination: string;
  claimant: 'self' | 'spouse' | 'child';
  dependantName: string;
  costCentreId: string;
  files: UploadedFile[];
  /** last live check (limit chip, duplicate, deadline) */
  check: ClaimLineCheck | null;
  /** server-side results for saved lines */
  duplicateWarnings?: string[];
  lateOverride?: boolean;
};

export const newLineKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()));

export function emptyLine(form: ClaimForm): LineDraft {
  return {
    key: newLineKey(),
    categoryId: '',
    transactionDate: '',
    description: '',
    merchant: '',
    receiptNo: '',
    myinvoisUuid: '',
    amountInclSst: '',
    sstAmount: '',
    fromPlace: '',
    toPlace: '',
    purpose: '',
    distanceKm: '',
    clientAttendees: '',
    travelDestination: '',
    claimant: 'self',
    dependantName: '',
    costCentreId: form.defaultCostCentreId ?? '',
    files: [],
    check: null,
  };
}

/** Which fields a category shows / requires. */
export function fieldRules(c: ClaimFormCategory | undefined) {
  const ex = c?.extraFields ?? [];
  return {
    mileage: Boolean(c?.isMileage),
    fromTo: Boolean(c?.isMileage) || ex.includes('from_to_purpose'),
    merchant: ex.includes('merchant_name'),
    client: ex.includes('client_attendees'),
    destination: ex.includes('travel_destination'),
    receiptNo: c ? c.receiptNoMode : 'hidden',
    uuid: c ? c.myinvoisUuidMode : 'hidden',
    sst: Boolean(c?.captureSst) && !c?.isMileage,
    notesRequired: Boolean(c?.notesRequired),
    receiptRequired: Boolean(c?.receiptRequired),
    dependants: c?.claimantScope === 'employee_and_dependants',
  };
}

/** Line → contract input (claimLineSchema). */
export function lineInput(l: LineDraft) {
  return {
    id: l.id,
    categoryId: l.categoryId,
    transactionDate: l.transactionDate,
    description: l.description || null,
    merchant: l.merchant || null,
    receiptNo: l.receiptNo || null,
    myinvoisUuid: l.myinvoisUuid || null,
    amountInclSst: l.distanceKm ? null : l.amountInclSst || null,
    sstAmount: l.sstAmount || null,
    fromPlace: l.fromPlace || null,
    toPlace: l.toPlace || null,
    purpose: l.purpose || null,
    distanceKm: l.distanceKm || null,
    clientAttendees: l.clientAttendees || null,
    travelDestination: l.travelDestination || null,
    claimant: l.claimant,
    dependantName: l.claimant === 'self' ? null : l.dependantName || null,
    costCentreId: l.costCentreId || null,
    fileIds: l.files.map((f) => f.fileId),
  };
}

/** Field-level validation (a line must pass its own rules to be saved — interaction-notes §6). */
export function validateLine(l: LineDraft, c: ClaimFormCategory | undefined): Record<string, string> {
  const e: Record<string, string> = {};
  if (!l.categoryId || !c) e.categoryId = 'Select the category.';
  if (!l.transactionDate) e.transactionDate = 'Enter the date of transaction.';
  const r = fieldRules(c);
  const parsed = claimLineSchema.safeParse({ ...lineInput(l), distanceKm: r.mileage ? l.distanceKm || '' : null, amountInclSst: r.mileage ? null : l.amountInclSst || null });
  if (!parsed.success) for (const i of parsed.error.issues) e[String(i.path[0] ?? 'line')] ??= i.message;
  if (r.mileage && !l.distanceKm) e.distanceKm = 'Enter the distance (km).';
  if (r.fromTo) {
    if (!l.fromPlace.trim()) e.fromPlace = 'From, To and Purpose are required for mileage.';
    if (!l.toPlace.trim()) e.toPlace = 'Enter where you went.';
    if (!l.purpose.trim()) e.purpose = 'Enter the purpose.';
  }
  if (r.merchant && !l.merchant.trim()) e.merchant = 'Enter the merchant / vendor.';
  if (r.client && !l.clientAttendees.trim()) e.clientAttendees = 'Enter the client / attendees.';
  if (r.destination && !l.travelDestination.trim()) e.travelDestination = 'Enter the travel destination.';
  if (r.receiptNo === 'required' && !l.receiptNo.trim()) e.receiptNo = 'Enter the receipt / e-Invoice no.';
  if (r.uuid === 'required' && !l.myinvoisUuid.trim()) e.myinvoisUuid = 'Enter the MyInvois UUID.';
  if (r.notesRequired && !l.description.trim()) e.description = `Notes required for ${c?.name ?? 'this category'}.`;
  if (l.check?.uuidClash) e.myinvoisUuid = l.check.uuidClash;
  return e;
}

/** Amount shown for a line (mileage → computed). */
export function lineAmount(l: LineDraft, c: ClaimFormCategory | undefined): string | null {
  if (c?.isMileage) {
    if (l.check?.mileage) return l.check.mileage.amount;
    if (l.distanceKm && !distanceError(l.distanceKm) && c.currentRate) return mileageAmount(l.distanceKm, c.currentRate);
    return null;
  }
  return parseMoney(l.amountInclSst);
}

export default function LineEditor({
  open,
  form,
  initial,
  lineNo,
  otherLines,
  claimId,
  serverErrors,
  onCancel,
  onSave,
}: {
  open: boolean;
  form: ClaimForm;
  initial: LineDraft;
  lineNo: number;
  otherLines: LineDraft[];
  claimId?: string;
  serverErrors?: Record<string, string>;
  onCancel: () => void;
  onSave: (line: LineDraft, addAnother: boolean) => void;
}) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const [l, setL] = React.useState<LineDraft>(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>(serverErrors ?? {});
  const [checkState, setCheckState] = React.useState<'idle' | 'loading' | 'error'>('idle');
  const [retry, setRetry] = React.useState(0);
  const [rateLabel, setRateLabel] = React.useState<string | null>(null);
  const [pendingCat, setPendingCat] = React.useState<string | null>(null);
  const [guard, setGuard] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setL(initial);
      setErrors(serverErrors ?? {});
      setDirty(false);
      setRateLabel(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial.key]);

  const cat = form.categories.find((c) => c.id === l.categoryId);
  const r = fieldRules(cat);
  const set = (p: Partial<LineDraft>) => {
    setDirty(true);
    setL((x) => ({ ...x, ...p }));
    const keys = Object.keys(p);
    setErrors((e) => {
      const n = { ...e };
      for (const k of keys) delete n[k];
      return n;
    });
  };

  // ---- category change: clear fields that no longer apply ---------------------------------
  const lostFields = (nextId: string): (keyof LineDraft)[] => {
    const nr = fieldRules(form.categories.find((c) => c.id === nextId));
    const out: (keyof LineDraft)[] = [];
    if (!nr.fromTo && (l.fromPlace || l.toPlace || l.purpose)) out.push('fromPlace', 'toPlace', 'purpose');
    if (!nr.mileage && l.distanceKm) out.push('distanceKm');
    if (nr.mileage && l.amountInclSst) out.push('amountInclSst');
    if (!nr.merchant && l.merchant) out.push('merchant');
    if (!nr.client && l.clientAttendees) out.push('clientAttendees');
    if (!nr.destination && l.travelDestination) out.push('travelDestination');
    if (nr.receiptNo === 'hidden' && l.receiptNo) out.push('receiptNo');
    if (nr.uuid === 'hidden' && l.myinvoisUuid) out.push('myinvoisUuid');
    if (!nr.sst && l.sstAmount) out.push('sstAmount');
    if (!nr.dependants && l.claimant !== 'self') out.push('claimant', 'dependantName');
    return out;
  };
  const applyCategory = (id: string) => {
    const clear: Partial<LineDraft> = { categoryId: id, check: null };
    for (const f of lostFields(id)) (clear as Record<string, unknown>)[f] = f === 'claimant' ? 'self' : '';
    set(clear);
  };
  const changeCategory = (id: string) => {
    if (l.categoryId && lostFields(id).length > 0) setPendingCat(id);
    else applyCategory(id);
  };

  // ---- live checks (limit chip, deadline, duplicate, UUID, mileage amount) ------------------
  const readyAmount = r.mileage ? Boolean(l.distanceKm) && !distanceError(l.distanceKm) : parseMoney(l.amountInclSst) !== null;
  const ready = Boolean(cat && /^\d{4}-\d{2}-\d{2}$/.test(l.transactionDate));
  React.useEffect(() => {
    if (!open || !ready || !cat) return;
    let alive = true;
    setCheckState('loading');
    const t = window.setTimeout(async () => {
      try {
        let computed: string | null = null;
        if (cat.isMileage && readyAmount) {
          const m = await fetchMileageAmount({ categoryId: cat.id, transactionDate: l.transactionDate, distanceKm: l.distanceKm });
          if (alive && m.ok) {
            computed = m.amount;
            setRateLabel(m.rateLabel);
          }
        }
        const amount = cat.isMileage ? computed : parseMoney(l.amountInclSst);
        const res = await checkClaimLine({
          employeeId: form.isOnBehalf ? form.employee.id : undefined,
          claimId,
          lineId: l.id,
          categoryId: cat.id,
          transactionDate: l.transactionDate,
          amountInclSst: amount,
          distanceKm: cat.isMileage ? l.distanceKm || null : undefined,
          receiptNo: l.receiptNo || null,
          myinvoisUuid: l.myinvoisUuid || null,
          merchant: l.merchant || null,
          otherLines: otherLines
            .filter((o) => o.categoryId === cat.id && /^\d{4}-\d{2}-\d{2}$/.test(o.transactionDate))
            .map((o) => ({ categoryId: o.categoryId, transactionDate: o.transactionDate, amountInclSst: lineAmount(o, form.categories.find((c) => c.id === o.categoryId)) ?? '0.00' })),
        });
        if (!alive) return;
        if (res.ok) {
          const { ok: _ok, ...check } = res;
          void _ok;
          setL((x) => ({ ...x, check, amountInclSst: cat.isMileage && check.mileage ? check.mileage.amount : x.amountInclSst }));
          setCheckState('idle');
        } else setCheckState('error');
      } catch {
        if (alive) setCheckState('error');
      }
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, cat?.id, l.transactionDate, l.amountInclSst, l.distanceKm, l.receiptNo, l.myinvoisUuid, l.merchant, retry]);

  const save = (addAnother: boolean) => {
    const e = validateLine(l, cat);
    if (l.check && !l.check.deadline.ok && !l.check.deadline.lateOverride) e.transactionDate = l.check.deadline.message ?? 'Older than the submission deadline — Admin override required.';
    setErrors(e);
    if (Object.keys(e).length) return;
    onSave({ ...l, amountInclSst: r.mileage ? lineAmount(l, cat) ?? '' : l.amountInclSst }, addAnother);
  };

  const computed = r.mileage ? lineAmount(l, cat) : null;
  const grouped = CLAIM_GROUPS.map((g) => ({ g, items: form.categories.filter((c) => c.group === g) })).filter((x) => x.items.length > 0);
  const dependantOptions = [
    { value: 'self', label: 'Self' },
    ...form.dependants.map((d, i) => ({ value: `${d.kind}:${i}`, label: `${d.kind === 'spouse' ? 'Spouse' : 'Child'} — ${d.name}` })),
  ];
  const dependantValue = l.claimant === 'self' ? 'self' : (() => {
    const i = form.dependants.findIndex((d) => d.kind === l.claimant && d.name === l.dependantName);
    return i >= 0 ? `${l.claimant}:${i}` : 'self';
  })();

  const body = (
    <Stack spacing={2} sx={{ pt: 1 }}>
      {Object.keys(errors).length > 0 && (
        <Alert severity="error" variant="outlined" role="alert">
          Check the highlighted fields.
        </Alert>
      )}
      <TextField
        select
        fullWidth
        required
        label="Category"
        value={l.categoryId}
        onChange={(e) => changeCategory(e.target.value)}
        error={Boolean(errors.categoryId)}
        helperText={errors.categoryId ?? (cat ? [cat.description, cat.hasLimit ? `Limit: ${cat.limitSummary}` : null].filter(Boolean).join(' · ') || undefined : form.categories.length === 0 ? 'No claim categories are available to you — contact HR.' : undefined)}
      >
        {grouped.flatMap(({ g, items }) => [
          <ListSubheader key={`h-${g}`}>{CLAIM_GROUP_LABELS[g]}</ListSubheader>,
          ...items.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name}
            </MenuItem>
          )),
        ])}
      </TextField>
      <FormGrid>
        <DateInput
          label="Date of transaction"
          required
          value={l.transactionDate}
          onChange={(v) => set({ transactionDate: v })}
          maxDate={form.latestTransactionDate}
          error={errors.transactionDate ?? (l.check && !l.check.deadline.ok && !l.check.deadline.lateOverride ? l.check.deadline.message ?? undefined : undefined)}
          helper={l.check?.deadline.lateOverride ? 'Late (override) — an Admin allowed this date.' : `Within ${form.deadlineDays} days (from ${form.earliestTransactionDate.split('-').reverse().join('/')}).`}
        />
        {r.dependants && form.dependants.length > 0 ? (
          <SelectInput
            label="Claimant"
            value={dependantValue}
            onChange={(v) => {
              if (v === 'self') set({ claimant: 'self', dependantName: '' });
              else {
                const [kind, idx] = v.split(':');
                set({ claimant: kind as 'spouse' | 'child', dependantName: form.dependants[Number(idx)]?.name ?? '' });
              }
            }}
            options={dependantOptions}
            error={errors.dependantName}
            helper="Medical details are sensitive — only you and HR see the dependant's name."
          />
        ) : null}
        {r.fromTo && <TextInput label="From" required value={l.fromPlace} onChange={(v) => set({ fromPlace: v })} maxLength={100} error={errors.fromPlace} />}
        {r.fromTo && <TextInput label="To" required value={l.toPlace} onChange={(v) => set({ toPlace: v })} maxLength={100} error={errors.toPlace} />}
        {r.fromTo && (
          <FullRow>
            <TextInput label="Purpose" required value={l.purpose} onChange={(v) => set({ purpose: v })} maxLength={100} error={errors.purpose} />
          </FullRow>
        )}
        {r.mileage && (
          <TextInput
            label="Distance (km)"
            required
            value={l.distanceKm}
            onChange={(v) => set({ distanceKm: v.replace(/[^0-9.]/g, '') })}
            inputMode="decimal"
            error={errors.distanceKm ?? (l.distanceKm ? distanceError(l.distanceKm) ?? undefined : undefined)}
            helper="0.1 – 2,000 km"
          />
        )}
        {r.mileage && <TextInput label="Rate (RM/km)" value={rateLabel ?? (cat?.currentRate ? formatRatePerKm(cat.currentRate) : '')} onChange={() => undefined} locked="Rate effective on the transaction date." />}
        {r.mileage ? (
          <TextInput
            label="Amount (RM)"
            value={checkState === 'loading' && readyAmount ? '…' : computed ? formatMoney(computed) : ''}
            onChange={() => undefined}
            locked="Amount = km × rate, rounded to the sen."
          />
        ) : (
          <TextInput label="Amount incl. SST (RM)" required value={l.amountInclSst} onChange={(v) => set({ amountInclSst: v })} inputMode="decimal" error={errors.amountInclSst} helper="More than RM 0.00, at most RM 99,999.99." />
        )}
        {r.sst && <TextInput label="SST amount (RM)" value={l.sstAmount} onChange={(v) => set({ sstAmount: v })} inputMode="decimal" error={errors.sstAmount} helper="To include SST — part of the amount above." />}
        {r.merchant && <TextInput label="Merchant / vendor" required value={l.merchant} onChange={(v) => set({ merchant: v })} maxLength={100} error={errors.merchant} />}
        {r.receiptNo !== 'hidden' && (
          <TextInput label="Tax invoice / receipt / e-Invoice no." required={r.receiptNo === 'required'} value={l.receiptNo} onChange={(v) => set({ receiptNo: v })} maxLength={50} error={errors.receiptNo} />
        )}
        {r.uuid !== 'hidden' && (
          <TextInput label="MyInvois UUID" required={r.uuid === 'required'} value={l.myinvoisUuid} onChange={(v) => set({ myinvoisUuid: v })} maxLength={40} error={errors.myinvoisUuid ?? l.check?.uuidClash ?? undefined} />
        )}
        {r.client && (
          <FullRow>
            <TextInput label="Client / attendees" required value={l.clientAttendees} onChange={(v) => set({ clientAttendees: v })} maxLength={300} multiline minRows={2} error={errors.clientAttendees} />
          </FullRow>
        )}
        {r.destination && <TextInput label="Travel destination" required value={l.travelDestination} onChange={(v) => set({ travelDestination: v })} maxLength={100} error={errors.travelDestination} />}
        {form.costCentres.length > 0 && (
          <SelectInput label="Cost centre" value={l.costCentreId} onChange={(v) => set({ costCentreId: v })} options={form.costCentres.map((c) => ({ value: c.id, label: c.label }))} emptyLabel="— Employee's default —" />
        )}
        <FullRow>
          <TextInput
            label="Description / notes"
            required={r.notesRequired}
            value={l.description}
            onChange={(v) => set({ description: v })}
            maxLength={500}
            multiline
            minRows={2}
            error={errors.description}
            helper="Enter MYR; for foreign expenses note the original currency and amount."
          />
        </FullRow>
      </FormGrid>
      {cat?.receiptHint && (
        <Alert severity="info" variant="outlined">
          {cat.receiptHint}
        </Alert>
      )}
      <AttachmentPicker
        label="Receipts"
        required={r.receiptRequired}
        max={5}
        files={l.files}
        onChange={(files) => set({ files })}
        upload={(file) => uploadClaimFile(file, { employeeId: form.isOnBehalf ? form.employee.id : null, categoryId: l.categoryId || null })}
        error={errors.fileIds}
        helper={r.receiptRequired ? 'A receipt is required to submit. JPG, PNG, HEIC or PDF up to 10 MB.' : 'JPG, PNG, HEIC or PDF up to 10 MB.'}
      />
      {cat && (
        <Box aria-live="polite" sx={{ minHeight: 24 }}>
          {checkState === 'loading' && (
            <Typography variant="body2" color="text.secondary">
              …
            </Typography>
          )}
          {checkState === 'error' && (
            <Typography variant="body2" color="error">
              Couldn&apos;t check the limit —{' '}
              <Button size="small" onClick={() => setRetry((x) => x + 1)}>
                Retry
              </Button>
            </Typography>
          )}
          {checkState === 'idle' && l.check && (
            <Stack spacing={0.5}>
              <LimitChip check={l.check.limit} />
              {l.check.duplicate && (
                <Typography variant="body2" sx={{ color: '#B45309' }}>
                  ⚠ Possible duplicate: {l.check.duplicate}. Your approver will see this flag.
                </Typography>
              )}
              {l.check.deadline.lateOverride && (
                <Typography variant="body2" sx={{ color: '#B45309' }}>
                  Late (override)
                </Typography>
              )}
            </Stack>
          )}
        </Box>
      )}
    </Stack>
  );

  const close = () => (dirty ? setGuard(true) : onCancel());
  return (
    <>
      <Dialog open={open} onClose={close} fullScreen={phone} maxWidth="md" fullWidth aria-labelledby="line-editor-title">
        <DialogTitle id="line-editor-title" component="h2">
          Line {lineNo}
          {cat ? ` · ${cat.name}` : ''}
        </DialogTitle>
        <DialogContent dividers>{body}</DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 2, py: 1.5, pb: phone ? 'calc(12px + env(safe-area-inset-bottom))' : undefined }}>
          <Button variant="outlined" color="inherit" onClick={close}>
            Cancel
          </Button>
          <Button variant="outlined" onClick={() => save(true)}>
            Save &amp; add another
          </Button>
          <Button variant="contained" onClick={() => save(false)}>
            Save line
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={pendingCat !== null}
        title="Change the category?"
        body="Some values you entered don't apply to the new category and will be cleared."
        confirmLabel="Change category"
        onClose={() => setPendingCat(null)}
        onConfirm={() => {
          if (pendingCat) applyCategory(pendingCat);
          setPendingCat(null);
        }}
      />
      <ConfirmDialog
        open={guard}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onClose={() => setGuard(false)}
        onConfirm={() => {
          setGuard(false);
          onCancel();
        }}
      />
    </>
  );
}
