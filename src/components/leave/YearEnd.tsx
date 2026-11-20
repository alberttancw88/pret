'use client';

// L13 · Year-end roll-over — S-LV-13 · /leave/year-end?year= · F-LV-19, F-LV-04 · US-LEAVE-026, 005
// Header "Year-end roll-over: 2027 → 2028 · Window 01/12/2027 – 31/01/2028" · Step 1 PREVIEW · Step 2 Review · Step 3 RUN
// ROLL-OVER · Preview (as at 31/12): filters Department · Only forfeiting · Search employee · Columns Employee · Type ·
// Closing bal. · Carry-forward · Forfeited · CF expiry · New-year entitlement · Totals · EXPORT .CSV. Checks: next-year
// PH calendar published (blocking), pending in closing year ("they stay pending"). Run confirm. Re-run → "Already run on
// … — running again changes nothing". History: Year · Run at · By · Employees · Carried · Forfeited · REPORT (W2-007).
// REGENERATE ENTITLEMENTS (F-LV-04) with year selector.
import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { RolloverLineRow, RolloverPreview, YearEndStatus } from '@/server/contracts/leave';
import { exportRolloverCsv, previewRollover, recomputeEntitlements, runRollover } from '@/server/actions/leave';
import ListPage, { type ListColumn } from '../list/ListPage';
import { KeywordField, MultiSelectFilter, YesNoFilter } from '../list/FilterFields';
import { downloadServerCsv } from '../list/useServerList';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import { useActionRunner } from '../forms/useActionRunner';
import { MiniTable } from '../employees/ui';
import { useToast } from '../ToastProvider';
import { formatDate, formatDateTime } from '@/lib/format';
import { DaysCell, formatDays } from './common';

