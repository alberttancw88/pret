'use client';

// P2 · Apply leave — S-PT-02 · /my/leave/apply · F-LV-05/06/07/12/13/14/16/17/30/33/34 · US-LEAVE-008–012, 018–021, 024, 038, 039
// L2 · Apply on behalf — S-LV-02 · /leave/apply-on-behalf (mode 'behalf': Employee * + Reason for acting on behalf *).
// Single scrolling form; the balance preview is pinned directly above the sticky SUBMIT (FR-PRT-04).
// Live day count + balance preview from the registered action previewLeaveApplication (debounced; "…" while
// checking; "Couldn't check balance — RETRY" keeps SUBMIT disabled). Blocks: summary card on top + next to the
// field. Warnings: "I understand" before SUBMIT. Idempotency key per form instance (EC-LV-09).
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {
  addDaysIso,
  consecutiveEndDate,
  type ApplyLeaveForm as ApplyLeaveFormData,
  type ApplyLeaveTypeOption,
  type LeavePreview,
  type LeaveSessionValue,
  type SubmitLeaveResult,
} from '@/server/contracts/leave';
import { applyLeave, previewLeaveApplication } from '@/server/actions/leave';
import { CheckboxInput, RadioInput, SelectInput, TextInput, type Option } from '../forms/fields';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import { formatDate, todayMyt } from '@/lib/format';
import LeaveDateField, { useCalendarMarks } from './LeaveDateField';
import { AttachmentPicker, uploadLeaveFile, type UploadedFile } from './upload';
import { EmergencyChip, PanelRow, daysText, formatDays, useIdempotencyKey } from './common';
import { ColleaguePicker, LeaveEmployeePicker, type PickedPerson } from './pickers';

