'use client';

// E7 · Record separation — S-EM-07 · /employees/{no}/separation · F-EMP-12 · US-EMP-011.
// Left: form G1–G9. Right: live impact panel (getSeparationPreview): status after save,
// notice required + basis (EA s12 / contractual), expected LWD, shortfall, reportees needing a
// new manager; leave position at LWD / approvals re-routed / open claims arrive with W2-004/005.
// Editing later: same screen with SAVE CHANGES.
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  EMPLOYMENT_STATUS_LABELS,
  NOTICE_OUTCOME_LABELS,
  SEPARATION_REASON_LABELS,
  SEPARATION_TYPE_LABELS,
  type EmployeeProfile,
  type SeparationPreview,
} from '@/server/contracts/employees';
import { fetchSeparationPreview, recordSeparation, updateSeparation } from '@/server/actions/employees';
import ErrorSummary from '../forms/ErrorSummary';
import { CheckboxInput, DateInput, FormGrid, SelectInput, TextInput } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import { KVGrid } from './ui';
import { optionsOf } from './labels';
import { addDays, formatDate, todayMyt } from '@/lib/format';

export default function SeparationForm({ profile }: { profile: EmployeeProfile }) {
  const router = useRouter();
  const r = useActionRunner();
  const existing = profile.separation;
  const d = existing?.details;
  const back = `/employees/${encodeURIComponent(profile.personal.employeeNo)}?tab=employment`;
  const [f, setF] = React.useState({
    noticeDate: existing?.noticeDate ?? todayMyt(),
    separationType: existing?.separationType ?? '',
    reasonCategory: d?.reasonCategory ?? '',
    reasonText: d?.reasonText ?? '',
    lastWorkingDay: existing?.lastWorkingDay ?? '',
    noticeOutcome: (d?.noticeOutcome ?? 'served') as string,
    portalAccessEndDate: d?.portalAccessEndDate ?? '',
    eligibleForRehire: d?.eligibleForRehire ?? false,
    exitRemarks: d?.exitRemarks ?? '',
  });
  const [lwdTouched, setLwdTouched] = React.useState(Boolean(existing));
  const [accessTouched, setAccessTouched] = React.useState(Boolean(existing));
  const [preview, setPreview] = React.useState<SeparationPreview | null>(null);
  const [guard, setGuard] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const set = (p: Partial<typeof f>) => {
    setDirty(true);
    setF((x) => ({ ...x, ...p }));
  };

  React.useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.noticeDate)) return;
    let alive = true;
    const t = window.setTimeout(async () => {
      let pv: SeparationPreview | null = null;
      try {
        const res = await fetchSeparationPreview({ employeeId: profile.id, noticeDate: f.noticeDate, lastWorkingDay: f.lastWorkingDay || null });
        pv = res.ok ? res.preview : null;
      } catch {
        pv = null;
      }
      if (!alive || !pv) return;
      setPreview(pv);
      setF((x) => {
        const lwd = lwdTouched ? x.lastWorkingDay : pv.expectedLastWorkingDay;
        return { ...x, lastWorkingDay: lwd, portalAccessEndDate: accessTouched ? x.portalAccessEndDate : lwd };
      });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.noticeDate, f.lastWorkingDay]);

  const maxAccess = f.lastWorkingDay ? addDays(f.lastWorkingDay, 30) : undefined;
  const save = async () => {
    const payload = {
      noticeDate: f.noticeDate,
      separationType: f.separationType as 'resignation',
      reasonCategory: f.reasonCategory as 'other',
      reasonText: f.reasonText,
      lastWorkingDay: f.lastWorkingDay,
      noticeOutcome: f.noticeOutcome as 'served',
      portalAccessEndDate: f.portalAccessEndDate || f.lastWorkingDay,
      eligibleForRehire: f.eligibleForRehire,
      exitRemarks: f.exitRemarks,
    };
    const res = await r.run(
      () => (existing ? updateSeparation({ separationId: existing.id, version: existing.version, ...payload }) : recordSeparation({ employeeId: profile.id, ...payload })),
      {
        refresh: false,
        success: (x) => `Separation ${existing ? 'updated' : 'recorded'} · status ${EMPLOYMENT_STATUS_LABELS[(x as unknown as { status: 'separated' }).status] ?? ''}.`,
      },
    );
    if (res?.ok) router.push(back);
  };

  return (
    <Box>
      <ErrorSummary
        error={r.error}
        fieldErrors={r.fieldErrors}
        labels={{ noticeDate: 'Notice date', separationType: 'Separation type', reasonCategory: 'Reason', reasonText: 'Reason details', lastWorkingDay: 'Last working day', noticeOutcome: 'Notice handling', portalAccessEndDate: 'Portal access end' }}
      />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
                {existing ? 'Edit separation' : 'Record separation'} — {profile.personal.fullName} ({profile.personal.employeeNo})
              </Typography>
              <fieldset disabled={r.saving} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                <FormGrid>
                  <DateInput label="Notice date" required value={f.noticeDate} onChange={(v) => set({ noticeDate: v })} error={r.fieldErrors.noticeDate} helper="Date the resignation was received / notice given." />
                  <SelectInput label="Separation type" required value={f.separationType} onChange={(v) => set({ separationType: v })} options={optionsOf(SEPARATION_TYPE_LABELS)} error={r.fieldErrors.separationType} />
                  <SelectInput label="Reason (HR only)" required value={f.reasonCategory} onChange={(v) => set({ reasonCategory: v })} options={optionsOf(SEPARATION_REASON_LABELS)} error={r.fieldErrors.reasonCategory} />
                  <TextInput label="Reason details" required={f.reasonCategory === 'other'} value={f.reasonText} onChange={(v) => set({ reasonText: v })} maxLength={500} error={r.fieldErrors.reasonText} />
                  <TextInput label="Notice period required" value={preview ? `${preview.noticeRequiredDays} days — ${preview.noticeBasis}` : ''} onChange={() => undefined} locked="EA s12 by service at the notice date, or the contractual notice period." />
                  <DateInput
                    label="Last working day"
                    required
                    value={f.lastWorkingDay}
                    onChange={(v) => {
                      setLwdTouched(true);
                      set({ lastWorkingDay: v, portalAccessEndDate: accessTouched ? f.portalAccessEndDate : v });
                    }}
                    minDate={f.noticeDate}
                    error={r.fieldErrors.lastWorkingDay}
                    helper={preview ? `Expected LWD ${formatDate(preview.expectedLastWorkingDay)}.` : undefined}
                  />
                  <SelectInput label="Notice handling" required value={f.noticeOutcome} onChange={(v) => set({ noticeOutcome: v })} options={optionsOf(NOTICE_OUTCOME_LABELS)} error={r.fieldErrors.noticeOutcome} />
                  <TextInput label="Shortfall (days)" value={preview ? String(preview.shortfallDays) : ''} onChange={() => undefined} locked="Notice required − (LWD − notice date + 1), minimum 0." />
                  <DateInput
                    label="Portal access end"
                    required
                    value={f.portalAccessEndDate}
                    onChange={(v) => {
                      setAccessTouched(true);
                      set({ portalAccessEndDate: v });
                    }}
                    minDate={f.lastWorkingDay || undefined}
                    maxDate={maxAccess}
                    error={r.fieldErrors.portalAccessEndDate}
                    helper="Default = last working day; at most 30 days after it."
                  />
                  <CheckboxInput label="Eligible for rehire" checked={f.eligibleForRehire} onChange={(v) => set({ eligibleForRehire: v })} />
                  <TextInput full label="Exit remarks (HR only)" value={f.exitRemarks} onChange={(v) => set({ exitRemarks: v })} maxLength={1000} multiline minRows={3} error={r.fieldErrors.exitRemarks} />
                </FormGrid>
              </fieldset>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ position: { md: 'sticky' }, top: { md: 88 } }}>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
                Impact
              </Typography>
              {!preview ? (
                <Typography color="text.secondary">Enter the notice date to see the impact.</Typography>
              ) : (
                <Stack spacing={2}>
                  {(preview.warnings ?? []).map((w) => (
                    <Alert key={w} severity="warning">
                      {w}
                    </Alert>
                  ))}
                  {f.separationType === 'termination_with_notice' && (
                    <Alert severity="warning" variant="outlined">
                      Check that the employee is not on maternity leave — termination during the maternity period is prohibited (EA s41A).
                    </Alert>
                  )}
                  <KVGrid
                    columns={2}
                    items={[
                      {
                        label: 'Status after save',
                        value:
                          preview.statusAfter === 'notice_period'
                            ? `Notice Period until ${formatDate(f.lastWorkingDay || preview.expectedLastWorkingDay)}`
                            : `${EMPLOYMENT_STATUS_LABELS[preview.statusAfter]} now`,
                        full: true,
                      },
                      { label: 'Expected last working day', value: formatDate(preview.expectedLastWorkingDay) },
                      { label: 'Notice shortfall', value: `${preview.shortfallDays} days` },
                      { label: 'Portal access ends', value: formatDate(f.portalAccessEndDate || preview.defaultPortalAccessEnd) },
                      {
                        label: 'Reportees',
                        value:
                          preview.reporteeCount > 0 ? (
                            <Link component={NextLink} href="/organisation/reporting-lines">
                              {preview.reporteeCount} reportee{preview.reporteeCount === 1 ? '' : 's'} will need a new manager
                            </Link>
                          ) : (
                            'None'
                          ),
                        full: true,
                      },
                    ]}
                  />
                  <Alert severity="info" variant="outlined">
                    Leave position at LWD (encashable / recoverable days), approved leave after LWD, approvals to re-route and open claims appear here after W2-004 / W2-005.
                  </Alert>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2, position: { xs: 'sticky', sm: 'static' }, bottom: 0, bgcolor: { xs: 'background.default', sm: 'transparent' }, py: { xs: 1.5, sm: 0 } }}>
        <Button variant="outlined" color="inherit" onClick={() => (dirty ? setGuard(true) : router.push(back))} disabled={r.saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={save} loading={r.saving}>
          {existing ? 'Save changes' : 'Record separation'}
        </Button>
      </Stack>
      <ConfirmDialog open={guard} title="Discard unsaved changes?" confirmLabel="Discard" cancelLabel="Keep editing" destructive onClose={() => setGuard(false)} onConfirm={() => router.push(back)} />
    </Box>
  );
}