export default function YearEnd({ status, departments, currentYear }: { status: YearEndStatus; departments: { id: string; label: string }[]; currentYear: number }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const toast = useToast();
  const r = useActionRunner();
  const regen = useActionRunner();
  const y = status.closingYear;
  const [preview, setPreview] = React.useState<RolloverPreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [f, setF] = React.useState({ q: '', departmentIds: '', onlyForfeiting: '' });
  const [applied, setApplied] = React.useState(f);
  const [page, setPage] = React.useState(0);
  const [rpp, setRpp] = React.useState(50);
  const [confirm, setConfirm] = React.useState(false);
  const [regenYear, setRegenYear] = React.useState(String(currentYear));
  const [regenAsk, setRegenAsk] = React.useState(false);

  const params = (pf = applied, p = page, size = rpp) => ({
    closingYear: y,
    q: pf.q || undefined,
    departmentIds: pf.departmentIds ? pf.departmentIds.split(',') : undefined,
    onlyForfeiting: pf.onlyForfeiting === 'yes',
    page: p + 1,
    pageSize: size,
  });
  const load = async (pf = applied, p = page, size = rpp) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await previewRollover(params(pf, p, size));
      if (res.ok) setPreview(res);
      else setErr(res.error);
    } catch {
      setErr('The preview could not be produced. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  const step = status.alreadyRun ? 3 : preview ? 1 : 0;

  const columns: ListColumn<RolloverLineRow>[] = [
    { key: 'employee', header: 'Employee', value: (x) => `${x.employee.name}${x.employee.employeeNo ? ` (${x.employee.employeeNo})` : ''}` },
    { key: 'department', header: 'Department', priority: 'low', value: (x) => x.department },
    { key: 'type', header: 'Type', value: (x) => x.leaveType.code },
    { key: 'closing', header: 'Closing bal.', align: 'right', value: (x) => formatDays(x.closingBalance), render: (x) => <DaysCell value={x.closingBalance} /> },
    { key: 'cf', header: 'Carry-forward', align: 'right', value: (x) => formatDays(x.carryForward) },
    { key: 'forfeit', header: 'Forfeited', align: 'right', value: (x) => formatDays(x.forfeited) },
    { key: 'expiry', header: 'CF expiry', kind: 'date', value: (x) => formatDate(x.cfExpiry) },
    { key: 'new', header: 'New-year entitlement', align: 'right', value: (x) => formatDays(x.newYearEntitlement) },
  ];

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} justifyContent="space-between">
            <Box>
              <Typography variant="h4" component="h2">
                Year-end roll-over: {y} → {y + 1}
              </Typography>
              <Typography color={status.window.open ? 'text.secondary' : 'warning.main'}>
                Window {formatDate(status.window.from)} – {formatDate(status.window.to)}
                {status.window.open ? '' : ' · outside the window'}
              </Typography>
            </Box>
            <TextField select size="small" label="Closing year" value={String(y)} onChange={(e) => router.replace(`${pathname}?year=${e.target.value}`)} sx={{ minWidth: 140 }}>
              {[currentYear, currentYear - 1, currentYear - 2].map((yy) => (
                <MenuItem key={yy} value={String(yy)}>
                  {yy}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Stepper activeStep={step} alternativeLabel sx={{ mt: 3 }}>
            <Step>
              <StepLabel>Preview</StepLabel>
            </Step>
            <Step>
              <StepLabel>Review</StepLabel>
            </Step>
            <Step>
              <StepLabel>Run roll-over</StepLabel>
            </Step>
          </Stepper>
          <Stack spacing={1} sx={{ mt: 2 }}>
            {status.blockers.map((b) => (
              <Alert key={b} severity="error">
                {b}
              </Alert>
            ))}
            {status.pendingInClosingYear > 0 && (
              <Alert severity="info">
                {status.pendingInClosingYear} pending application{status.pendingInClosingYear === 1 ? '' : 's'} in {y} — they stay pending; approval after the roll-over adjusts both years.
              </Alert>
            )}
            {status.alreadyRun && (
              <Alert severity="success">
                Already run on {formatDateTime(status.alreadyRun.at)} by {status.alreadyRun.byName} — running again changes nothing.
              </Alert>
            )}
            {err && <Alert severity="error">{err}</Alert>}
            {r.error && <Alert severity="error">{r.error}</Alert>}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
            <Button variant="contained" onClick={() => load()} loading={loading}>
              {preview ? 'Refresh preview' : 'Preview'}
            </Button>
            <Button variant="contained" color="success" disabled={!preview || !status.canRun || status.blockers.length > 0} onClick={() => setConfirm(true)}>
              Run roll-over
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {preview && (
        <>
          <Typography variant="h5" component="h2">
            Preview (as at 31/12/{y}) · {preview.totals.employees} employees · carried {formatDays(preview.totals.carried)} · forfeited {formatDays(preview.totals.forfeited)}
          </Typography>
          <ListPage<RolloverLineRow>
            itemName={{ singular: 'line', plural: 'roll-over lines' }}
            filters={[
              <MultiSelectFilter key="d" label="Department" value={f.departmentIds} onChange={(v) => setF((x) => ({ ...x, departmentIds: v }))} options={departments.map((x) => ({ value: x.id, label: x.label }))} />,
              <YesNoFilter key="o" label="Only forfeiting" value={f.onlyForfeiting} onChange={(v) => setF((x) => ({ ...x, onlyForfeiting: v }))} />,
              <KeywordField key="q" label="Search employee" value={f.q} onChange={(v) => setF((x) => ({ ...x, q: v }))} />,
            ]}
            activeFilterCount={[applied.q, applied.departmentIds, applied.onlyForfeiting].filter(Boolean).length}
            onSearch={() => {
              setApplied(f);
              setPage(0);
              void load(f, 0);
            }}
            onClear={() => {
              const c = { q: '', departmentIds: '', onlyForfeiting: '' };
              setF(c);
              setApplied(c);
              setPage(0);
              void load(c, 0);
            }}
            onExport={async () => {
              try {
                const res = await exportRolloverCsv(params());
                if (res.ok) downloadServerCsv(res.filename || `year-end-${y}`, res.content);
                else toast.info(res.error);
              } catch {
                toast.info('Export failed. Please try again.');
              }
            }}
            columns={columns}
            rows={preview.rows}
            total={preview.total}
            page={page}
            rowsPerPage={rpp}
            onPageChange={(p) => {
              setPage(p);
              void load(applied, p);
            }}
            onRowsPerPageChange={(n) => {
              setRpp(n);
              setPage(0);
              void load(applied, 0, n);
            }}
            loading={loading ? 'refresh' : false}
            getRowId={(x) => `${x.employee.id}-${x.leaveType.id}`}
            empty={{ title: 'Nothing to roll over.' }}
          />
        </>
      )}

      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
            History
          </Typography>
          <MiniTable
            caption="Roll-over history"
            rows={status.history}
            getRowId={(h) => h.runId}
            empty="No roll-over has been run yet."
            columns={[
              { key: 'y', header: 'Year', render: (h) => h.closingYear },
              { key: 'at', header: 'Run at', render: (h) => formatDateTime(h.runAt) },
              { key: 'by', header: 'By', render: (h) => h.byName },
              { key: 'e', header: 'Employees', align: 'right', render: (h) => h.employees },
              { key: 'c', header: 'Carried', align: 'right', render: (h) => formatDays(h.carried) },
              { key: 'f', header: 'Forfeited', align: 'right', render: (h) => formatDays(h.forfeited) },
              {
                key: 'r',
                header: 'Report',
                render: () => (
                  <Button size="small" disabled title="Roll-over report (S-RP-17) arrives with W2-007">
                    Report
                  </Button>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
            Regenerate entitlements
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Re-runs the entitlement calculation (F-LV-04) for every employee for the chosen year — e.g. after a band or policy change, or to generate next year&apos;s entitlements in advance.
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField select size="small" label="Year" value={regenYear} onChange={(e) => setRegenYear(e.target.value)} sx={{ minWidth: 120 }}>
              {[currentYear + 1, currentYear, currentYear - 1].map((yy) => (
                <MenuItem key={yy} value={String(yy)}>
                  {yy}
                </MenuItem>
              ))}
            </TextField>
            <Button variant="outlined" onClick={() => setRegenAsk(true)} loading={regen.saving}>
              Regenerate entitlements
            </Button>
          </Stack>
          {regen.error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {regen.error}
            </Alert>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirm}
        title="Run the year-end roll-over?"
        body={
          preview
            ? `Carry forward ${formatDays(preview.totals.carried)} days, forfeit ${formatDays(preview.totals.forfeited)} days for ${preview.totals.employees} employees and generate ${y + 1} entitlements?`
            : ''
        }
        confirmLabel="Run roll-over"
        tone="success"
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          if (!preview) return;
          await r.run(() => runRollover({ closingYear: y, runId: preview.runId }), { success: (x) => String((x as unknown as { message: string }).message) });
          setConfirm(false);
        }}
      />
      <ConfirmDialog
        open={regenAsk}
        title={`Regenerate ${regenYear} entitlements?`}
        body="Entitlements are recomputed from the current bands, overrides and policy. Balances follow from the ledger."
        confirmLabel="Regenerate"
        onClose={() => setRegenAsk(false)}
        onConfirm={async () => {
          await regen.run(() => recomputeEntitlements({ year: Number(regenYear) }), {
            success: (x) => `Recomputed ${(x as unknown as { employees: number }).employees} employees (${(x as unknown as { changed: number }).changed} changed).`,
          });
          setRegenAsk(false);
        }}
      />
    </Stack>
  );
}