type Mode = 'own' | 'behalf';
type F = {
  leaveTypeId: string;
  startDate: string;
  startSession: LeaveSessionValue;
  endDate: string;
  endSession: LeaveSessionValue;
  reason: string;
  expectedConfinementDate: string;
  childBorn: string;
  childBirthDate: string;
  contactPhone: string;
  onBehalfReason: string;
};
const EMPTY: F = {
  leaveTypeId: '',
  startDate: '',
  startSession: 'full',
  endDate: '',
  endSession: 'full',
  reason: '',
  expectedConfinementDate: '',
  childBorn: '',
  childBirthDate: '',
  contactPhone: '',
  onBehalfReason: '',
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default function ApplyLeaveForm({
  form,
  mode = 'own',
  employee,
  initialTypeCode,
  notFoundEmployee,
}: {
  form: ApplyLeaveFormData | null;
  /** L2: ?employee= given but not usable (own record / not found) */
  notFoundEmployee?: boolean;
  mode?: Mode;
  /** L2: the employee chosen (from ?employee=) */
  employee?: PickedPerson | null;
  initialTypeCode?: string | null;
}) {
  const router = useRouter();
  const [f, setF] = React.useState<F>(() => {
    const t = initialTypeCode ? form?.types.find((x) => x.code === initialTypeCode.toUpperCase()) : undefined;
    return { ...EMPTY, leaveTypeId: t?.id ?? '' };
  });
  const [files, setFiles] = React.useState<UploadedFile[]>([]);
  const [cover, setCover] = React.useState<PickedPerson | null>(null);
  const [ack, setAck] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [preview, setPreview] = React.useState<LeavePreview | null>(null);
  const [pState, setPState] = React.useState<'idle' | 'loading' | 'error'>('idle');
  const [retry, setRetry] = React.useState(0);
  const [showHow, setShowHow] = React.useState(false);
  const [showMore, setShowMore] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [guard, setGuard] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [submitFieldErrors, setSubmitFieldErrors] = React.useState<Record<string, string>>({});
  const [result, setResult] = React.useState<SubmitLeaveResult | null>(null);
  const [idemKey, renewKey] = useIdempotencyKey();
  const topRef = React.useRef<HTMLDivElement>(null);

  const today = form?.today ?? todayMyt();
  const marks = useCalendarMarks(mode === 'behalf' ? employee?.id : null, addDaysIso(today, -90), form?.maxDate ?? addDaysIso(today, 365));
  const type: ApplyLeaveTypeOption | undefined = form?.types.find((t) => t.id === f.leaveTypeId);
  const fixedEnd = Boolean(type && type.countBasis === 'consecutive_calendar_days' && type.daysPerOccurrence);
  const singleDay = f.startDate !== '' && (f.endDate === '' || f.endDate === f.startDate);
  const set = (p: Partial<F>) => {
    setDirty(true);
    setF((x) => {
      const next = { ...x, ...p };
      const t = form?.types.find((y) => y.id === next.leaveTypeId);
      // LA6 read-only for consecutive types: end = start + LT23 − 1 (BR-LV-23)
      if (t && t.countBasis === 'consecutive_calendar_days' && t.daysPerOccurrence && ISO.test(next.startDate)) {
        next.endDate = consecutiveEndDate(next.startDate, Number(t.daysPerOccurrence));
      }
      if (p.startDate && (!x.endDate || x.endDate < p.startDate) && !(t && t.countBasis === 'consecutive_calendar_days')) next.endDate = p.startDate;
      if (t && !t.halfDayAllowed) {
        next.startSession = 'full';
        next.endSession = 'full';
      }
      // BR-LV-22: multi-day → first Full/PM, last Full/AM; single day → one session.
      if (next.startDate && next.endDate && next.startDate !== next.endDate) {
        if (next.startSession === 'am') next.startSession = 'full';
        if (next.endSession === 'pm') next.endSession = 'full';
      } else next.endSession = next.startSession;
      return next;
    });
    setAck(false);
  };

  // ---- live preview ------------------------------------------------------------------------
  const ready = Boolean(form && f.leaveTypeId && ISO.test(f.startDate) && ISO.test(f.endDate) && (mode === 'own' || employee));
  React.useEffect(() => {
    if (!ready) {
      setPreview(null);
      setPState('idle');
      return;
    }
    let alive = true;
    setPState('loading');
    const t = window.setTimeout(async () => {
      try {
        const res = await previewLeaveApplication({
          employeeId: mode === 'behalf' ? employee?.id : undefined,
          leaveTypeId: f.leaveTypeId,
          startDate: f.startDate,
          startSession: f.startSession,
          endDate: f.endDate,
          endSession: f.endSession,
          reason: f.reason || null,
          expectedConfinementDate: f.expectedConfinementDate || null,
          childBirthDate: f.childBorn === 'yes' ? f.childBirthDate || null : null,
          contactPhone: null,
          coverEmployeeId: null,
          onBehalfReason: null,
          attachmentCount: files.length,
        });
        if (!alive) return;
        if (res.ok) {
          setPreview(res);
          setPState('idle');
          if (res.endDateFixed && res.endDate !== f.endDate) setF((x) => ({ ...x, endDate: res.endDate }));
        } else {
          setPreview(null);
          setPState('error');
        }
      } catch {
        if (alive) {
          setPreview(null);
          setPState('error');
        }
      }
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
    // reason does not change the count; only re-check on the inputs that do
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, f.leaveTypeId, f.startDate, f.startSession, f.endDate, f.endSession, f.expectedConfinementDate, f.childBorn, f.childBirthDate, files.length, employee?.id, retry]);

  if (!form) {
    return (
      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          {mode === 'behalf' ? (
            <Stack spacing={2}>
              {notFoundEmployee && <Alert severity="error">This employee can&apos;t be chosen — it is your own record or not available for leave.</Alert>}
              <LeaveEmployeePicker
                label="Employee"
                required
                includeSeparated
                value={null}
                onChange={(v) => v && router.replace(`/leave/apply-on-behalf?employee=${encodeURIComponent(v.id)}`)}
                helper="Active and Notice Period employees; Separated employees are tagged “Separated — HR only”. Not available for your own record."
              />
              <Typography variant="body2" color="text.secondary">
                Choose the employee first — the leave types and balances shown are theirs (hidden types are available on behalf).
              </Typography>
            </Stack>
          ) : (
            <Typography>Your employee record has not been created yet.</Typography>
          )}
        </CardContent>
      </Card>
    );
  }

  // ---- errors: preview blocks + server submit errors, keyed by field --------------------------
  const blocks = preview?.blocks ?? [];
  const warnings = preview?.warnings ?? [];
  const fieldErr: Record<string, string> = { ...submitFieldErrors };
  for (const b of blocks) if (b.field && !fieldErr[b.field]) fieldErr[b.field] = b.message;
  const attachmentRequired = preview?.attachmentRequired ?? (type?.attachmentRule === 'always');
  const reasonRequired = Boolean(type?.reasonRequired);
  const localErrors: Record<string, string> = {};
  if (reasonRequired && f.reason.trim() === '') localErrors.reason = 'Reason is required.';
  if (attachmentRequired && !preview?.attachmentMayFollow && files.length === 0) localErrors.attachmentFileIds = type?.category === 'sick' || type?.category === 'hospitalisation' ? 'Medical certificate required.' : `${type?.name ?? 'This type'} needs a supporting document.`;
  if (type?.requiresConfinementDate && !f.expectedConfinementDate) localErrors.expectedConfinementDate = 'Enter the expected confinement date.';
  if (mode === 'behalf' && f.onBehalfReason.trim().length < 10) localErrors.onBehalfReason = 'Reason for acting on behalf must be at least 10 characters.';
  if (mode === 'behalf' && !employee) localErrors.employeeId = 'Choose the employee.';
  /** local (client) errors show once the user has tried to submit */
  const submitTried = () => Object.keys(submitFieldErrors).length > 0 || submitError !== null;

  const canSubmit = ready && pState === 'idle' && preview !== null && blocks.length === 0 && (warnings.length === 0 || ack) && !saving;

  const typeOptions: Option[] = form.types.map((t) => ({ value: t.id, label: t.name, secondary: `${t.availableLabel}${t.hrOnly ? ' · HR only' : ''}` }));
  const startSessionOptions: Option[] = singleDay
    ? [
        { value: 'full', label: 'Full' },
        { value: 'am', label: 'AM' },
        { value: 'pm', label: 'PM' },
      ]
    : [
        { value: 'full', label: 'Full' },
        { value: 'pm', label: 'PM' },
      ];
  const endSessionOptions: Option[] = [
    { value: 'full', label: 'Full' },
    { value: 'am', label: 'AM' },
  ];

  const trySubmit = () => {
    const errs = { ...localErrors };
    if (Object.keys(errs).length) {
      setSubmitFieldErrors(errs);
      setSubmitError('Check the highlighted fields.');
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (!canSubmit) return;
    setConfirm(true);
  };

  const submit = async () => {
    setSaving(true);
    setSubmitError(null);
    setSubmitFieldErrors({});
    try {
      const res = await applyLeave({
        employeeId: mode === 'behalf' ? employee?.id : undefined,
        leaveTypeId: f.leaveTypeId,
        startDate: f.startDate,
        startSession: f.startSession,
        endDate: f.endDate,
        endSession: f.endSession,
        reason: f.reason || null,
        expectedConfinementDate: f.expectedConfinementDate || null,
        childBirthDate: f.childBorn === 'yes' ? f.childBirthDate || null : null,
        contactPhone: f.contactPhone || null,
        coverEmployeeId: cover?.id ?? null,
        onBehalfReason: mode === 'behalf' ? f.onBehalfReason : null,
        attachmentFileIds: files.map((x) => x.fileId),
        acknowledgeWarnings: ack,
        idempotencyKey: idemKey,
      });
      if (res.ok) {
        setResult(res);
        setDirty(false);
        router.refresh();
      } else {
        setSubmitError(res.error);
        setSubmitFieldErrors(res.fieldErrors ?? {});
        topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch {
      // Network failure: entries kept; TRY AGAIN re-sends the same idempotency key (EC-LV-09).
      setSubmitError('No connection — your entries are kept. Press SUBMIT to try again.');
    } finally {
      setSaving(false);
      setConfirm(false);
    }
  };

  // ---- success ------------------------------------------------------------------------------
  if (result) {
    const first = result.applications[0];
    const viewHref = first ? (mode === 'behalf' ? `/approvals/leave/${encodeURIComponent(first.refNo)}` : `/my/leave/${encodeURIComponent(first.refNo)}`) : '/my/leave';
    return (
      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Alert severity="success" sx={{ mb: 2 }}>
            {result.message}
          </Alert>
          {result.applications.length > 1 && (
            <Typography variant="body2" sx={{ mb: 2 }}>
              Split into {result.applications.length} linked applications: {result.applications.map((a) => `${a.refNo} (${a.year}: ${daysText(a.days)})`).join(' · ')}
            </Typography>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button variant="contained" component={NextLink} href={viewHref}>
              View application
            </Button>
            {mode === 'behalf' ? (
              <Button
                variant="outlined"
                onClick={() => {
                  setResult(null);
                  setF(EMPTY);
                  setFiles([]);
                  renewKey();
                }}
              >
                Apply another
              </Button>
            ) : (
              <Button variant="outlined" component={NextLink} href="/home">
                Back to home
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>
    );
  }

  const shownErr = (k: string) => fieldErr[k] ?? (submitTried() ? localErrors[k] : undefined);
  const balance = preview?.balance;
  const blockSummary = [...blocks.map((b) => b.message), ...(submitError ? [submitError] : [])];

  // ---- balance panel (LA9) ---------------------------------------------------------------------
  const panel = (
    <Box>
      {pState === 'error' ? (
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Typography variant="body2" color="error">
            Couldn&apos;t check balance
          </Typography>
          <Button size="small" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </Button>
        </Stack>
      ) : !ready ? (
        <Typography variant="body2" color="text.secondary">
          Choose a leave type and dates to see the balance.
        </Typography>
      ) : balance?.notApplicable ? (
        <PanelRow label="This application" value={pState === 'loading' ? '…' : daysText(preview?.days)} strong />
      ) : (
        <>
          <PanelRow label="Available now" value={pState === 'loading' || !balance ? '…' : formatDays(balance.availableNow)} />
          <PanelRow label="This application" value={pState === 'loading' || !balance ? '…' : `−${formatDays(balance.thisApplication)}`} />
          <PanelRow label="Pending" value={pState === 'loading' || !balance ? '…' : `−${formatDays(balance.pending)}`} />
          <Divider sx={{ my: 0.5 }} />
          <PanelRow
            label="Available after"
            value={pState === 'loading' || !balance ? '…' : formatDays(balance.availableAfter)}
            strong
            tone={balance && Number(balance.availableAfter) < 0 ? 'error' : undefined}
          />
          {balance?.earnedToDate && (
            <Typography variant="caption" color="text.secondary" component="p">
              (Earned to date at {formatDate(balance.earnedToDateAt)}: {formatDays(balance.earnedToDate)})
            </Typography>
          )}
          {balance?.pool && (
            <Typography variant="caption" color="text.secondary" component="p">
              {balance.pool.label}: {formatDays(balance.pool.used)} of {formatDays(balance.pool.cap)} used
            </Typography>
          )}
        </>
      )}
      {preview && preview.parts.length > 1 && (
        <Box sx={{ mt: 1 }}>
          {preview.parts.map((p) => (
            <Typography key={p.year} variant="caption" component="p" color="text.secondary">
              {p.year}: {daysText(p.days)} · available after {formatDays(p.balance.availableAfter)}
            </Typography>
          ))}
        </Box>
      )}
      {warnings.length > 0 && blocks.length === 0 && (
        <Box sx={{ mt: 1 }}>
          <CheckboxInput label="I understand" checked={ack} onChange={setAck} helper={warnings.map((w) => w.message).join(' ')} />
        </Box>
      )}
      <Button fullWidth variant="contained" size="large" sx={{ mt: 1.5, minHeight: 48 }} onClick={trySubmit} disabled={!canSubmit && Object.keys(localErrors).length === 0} loading={saving}>
        Submit
      </Button>
    </Box>
  );

  return (
    <Box ref={topRef}>
      {blockSummary.length > 0 && (
        <Alert severity="error" sx={{ mb: 2 }} role="alert">
          {blockSummary.length === 1 ? (
            blockSummary[0]
          ) : (
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {blockSummary.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </Box>
          )}
        </Alert>
      )}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Card>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Stack spacing={2}>
                {form.formMessage && (
                  <Alert severity="info" icon={<InfoOutlinedIcon />}>
                    {form.formMessage}
                  </Alert>
                )}
                {mode === 'behalf' && (
                  <>
                    <LeaveEmployeePicker
                      label="Employee"
                      required
                      includeSeparated
                      value={employee ?? null}
                      onChange={(v) => {
                        // the form (eligible types, balances) is loaded for the chosen employee on the server
                        router.replace(v ? `/leave/apply-on-behalf?employee=${encodeURIComponent(v.id)}` : '/leave/apply-on-behalf');
                      }}
                      error={shownErr('employeeId')}
                      helper="Active and Notice Period employees; Separated employees are tagged “Separated — HR only”. Not available for your own record."
                    />
                    <TextInput
                      label="Reason for acting on behalf"
                      required
                      value={f.onBehalfReason}
                      onChange={(v) => set({ onBehalfReason: v })}
                      maxLength={500}
                      multiline
                      minRows={2}
                      error={shownErr('onBehalfReason')}
                      helper="At least 10 characters. Recorded on the application (“On behalf by …”)."
                    />
                    {employee && (
                      <Typography variant="body2" color="text.secondary">
                        {form.employee.name} · {form.employee.department} · {form.employee.status}
                      </Typography>
                    )}
                  </>
                )}
                <SelectInput
                  label="Leave type"
                  required
                  value={f.leaveTypeId}
                  onChange={(v) => set({ leaveTypeId: v })}
                  options={typeOptions}
                  error={shownErr('leaveTypeId')}
                  helper={form.types.length === 0 ? 'No leave types available yet — contact HR.' : undefined}
                />
                {type?.description && (
                  <Alert severity="info" variant="outlined" icon={<InfoOutlinedIcon />}>
                    {type.description}
                  </Alert>
                )}
                {initialTypeCode && !type && form.ineligible.find((i) => i.type.code === initialTypeCode.toUpperCase()) && (
                  <Alert severity="warning">
                    {(() => {
                      const i = form.ineligible.find((x) => x.type.code === initialTypeCode.toUpperCase())!;
                      return `You're not eligible for ${i.type.name}: ${i.reason}.`;
                    })()}
                  </Alert>
                )}
                <Grid container spacing={2}>
                  <Grid size={{ xs: 7, sm: 8 }}>
                    <LeaveDateField
                      label="Start date"
                      required
                      value={f.startDate}
                      onChange={(v) => set({ startDate: v })}
                      maxDate={form.maxDate}
                      marks={marks}
                      error={shownErr('startDate')}
                    />
                  </Grid>
                  <Grid size={{ xs: 5, sm: 4 }}>
                    {(!type || type.halfDayAllowed) && (
                      <SelectInput label="Session" value={f.startSession} onChange={(v) => set({ startSession: v as LeaveSessionValue })} options={startSessionOptions} error={shownErr('startSession')} />
                    )}
                  </Grid>
                  <Grid size={{ xs: 7, sm: 8 }}>
                    <LeaveDateField
                      label="End date"
                      required
                      value={f.endDate}
                      onChange={(v) => set({ endDate: v })}
                      minDate={f.startDate || undefined}
                      maxDate={form.maxDate}
                      marks={marks}
                      readOnly={fixedEnd}
                      readOnlyReason="🔒 Fixed by policy"
                      error={shownErr('endDate')}
                    />
                  </Grid>
                  <Grid size={{ xs: 5, sm: 4 }}>
                    {(!type || type.halfDayAllowed) && !singleDay && (
                      <SelectInput label="Session" value={f.endSession} onChange={(v) => set({ endSession: v as LeaveSessionValue })} options={endSessionOptions} />
                    )}
                  </Grid>
                </Grid>

                {/* LA8 Days — live, with why */}
                {ready && (
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <InfoOutlinedIcon fontSize="small" color="action" aria-hidden />
                      <Typography variant="body2" aria-live="polite">
                        Days: <strong className="pret-tnum">{pState === 'loading' || !preview ? '…' : formatDays(preview.days)}</strong>
                        {preview && preview.breakdown.some((d) => Number(d.weight) === 0) && pState !== 'loading'
                          ? ` (${preview.breakdown
                              .filter((d) => Number(d.weight) === 0)
                              .slice(0, 3)
                              .map((d) => `${formatDate(d.date).slice(0, 5)} ${d.label.toLowerCase()}`)
                              .join(', ')}${preview.breakdown.filter((d) => Number(d.weight) === 0).length > 3 ? ', …' : ''} not counted)`
                          : ''}
                      </Typography>
                      {preview && preview.breakdown.length > 0 && (
                        <Link component="button" type="button" variant="body2" onClick={() => setShowHow((s) => !s)} sx={{ display: 'inline-flex', alignItems: 'center' }}>
                          How is this counted? {showHow ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                        </Link>
                      )}
                    </Stack>
                    <Collapse in={showHow && Boolean(preview)}>
                      <Box component="ul" sx={{ m: 0, mt: 1, pl: 3 }}>
                        {preview?.breakdown.map((d) => (
                          <Typography component="li" variant="body2" key={d.date} className="pret-tnum">
                            {formatDate(d.date)} · {d.label} · {formatDays(d.weight)}
                          </Typography>
                        ))}
                      </Box>
                    </Collapse>
                  </Box>
                )}

                {type?.requiresConfinementDate && (
                  <LeaveDateField
                    label="Expected confinement date"
                    required
                    value={f.expectedConfinementDate}
                    onChange={(v) => set({ expectedConfinementDate: v })}
                    marks={marks}
                    error={shownErr('expectedConfinementDate')}
                  />
                )}
                {type?.allowsChildBirthDate && (
                  <>
                    <RadioInput
                      label="Child already born?"
                      row
                      value={f.childBorn}
                      onChange={(v) => set({ childBorn: v })}
                      options={[
                        { value: 'yes', label: 'Yes' },
                        { value: 'no', label: 'No' },
                      ]}
                    />
                    {f.childBorn === 'yes' && (
                      <LeaveDateField label="Child's date of birth" value={f.childBirthDate} onChange={(v) => set({ childBirthDate: v })} maxDate={today} marks={marks} error={shownErr('childBirthDate')} />
                    )}
                  </>
                )}

                <TextInput
                  label="Reason"
                  required={reasonRequired}
                  value={f.reason}
                  onChange={(v) => set({ reason: v })}
                  maxLength={500}
                  multiline
                  minRows={2}
                  error={shownErr('reason')}
                />

                {type && (type.attachmentRule !== 'not_required' || files.length > 0 || attachmentRequired) ? (
                  <AttachmentPicker
                    label={type.category === 'sick' || type.category === 'hospitalisation' ? 'Medical certificate (MC)' : 'Attachment'}
                    required={attachmentRequired && !preview?.attachmentMayFollow}
                    files={files}
                    onChange={(x) => {
                      setDirty(true);
                      setFiles(x);
                    }}
                    upload={(file) => uploadLeaveFile(file, type.id, mode === 'behalf' ? employee?.id : null)}
                    error={shownErr('attachmentFileIds')}
                    helper={
                      preview?.attachmentMayFollow && attachmentRequired
                        ? `You can add the MC within ${type.attachmentGraceHours} hours — the application is flagged “Attachment pending”.`
                        : type.attachmentRule === 'if_more_than_n_days'
                          ? `Required for more than ${formatDays(type.attachmentThresholdDays)} days.`
                          : 'PDF, JPG, PNG or HEIC, up to 10 MB each.'
                    }
                  />
                ) : type ? (
                  <AttachmentPicker label="Attachment (optional)" files={files} onChange={setFiles} upload={(file) => uploadLeaveFile(file, type.id, mode === 'behalf' ? employee?.id : null)} />
                ) : null}

                <Box>
                  <Link component="button" type="button" variant="body2" onClick={() => setShowMore((s) => !s)} sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
                    {showMore ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />} More (contact, cover)
                  </Link>
                  <Collapse in={showMore}>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                      <TextInput label="Contact while on leave" value={f.contactPhone} onChange={(v) => set({ contactPhone: v })} type="tel" inputMode="tel" maxLength={20} error={shownErr('contactPhone')} />
                      {mode === 'behalf' ? (
                        <LeaveEmployeePicker label="Cover / handover person" value={cover} onChange={setCover} error={shownErr('coverEmployeeId')} />
                      ) : (
                        <ColleaguePicker label="Cover / handover person" value={cover} onChange={setCover} error={shownErr('coverEmployeeId')} helper="Optional — a colleague who covers your work." />
                      )}
                    </Stack>
                  </Collapse>
                </Box>

                {preview?.isEmergency && (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <EmergencyChip />
                    <Typography variant="body2">This will be flagged EMERGENCY to your approver.</Typography>
                  </Stack>
                )}
                {preview?.notes.map((n) => (
                  <Alert key={n} severity="info" variant="outlined">
                    {n}
                  </Alert>
                ))}
                {warnings.map((w) => (
                  <Alert key={w.code + w.message} severity="warning" variant="outlined">
                    {w.message}
                  </Alert>
                ))}
                {mode === 'behalf' && preview?.blocks.length === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    Back-date windows are not enforced on behalf; the application is recorded as on behalf.
                  </Typography>
                )}
                {(preview?.approverHint ?? form.approverHint) && (
                  <Typography variant="body2" color="text.secondary">
                    {preview?.approverHint ?? form.approverHint}
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
          <Box sx={{ mt: 2 }}>
            <Button variant="outlined" color="inherit" onClick={() => (dirty ? setGuard(true) : router.push(mode === 'behalf' ? '/leave/applications' : '/my/leave'))}>
              Cancel
            </Button>
          </Box>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card
            sx={{
              position: 'sticky',
              bottom: { xs: 'var(--pret-bottom-bar, 0px)', sm: 0, md: 'auto' },
              top: { md: 88 },
              zIndex: 2,
              boxShadow: { xs: '0 -4px 12px rgba(0,0,0,0.08)', md: undefined },
            }}
          >
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="h6" component="h2">
                  Balance
                </Typography>
                {type && <Chip size="small" label={type.name} variant="outlined" />}
              </Stack>
              {panel}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <ConfirmDialog
        open={confirm}
        title={`Submit ${type?.name ?? 'leave'}?`}
        body={
          <Stack spacing={1}>
            <Typography>
              {formatDate(f.startDate)}
              {f.endDate !== f.startDate ? ` – ${formatDate(f.endDate)}` : ''} · {daysText(preview?.days)}
              {mode === 'behalf' && employee ? ` · on behalf of ${employee.name}` : ''}
            </Typography>
            {(preview?.approverHint ?? form.approverHint) && <Typography color="text.secondary">{preview?.approverHint ?? form.approverHint}</Typography>}
            {preview?.isEmergency && <EmergencyChip />}
          </Stack>
        }
        confirmLabel="Submit"
        cancelLabel="Back"
        onClose={() => setConfirm(false)}
        onConfirm={submit}
      />
      <ConfirmDialog
        open={guard}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onClose={() => setGuard(false)}
        onConfirm={() => router.push(mode === 'behalf' ? '/leave/applications' : '/my/leave')}
      />
    </Box>
  );
}
