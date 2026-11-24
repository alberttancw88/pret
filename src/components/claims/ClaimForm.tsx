'use client';

// P13 · Claim form — create / edit New — S-PT-13 · /my/claims/new, /my/claims/{no}/edit · F-CLM-04–08, F-CLM-19, F-PRT-05
// C2 · Submit claim on behalf — S-CL-02 · /claims/new-on-behalf · F-CLM-18 (Employee * picker + On-behalf note 0/300).
// Header: ← title · status chip after first save · "Copied from CL-…" · "On behalf by …".
// CH3 Title / purpose * (0/120) · CH4 Project / customer ref (0/60) · Lines (n) cards: line no · category · date · amount
// (km for mileage) · 📎 count · limit / duplicate / late chips; ⋮ Edit · Duplicate line · Delete line; [+ ADD LINE] (1–50).
// Sticky footer: Total excl. SST · SST · Total · [SAVE] [SUBMIT]; "Delete claim" text button (New only).
// SAVE = saveClaim (New; first save assigns CL-yyyy-nnnnn; per-form idempotency key) · SUBMIT = save then submitClaim
// (blocks per line + warnings needing "I understand") · unsaved-changes guard · form state kept on the device for the
// session (sessionStorage) and restored on return (US-PORTAL-006).
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { claimTotals, MAX_LINES, type ClaimDetail, type ClaimForm as ClaimFormData, type ClaimStatus } from '@/server/contracts/claims';
import { fetchClaimForm, saveClaim } from '@/server/actions/claims';
import { FormGrid, FullRow, TextInput } from '../forms/fields';
import ErrorSummary from '../forms/ErrorSummary';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import StatusChip from '../StatusChip';
import MoneyText from '../MoneyText';
import { useToast } from '../ToastProvider';
import { formatDate } from '@/lib/format';
import { useIdempotencyKey, PanelRow } from '../leave/common';
import type { PickedPerson } from '../leave/pickers';
import { ClaimEmployeePicker, ClaimStatusChip, LimitChip } from './common';
import LineEditor, { emptyLine, lineAmount, lineInput, newLineKey, type LineDraft } from './LineEditor';
import OwnClaimDialogs, { SubmitClaimDialog, type OwnClaimTarget } from './OwnClaimDialogs';

type Mode = 'own' | 'behalf';

function linesFromClaim(c: ClaimDetail): LineDraft[] {
  return c.lines.map((x) => ({
    key: x.id,
    id: x.id,
    categoryId: x.category.id,
    transactionDate: x.transactionDate,
    description: x.description ?? '',
    merchant: x.merchant ?? '',
    receiptNo: x.receiptNo ?? '',
    myinvoisUuid: x.myinvoisUuid ?? '',
    amountInclSst: x.amountInclSst,
    sstAmount: x.sstAmount && Number(x.sstAmount) !== 0 ? x.sstAmount : '',
    fromPlace: x.fromPlace ?? '',
    toPlace: x.toPlace ?? '',
    purpose: x.purpose ?? '',
    distanceKm: x.distanceKm ?? '',
    clientAttendees: x.clientAttendees ?? '',
    travelDestination: x.travelDestination ?? '',
    claimant: x.claimant ?? 'self',
    dependantName: x.dependantName ?? '',
    costCentreId: x.costCentre?.id ?? '',
    files: x.files.map((f) => ({ fileId: f.fileId, fileName: f.fileName, sizeBytes: f.sizeBytes })),
    check: x.limitCheck ? { limit: x.limitCheck, deadline: { ok: true, message: null, lateOverride: x.lateOverride }, duplicate: x.duplicateWarnings[0] ?? null, uuidClash: null, mileage: null } : null,
    duplicateWarnings: x.duplicateWarnings,
    lateOverride: x.lateOverride,
  }));
}

type Draft = { title: string; projectRef: string; onBehalfNote: string; lines: LineDraft[] };
const storageKey = (mode: Mode, claimNo: string | null, employeeId: string | null) => `pret:claim-draft:${mode}:${claimNo ?? 'new'}:${employeeId ?? 'self'}`;

