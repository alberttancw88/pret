'use client';

// R5 · Monthly payroll-input pack (Kakitangan) — S-RP-23 · /reports/payroll-input · F-RPT-21 · US-REPORT-021 · 🔒 sensitive.
// Filters: Payroll month * · PREVIEW. Tabs (one per sheet): Joiners · Leavers · Job changes · Bank changes ·
// Statutory-profile changes · Unpaid leave days · Rest-day work paid. Reversal lines (cancellations after a previous
// export) carry a "Reversal" badge. No claims sheet (D16) — note on screen. EXPORT .XLSX (all sheets) · EXPORT .CSV
// (current sheet) · "Last exported dd/mm/yyyy by {name}". After the R1.1 cut-over: "Retired at payroll cut-over on …".
// The on-screen view and every export are access-logged by the server (bank account in full, statutory numbers).
import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import TablePagination from '@mui/material/TablePagination';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import LockIcon from '@mui/icons-material/Lock';
import { PAYROLL_INPUT_SHEET_LABELS, type PayrollInputPack as Pack } from '@/server/contracts/reports';
import { exportPayrollInputPack } from '@/server/actions/reports';
import { KeywordField, SelectFilter } from '../list/FilterFields';
import { DensityToggle, useDensity } from '../list/density';
import EmptyState from '../EmptyState';
import PageTitle from '../shell/PageTitle';
import { useToast } from '../ToastProvider';
import { formatDate, formatDateTime } from '@/lib/format';
import ReportTable from './ReportTable';
import { monthOptions } from './ReportFilterFields';
import { formatCell, saveDownload } from './format';