export default function ClaimForm({
  form: initialForm,
  mode = 'own',
  employee: initialEmployee,
}: {
  form: ClaimFormData | null;
  mode?: Mode;
  employee?: PickedPerson | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = React.useState<ClaimFormData | null>(initialForm);
  const [employee, setEmployee] = React.useState<PickedPerson | null>(initialEmployee ?? null);
  const [loadingForm, setLoadingForm] = React.useState(false);
  const c = form?.claim ?? null;
  const [claimId, setClaimId] = React.useState<string | undefined>(c?.id);
  const [claimNo, setClaimNo] = React.useState<string | null>(c?.claimNo ?? null);
  const [version, setVersion] = React.useState<number | undefined>(c?.version);
  const [status, setStatus] = React.useState<ClaimStatus | null>(c?.status ?? null);
  const [d, setD] = React.useState<Draft>(() => ({ title: c?.title ?? '', projectRef: c?.projectRef ?? '', onBehalfNote: c?.onBehalfNote ?? '', lines: c ? linesFromClaim(c) : [] }));
  const [dirty, setDirty] = React.useState(false);
  const [restored, setRestored] = React.useState(false);
  const [editing, setEditing] = React.useState<{ line: LineDraft; index: number } | null>(null);
  const [menu, setMenu] = React.useState<{ el: HTMLElement; index: number } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [submitTarget, setSubmitTarget] = React.useState<{ claimId: string; claimNo: string; version?: number } | null>(null);
  const [own, setOwn] = React.useState<OwnClaimTarget | null>(null);
  const [guard, setGuard] = React.useState<string | null>(null);
  const [idemKey, renewKey] = useIdempotencyKey();
  const key = storageKey(mode, claimNo, form?.employee.id ?? null);

  // ---- keep unsent state on the device for this session (US-PORTAL-006) ----------------------
  React.useEffect(() => {
    if (!form) return;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw) as Draft;
        setD(saved);
        setDirty(true);
        setRestored(true);
      }
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.employee.id]);
  React.useEffect(() => {
    if (!dirty || !form) return;
    try {
      sessionStorage.setItem(key, JSON.stringify({ ...d, lines: d.lines.map((l) => ({ ...l, check: null })) }));
    } catch {
      /* ignore */
    }
  }, [d, dirty, key, form]);
  const clearStored = () => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  };
  React.useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const setHeader = (p: Partial<Draft>) => {
    setDirty(true);
    setD((x) => ({ ...x, ...p }));
    setFieldErrors((e) => {
      const n = { ...e };
      for (const k of Object.keys(p)) delete n[k];
      return n;
    });
  };

  // C2: choosing the employee reloads the form for that employee (categories, cost centres, approver hint).
  const pickEmployee = async (p: PickedPerson | null) => {
    setEmployee(p);
    if (!p) {
      setForm(null);
      return;
    }
    setLoadingForm(true);
    try {
      const res = await fetchClaimForm({ employeeId: p.id });
      if (res.ok) {
        setForm(res.form);
        if (!res.form) toast.info('Claims cannot be entered for this employee.');
      } else toast.info(res.error);
    } finally {
      setLoadingForm(false);
    }
  };

  if (mode === 'behalf' && !form) {
    return (
      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>
            <ClaimEmployeePicker
              label="Employee"
              required
              value={employee}
              onChange={(p) => void pickEmployee(p)}
              disabled={loadingForm}
              helper="Active, Notice Period, or Separated employees within their portal-access end. Your own record is not listed."
            />
            <Typography variant="body2" color="text.secondary">
              The claim is visible to the employee. When submitted it goes to the normal single approval — you can&apos;t approve a claim you entered on behalf.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    );
  }
  if (!form) {
    return <Alert severity="info">You don&apos;t have an employee record, so you can&apos;t submit claims. Contact HR.</Alert>;
  }

  const catOf = (id: string) => form.categories.find((x) => x.id === id);
  const totals = claimTotals(d.lines.map((l) => ({ amountInclSst: lineAmount(l, catOf(l.categoryId)) ?? '0.00', sstAmount: l.sstAmount ? l.sstAmount.replace(/,/g, '') : null })).filter((x) => /^\d+(\.\d+)?$/.test(x.amountInclSst)));
  const editable = status === null || status === 'new';
  const lineErr = (i: number) => Object.entries(fieldErrors).filter(([k]) => k.startsWith(`lines.${i}.`));

  const doSave = async (): Promise<{ claimId: string; claimNo: string; version: number } | null> => {
    setError(null);
    setFieldErrors({});
    const e: Record<string, string> = {};
    if (!d.title.trim()) e.title = 'Give the claim a title.';
    if (d.lines.length === 0) e.lines = 'Add at least one line.';
    if (Object.keys(e).length) {
      setFieldErrors(e);
      return null;
    }
    setSaving(true);
    try {
      const res = await saveClaim({
        claimId,
        expectedVersion: version,
        employeeId: mode === 'behalf' ? form.employee.id : undefined,
        onBehalfNote: mode === 'behalf' ? d.onBehalfNote || null : null,
        title: d.title,
        projectRef: d.projectRef || null,
        lines: d.lines.map(lineInput),
        idempotencyKey: idemKey,
      });
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return null;
      }
      setClaimId(res.id);
      setClaimNo(res.claimNo);
      setVersion(res.version);
      setStatus('new');
      setD((x) => ({ ...x, lines: x.lines.map((l, i) => ({ ...l, id: res.lineIds[i] ?? l.id })) }));
      setDirty(false);
      clearStored();
      renewKey();
      return { claimId: res.id, claimNo: res.claimNo, version: res.version };
    } catch {
      setError('Something went wrong. Your entries are kept — try again.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const onSaveClick = async () => {
    const r = await doSave();
    if (r) {
      toast.success(`Saved as ${r.claimNo}.`);
      const target = mode === 'own' ? `/my/claims/${encodeURIComponent(r.claimNo)}/edit` : `/claims/new-on-behalf?claim=${encodeURIComponent(r.claimNo)}`;
      router.replace(target, { scroll: false });
    }
  };
  const onSubmitClick = async () => {
    const r = dirty || !claimId ? await doSave() : { claimId: claimId!, claimNo: claimNo!, version: version! };
    if (r) setSubmitTarget(r);
  };

  const detailHref = (no: string) => (mode === 'own' ? `/my/claims/${encodeURIComponent(no)}` : `/approvals/claims/${encodeURIComponent(no)}?from=claims`);
  const leave = (href: string) => (dirty ? setGuard(href) : router.push(href));

  const lineCard = (l: LineDraft, i: number) => {
    const cat = catOf(l.categoryId);
    const amt = lineAmount(l, cat);
    const errs = lineErr(i);
    return (
      <Card key={l.key} variant="outlined" sx={{ position: 'relative', borderColor: errs.length ? 'error.main' : undefined }}>
        <CardActionArea onClick={() => editable && setEditing({ line: l, index: i })} disabled={!editable} sx={{ p: 1.5, pr: 7 }}>
          <Typography variant="subtitle2" component="p">
            {i + 1} {cat?.name ?? 'Category not available'}
          </Typography>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
            <Typography variant="body2" className="pret-tnum">
              {formatDate(l.transactionDate) || '—'}
            </Typography>
            {cat?.isMileage && l.distanceKm && (
              <Typography variant="body2" className="pret-tnum">
                {l.distanceKm} km
              </Typography>
            )}
            <Typography variant="body2" fontWeight={700}>
              <MoneyText amount={amt} />
            </Typography>
            {l.files.length > 0 && (
              <Typography variant="body2" sx={{ display: 'inline-flex', alignItems: 'center' }} aria-label={`${l.files.length} receipts`}>
                <AttachFileIcon sx={{ fontSize: 16 }} />
                {l.files.length}
              </Typography>
            )}
          </Stack>
          <Stack spacing={0.25} sx={{ mt: 0.5 }}>
            {l.check?.limit && <LimitChip check={l.check.limit} />}
            {(l.check?.duplicate || l.duplicateWarnings?.[0]) && (
              <Typography variant="body2" sx={{ color: 'warning.main' }}>
                ⚠ {l.check?.duplicate ?? l.duplicateWarnings?.[0]}
              </Typography>
            )}
            {(l.check?.deadline.lateOverride || l.lateOverride) && <StatusChip set="claim" value="Late (override)" size="xsmall" />}
            {errs.map(([k, m]) => (
              <Typography key={k} variant="body2" color="error">
                {m}
              </Typography>
            ))}
          </Stack>
        </CardActionArea>
        {editable && (
          <IconButton aria-label={`More actions for line ${i + 1}`} onClick={(e) => setMenu({ el: e.currentTarget, index: i })} sx={{ position: 'absolute', top: 4, right: 4, width: 44, height: 44 }}>
            <MoreVertIcon />
          </IconButton>
        )}
      </Card>
    );
  };

  return (
    <Box sx={{ pb: { xs: 24, sm: 2 } }}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="h4" component="p" className="pret-tnum">
            {claimNo ?? (mode === 'behalf' ? 'New claim on behalf' : 'New claim')}
          </Typography>
          {status && <ClaimStatusChip status={status} />}
          {c?.copiedFrom && <Chip size="small" variant="outlined" icon={<ContentCopyIcon />} label={`Copied from ${c.copiedFrom.claimNo}`} />}
          {mode === 'behalf' && <StatusChip set="claim" value="On behalf" label={c?.onBehalfByName ? `On behalf by ${c.onBehalfByName}` : 'On behalf'} />}
        </Stack>
        {restored && (
          <Alert
            severity="info"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  clearStored();
                  router.refresh();
                  window.location.reload();
                }}
              >
                Discard
              </Button>
            }
          >
            We restored the changes you hadn&apos;t saved yet.
          </Alert>
        )}
        {!editable && <Alert severity="info">Only New claims can be edited. This claim is {status}.</Alert>}
        {c?.staleNew && <Alert severity="warning">This claim was saved more than 90 days ago and is still not submitted.</Alert>}
        <ErrorSummary error={error} fieldErrors={Object.fromEntries(Object.entries(fieldErrors).filter(([k]) => !k.startsWith('lines.')))} labels={{ title: 'Title / purpose', projectRef: 'Project / customer reference', lines: 'Lines', onBehalfNote: 'On-behalf note' }} />

        <Card>
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <fieldset disabled={saving || !editable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
              <FormGrid>
                {mode === 'behalf' && (
                  <FullRow>
                    <ClaimEmployeePicker label="Employee" required value={employee ?? { id: form.employee.id, employeeNo: form.employee.employeeNo, name: form.employee.name }} onChange={(p) => void pickEmployee(p)} disabled={Boolean(claimId)} helper={`${form.employee.department} · ${form.employee.status}`} />
                  </FullRow>
                )}
                <FullRow>
                  <TextInput label="Title / purpose" required value={d.title} onChange={(v) => setHeader({ title: v })} maxLength={120} counter error={fieldErrors.title} helper='e.g. "KL client visits – Nov"' />
                </FullRow>
                <FullRow>
                  <TextInput label="Project / customer reference" value={d.projectRef} onChange={(v) => setHeader({ projectRef: v })} maxLength={60} counter error={fieldErrors.projectRef} />
                </FullRow>
                {mode === 'behalf' && (
                  <FullRow>
                    <TextInput label="On-behalf note" value={d.onBehalfNote} onChange={(v) => setHeader({ onBehalfNote: v })} maxLength={300} multiline minRows={2} error={fieldErrors.onBehalfNote} />
                  </FullRow>
                )}
              </FormGrid>
            </fieldset>
          </CardContent>
        </Card>

        <Box>
          <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
            Lines ({d.lines.length})
          </Typography>
          {fieldErrors.lines && (
            <Typography color="error" variant="body2" sx={{ mb: 1 }}>
              {fieldErrors.lines}
            </Typography>
          )}
          <Stack spacing={1}>
            {d.lines.map(lineCard)}
            {d.lines.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                No lines yet. Add one line per receipt or trip.
              </Typography>
            )}
            {editable && (
              <Box>
                <Button variant="outlined" startIcon={<AddIcon />} disabled={d.lines.length >= MAX_LINES} onClick={() => setEditing({ line: emptyLine(form), index: d.lines.length })} sx={{ minHeight: 44 }}>
                  Add line
                </Button>
              </Box>
            )}
          </Stack>
        </Box>
        {form.approverHint && (
          <Typography variant="body2" color="text.secondary">
            {form.approverHint}
          </Typography>
        )}
        {editable && claimId && (
          <Box>
            <Button color="error" variant="text" onClick={() => setOwn({ kind: 'delete', claimId, claimNo: claimNo! })}>
              Delete claim
            </Button>
          </Box>
        )}
      </Stack>

      {/* Totals + actions — floating pill bar at the bottom on phone (theme-tokens.md §8.6) */}
      <Card
        sx={(t) => ({
          position: { xs: 'fixed', sm: 'sticky' },
          bottom: { xs: 'calc(var(--pret-bottom-bar, env(safe-area-inset-bottom)) + 12px)', sm: 0 },
          left: { xs: 12, sm: 0 },
          right: { xs: 12, sm: 0 },
          mt: 2,
          zIndex: 3,
          borderRadius: { xs: `${t.pret.radius.floating}px`, sm: `${t.pret.radius.card}px` },
          border: { xs: 'none', sm: `1px solid ${t.palette.divider}` },
          boxShadow: { xs: t.pret.shadow.floating, sm: 'none' },
          '@media (max-width:599.95px)': { '& .MuiButton-root': { minHeight: 48 } },
        })}
      >
        <CardContent sx={{ py: 1.5, px: { xs: 2, sm: 3 }, '&:last-child': { pb: 1.5 } }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 3 }} alignItems={{ sm: 'center' }}>
            <Box sx={{ flex: 1, maxWidth: { sm: 360 } }}>
              <PanelRow label="Total excl. SST" value={<MoneyText amount={totals.exclSst} />} />
              <PanelRow label="SST" value={<MoneyText amount={totals.sst} />} />
              <PanelRow label="Total" value={<MoneyText amount={totals.total} bold />} strong />
            </Box>
            <Box sx={{ flex: 1 }} />
            <Stack direction="row" spacing={1} sx={{ '& > *': { flex: { xs: 1, sm: 'initial' } } }}>
              <Button variant="outlined" color="inherit" onClick={() => leave(mode === 'own' ? (claimNo ? detailHref(claimNo) : '/my/claims') : '/claims')} disabled={saving}>
                Cancel
              </Button>
              {editable && (
                <Button variant="outlined" onClick={onSaveClick} loading={saving && !submitTarget}>
                  Save
                </Button>
              )}
              {editable && (
                <Button variant="contained" onClick={onSubmitClick} disabled={saving}>
                  Submit
                </Button>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {editing && (
        <LineEditor
          open
          form={form}
          initial={editing.line}
          lineNo={editing.index + 1}
          claimId={claimId}
          otherLines={d.lines.filter((_, i) => i !== editing.index)}
          serverErrors={Object.fromEntries(lineErr(editing.index).map(([k, m]) => [k.split('.').slice(2).join('.'), m]))}
          onCancel={() => setEditing(null)}
          onSave={(line, again) => {
            setDirty(true);
            setD((x) => {
              const lines = [...x.lines];
              if (editing.index < lines.length) lines[editing.index] = line;
              else lines.push(line);
              return { ...x, lines };
            });
            setFieldErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith(`lines.${editing.index}.`) && k !== 'lines')));
            if (again && d.lines.length + (editing.index < d.lines.length ? 0 : 1) < MAX_LINES) {
              const next = { ...emptyLine(form), categoryId: line.categoryId, transactionDate: line.transactionDate, costCentreId: line.costCentreId };
              setEditing({ line: next, index: editing.index < d.lines.length ? d.lines.length : editing.index + 1 });
            } else setEditing(null);
          }}
        />
      )}
      <Menu anchorEl={menu?.el} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            if (menu) setEditing({ line: d.lines[menu.index]!, index: menu.index });
            setMenu(null);
          }}
        >
          Edit
        </MenuItem>
        <MenuItem
          disabled={d.lines.length >= MAX_LINES}
          onClick={() => {
            if (menu) {
              const src = d.lines[menu.index]!;
              setDirty(true);
              setD((x) => ({ ...x, lines: [...x.lines, { ...src, key: newLineKey(), id: undefined, files: [], check: null, myinvoisUuid: '' }] }));
            }
            setMenu(null);
          }}
        >
          Duplicate line
        </MenuItem>
        <MenuItem
          sx={{ color: 'error.main' }}
          onClick={() => {
            if (menu) {
              setDirty(true);
              setD((x) => ({ ...x, lines: x.lines.filter((_, i) => i !== menu.index) }));
            }
            setMenu(null);
          }}
        >
          Delete line
        </MenuItem>
      </Menu>
      <SubmitClaimDialog
        target={submitTarget ? { ...submitTarget } : null}
        onClose={() => setSubmitTarget(null)}
        onSubmitted={(r) => {
          clearStored();
          router.push(detailHref(r.claimNo));
        }}
      />
      <OwnClaimDialogs
        target={own}
        onClose={() => setOwn(null)}
        onDeleted={() => {
          clearStored();
          setDirty(false);
          router.push(mode === 'own' ? '/my/claims' : '/claims');
        }}
      />
      <ConfirmDialog
        open={guard !== null}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onClose={() => setGuard(null)}
        onConfirm={() => {
          const href = guard!;
          clearStored();
          setDirty(false);
          setGuard(null);
          router.push(href);
        }}
      />
      {mode === 'own' && claimNo && !editable && (
        <Button component={NextLink} href={detailHref(claimNo)} sx={{ mt: 2 }}>
          View claim
        </Button>
      )}
    </Box>
  );
}