export default function PayrollInputPack({ pack, today, preview }: { pack: Pack; today: string; preview?: boolean }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/reports/payroll-input';
  const toast = useToast();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const [density, setDensity] = useDensity();
  const [month, setMonth] = React.useState(pack.month);
  const [monthError, setMonthError] = React.useState('');
  const [tab, setTab] = React.useState(0);
  const [q, setQ] = React.useState('');
  const [page, setPage] = React.useState(0);
  const [rpp, setRpp] = React.useState(25);
  const [lastExport, setLastExport] = React.useState(pack.lastExport);
  const [busy, setBusy] = React.useState<'xlsx' | 'csv' | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    setMonth(pack.month);
    setLastExport(pack.lastExport);
    setPage(0);
  }, [pack]);

  const current = pack.tabs[Math.min(tab, pack.tabs.length - 1)];
  const needle = q.trim().toLowerCase();
  const filtered = current
    ? current.rows.filter((r) => !needle || current.columns.some((c) => formatCell(r.cells[c.key], c.format).toLowerCase().includes(needle)))
    : [];
  const pageRows = filtered.slice(page * rpp, page * rpp + rpp);

  const doExport = async (format: 'xlsx' | 'csv') => {
    if (preview) {
      toast.info('Exports are disabled in the component gallery.');
      return;
    }
    setBusy(format);
    try {
      const res = await exportPayrollInputPack({ month: pack.month, format, sheet: format === 'csv' ? current?.sheet : undefined });
      if (res.ok) {
        saveDownload(res.file);
        setLastExport(res.lastExport);
      } else toast.info(res.error);
    } finally {
      setBusy(null);
    }
  };

  const exportButton = (format: 'xlsx' | 'csv') => (
    <Tooltip key={format} title="Access is logged">
      <span>
        <Button
          variant="contained"
          color="success"
          startIcon={<LockIcon />}
          loading={busy === format}
          loadingPosition="start"
          disabled={Boolean(pack.retired)}
          onClick={() => void doExport(format)}
        >
          {format === 'xlsx' ? 'Export .XLSX' : 'Export .CSV'}
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <Stack spacing={2}>
      <PageTitle title="Monthly payroll-input pack" breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: 'Monthly payroll-input pack' }]} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          Payroll inputs for the Kakitangan payroll until the Release 1.1 cut-over · {pack.monthLabel} ({formatDate(pack.periodFrom)} – {formatDate(pack.periodTo)})
        </Typography>
        <Chip size="small" color="warning" icon={<LockIcon />} label="Sensitive — access is logged" />
      </Stack>

      {pack.retired && <Alert severity="info">Retired at payroll cut-over on {formatDate(pack.retired.on)}. Read-only history.</Alert>}

      <Box
        component="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!month) {
            setMonthError('Select the payroll month.');
            return;
          }
          setMonthError('');
          setTab(0);
          if (preview) return;
          startTransition(() => router.replace(`${pathname}?month=${encodeURIComponent(month)}`, { scroll: false }));
        }}
      >
        <Card sx={{ p: { xs: 2, md: 2.5 } }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <SelectFilter label="Payroll month *" value={month} onChange={setMonth} options={monthOptions(today)} />
              {monthError && (
                <Typography variant="caption" color="error" sx={{ mx: 1.75 }}>
                  {monthError}
                </Typography>
              )}
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <KeywordField
                value={q}
                onChange={(v) => {
                  setQ(v);
                  setPage(0);
                }}
                hint="Employee no. or name, in the current sheet."
              />
            </Grid>
          </Grid>
        </Card>
        <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mr: 'auto' }} className="pret-tnum">
            {lastExport ? `Last exported ${formatDate(lastExport.at)} by ${lastExport.byName} (version ${lastExport.version})` : 'Not exported yet for this month'}
          </Typography>
          {exportButton('xlsx')}
          {exportButton('csv')}
          <Button variant="contained" type="submit" loading={pending}>
            Preview
          </Button>
        </Stack>
      </Box>

      <Alert severity="info">{pack.noClaimsNote}</Alert>

      <Card sx={{ overflow: 'hidden' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, pt: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Tabs
            value={Math.min(tab, Math.max(0, pack.tabs.length - 1))}
            onChange={(_e, v) => {
              setTab(v);
              setPage(0);
            }}
            variant="scrollable"
            allowScrollButtonsMobile
            aria-label="Payroll-input sheets"
            sx={{ flex: 1, minWidth: 0 }}
          >
            {pack.tabs.map((t) => (
              <Tab key={t.sheet} label={`${PAYROLL_INPUT_SHEET_LABELS[t.sheet]} (${t.count})`} />
            ))}
          </Tabs>
          {!phone && <DensityToggle value={density} onChange={setDensity} />}
        </Stack>
        {!current || filtered.length === 0 ? (
          <EmptyState
            kind={needle ? 'filtered' : 'none'}
            title={needle ? 'No results for this search.' : `No ${current ? PAYROLL_INPUT_SHEET_LABELS[current.sheet].toLowerCase() : 'rows'} for ${pack.monthLabel}.`}
          />
        ) : (
          <Box sx={phone ? { p: 1.5 } : undefined}>
            <ReportTable caption={PAYROLL_INPUT_SHEET_LABELS[current.sheet]} columns={current.columns} rows={pageRows} compact={density === 'compact' && !phone} phone={phone} />
          </Box>
        )}
        {current && filtered.length > 0 && (
          <TablePagination
            component="div"
            count={filtered.length}
            page={page}
            rowsPerPage={rpp}
            rowsPerPageOptions={[10, 25, 50, 100]}
            onPageChange={(_e, p) => setPage(p)}
            onRowsPerPageChange={(e) => {
              setRpp(parseInt(e.target.value, 10));
              setPage(0);
            }}
            labelRowsPerPage="Rows per page"
            labelDisplayedRows={({ from, to, count }) => `${from}–${to} of ${count}`}
          />
        )}
      </Card>

      <Typography variant="caption" color="text.secondary" component="p" className="pret-tnum">
        Generated {formatDateTime(pack.meta.generatedAt)} by {pack.meta.generatedBy}
        {pack.meta.viewLogged ? ' · this view is logged' : ''}
      </Typography>
    </Stack>
  );
}
