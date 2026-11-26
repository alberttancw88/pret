'use client';

// R3 · Report viewer template — S-RP-03 · /reports/{report} · F-RPT-24, F-RPT-25 (wireframes-reports.md §R3, §R4).
//   Header: {Report name} · 🔒 "Sensitive — access is logged" where the report (or the chosen columns) is sensitive.
//   Filter card (report-specific, REPORT_FILTERS) → [EXPORT .CSV] [EXPORT .XLSX] [PRINT / PDF] [CLEAR] [SEARCH]
//   → summary strip (totals over the whole filtered set) → table (sortable, paginated 25, grouped where stated)
//   → footer "Generated dd/mm/yyyy HH:mm by {name} · as at {date}".
// Heavy reports (loadsOnSearch) show no data until SEARCH. MGR scope is forced to the team (filter shows "My team" 🔒).
// Exports contain only the columns the user may view; the server writes every export to the access log.
// Also used for P7 (leave-individual: header + balances + applications; EMP fixed to self).
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import TablePagination from '@mui/material/TablePagination';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import LockIcon from '@mui/icons-material/Lock';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import type { ReportExportFormat, ReportFilterOptions, ReportId, ReportResult, ReportTable as ReportTableT } from '@/server/contracts/reports';
import { exportReport } from '@/server/actions/reports';
import ListPage from '../list/ListPage';
import { DensityToggle, useDensity } from '../list/density';
import { useServerList } from '../list/useServerList';
import EmptyState from '../EmptyState';
import ErrorState from '../ErrorState';
import PageTitle from '../shell/PageTitle';
import { useToast } from '../ToastProvider';
import { KeyValue } from '../forms/fields';
import { formatDate, formatDateTime } from '@/lib/format';
import { REPORT_FILTERS, defaultFilters, toReportParams } from './reportFilters';
import { ReportFilterField, ScopeField } from './ReportFilterFields';
import ReportTable from './ReportTable';
import { formatCell, formatSummary, saveDownload } from './format';

export type ReportViewerDef = {
  id: ReportId;
  name: string;
  description: string;
  screenId: string;
  sensitive: 'always' | 'when_sensitive_columns' | 'no';
  loadsOnSearch: boolean;
};

export type ReportViewerProps = {
  def: ReportViewerDef;
  result: ReportResult | null;
  /** query failed (readable sentence) — shown in place of the table, filters stay usable */
  error: string | null;
  options: ReportFilterOptions;
  /** 'yyyy-mm-dd' (MYT) */
  today: string;
  /** dev gallery: no server calls */
  preview?: boolean;
};

const ROWS_PER_PAGE = [10, 25, 50, 100];

export default function ReportViewer({ def, result, error, options, today, preview }: ReportViewerProps) {
  const toast = useToast();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const [density, setDensity] = useDensity();
  const compact = density === 'compact' && !phone;
  const defaults = React.useMemo(() => defaultFilters(def.id, options.defaults), [def.id, options.defaults]);
  const list = useServerList({ filters: defaults, rowsPerPage: 25 });
  const d = list.draft;
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [tab, setTab] = React.useState(0);
  const individual = def.id === 'leave-individual';

  // Heavy reports: SEARCH must also send run=true (the server returns searched:false until then).
  React.useEffect(() => {
    if (def.loadsOnSearch && d.run !== 'true') list.setDraftField('run', 'true');
  }, [def.loadsOnSearch, d.run, list]);

  const activeFilterCount = Object.entries(list.applied.filters).filter(([k, v]) => k !== 'run' && v !== '' && v !== defaults[k]).length;
  const sensitive = Boolean(result?.meta.sensitive) || def.sensitive === 'always';
  const scope = result?.meta.scope ?? 'all';

  const search = () => {
    const errs: Record<string, string> = {};
    for (const f of REPORT_FILTERS[def.id]) {
      if ('required' in f && f.required && !d[f.key] && !(f.kind === 'employee' && options.employeeLocked)) errs[f.key] = `Enter ${f.label.toLowerCase()}.`;
    }
    if ('from' in d && 'to' in d && d.from && d.to && d.to < d.from) errs.to = 'The end date must be on or after the start date.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setTab(0);
    list.search();
  };

  const runExport = async (format: ReportExportFormat) => {
    if (preview) {
      toast.info('Exports are disabled in the component gallery.');
      return;
    }
    if (!result?.searched) {
      toast.info('Press Search first.');
      return;
    }
    const params = toReportParams(def.id, { ...list.applied.filters, run: 'true' }, { page: 0, pageSize: 100, sort: list.applied.sort });
    delete params.page;
    delete params.pageSize;
    const res = await exportReport({ reportId: def.id, format, params });
    if (res.ok) saveDownload(res.file);
    else toast.info(res.error);
  };

  const [busy, setBusy] = React.useState<ReportExportFormat | null>(null);
  const exportBtn = (format: 'xlsx' | 'pdf') => (
    <Tooltip key={format} title={sensitive ? 'Access is logged' : ''} disableHoverListener={!sensitive}>
      <span>
        <Button
          variant={format === 'xlsx' ? 'contained' : 'outlined'}
          color={format === 'xlsx' ? 'success' : 'inherit'}
          startIcon={format === 'pdf' ? <PrintOutlinedIcon /> : sensitive ? <LockIcon /> : <FileDownloadOutlinedIcon />}
          loading={busy === format}
          loadingPosition="start"
          onClick={async () => {
            setBusy(format);
            try {
              await runExport(format);
            } finally {
              setBusy(null);
            }
          }}
        >
          {format === 'xlsx' ? 'Export .XLSX' : individual ? 'Print' : 'Print / PDF'}
        </Button>
      </span>
    </Tooltip>
  );

  // ---- filters -------------------------------------------------------------------------------
  const filters: React.ReactNode[] = [];
  if (scope === 'team') filters.push(<ScopeField key="scope" scope="team" />);
  for (const f of REPORT_FILTERS[def.id]) {
    filters.push(
      <ReportFilterField
        key={f.key}
        def={f}
        value={d[f.key] ?? ''}
        onChange={(v) => {
          list.setDraftField(f.key, v);
          if (errors[f.key]) setErrors((e) => ({ ...e, [f.key]: '' }));
        }}
        options={options}
        today={today}
        error={errors[f.key] || undefined}
      />,
    );
  }

  // ---- body ----------------------------------------------------------------------------------
  const tables: { title: string; t: Pick<ReportTableT, 'columns' | 'rows'>; paged: boolean }[] = result
    ? [{ title: individual ? 'Balances' : result.title, t: result, paged: true }, ...result.tables.map((t) => ({ title: t.title, t, paged: false }))]
    : [];

  let mainBody: React.ReactNode;
  if (error) {
    mainBody = (
      <Card sx={{ p: 2 }}>
        <ErrorState kind="card" message={error} />
      </Card>
    );
  } else if (!result || !result.searched) {
    mainBody = (
      <Card>
        <EmptyState title="Set the filters and press Search." helper="This report loads only when you search." />
      </Card>
    );
  } else if (result.rows.length === 0 && result.tables.every((t) => t.rows.length === 0)) {
    mainBody = (
      <Card>
        <EmptyState kind="filtered" title="No results for these filters." />
      </Card>
    );
  } else if (individual) {
    mainBody = <IndividualBody result={result} compact={compact} phone={phone} />;
  } else {
    const current = tables[Math.min(tab, tables.length - 1)]!;
    const table = (
      <ReportTable
        caption={current.title}
        columns={current.t.columns}
        rows={current.t.rows}
        compact={compact}
        phone={phone}
        sort={current.paged ? list.applied.sort : undefined}
        onSortChange={current.paged ? list.setSort : undefined}
      />
    );
    const pagination = current.paged && (
      <TablePagination
        component="div"
        count={result.total}
        page={result.total === 0 ? 0 : list.applied.page}
        rowsPerPage={list.applied.rowsPerPage}
        rowsPerPageOptions={ROWS_PER_PAGE}
        onPageChange={(_e, p) => list.setPage(p)}
        onRowsPerPageChange={(e) => list.setRowsPerPage(parseInt(e.target.value, 10))}
        labelRowsPerPage="Rows per page"
        labelDisplayedRows={({ from, to, count }) => `${from}–${to} of ${count}`}
        sx={phone ? { border: 0, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-input': { display: 'none' } } : undefined}
      />
    );
    const tabsBar = tables.length > 1 && (
      <Tabs value={Math.min(tab, tables.length - 1)} onChange={(_e, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile aria-label="Report views">
        {tables.map((t, i) => (
          <Tab key={i} label={t.title} />
        ))}
      </Tabs>
    );
    mainBody = phone ? (
      <Box>
        {tabsBar}
        {table}
        {pagination}
      </Box>
    ) : (
      <Card sx={{ position: 'relative', overflow: 'hidden' }} aria-busy={list.loading ? 'true' : undefined}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, pt: 1.5, pb: tabsBar ? 0 : 1, borderBottom: tabsBar ? '1px solid' : 0, borderColor: 'divider' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>{tabsBar}</Box>
          <DensityToggle value={density} onChange={setDensity} />
        </Stack>
        {table}
        {pagination}
      </Card>
    );
  }

  return (
    <Stack spacing={2}>
      <PageTitle title={def.name} breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: def.name }]} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between">
        <Typography variant="body2" color="text.secondary">
          {def.description}
        </Typography>
        <Stack direction="row" spacing={1} flexShrink={0}>
          {scope === 'team' && <Chip size="small" icon={<LockIcon />} label="My team" />}
          {sensitive && <Chip size="small" color="warning" icon={<LockIcon />} label="Sensitive — access is logged" />}
        </Stack>
      </Stack>

      <ListPage
        itemName={{ singular: 'row', plural: 'results' }}
        filters={filters}
        activeFilterCount={activeFilterCount}
        onSearch={search}
        onClear={() => {
          setErrors({});
          list.clear();
        }}
        onExport={() => runExport('csv')}
        exportSensitive={sensitive}
        extraActions={
          <>
            {exportBtn('xlsx')}
            {exportBtn('pdf')}
          </>
        }
        columns={[]}
        rows={[]}
        getRowId={() => ''}
        total={0}
        page={0}
        rowsPerPage={25}
        onPageChange={() => undefined}
        onRowsPerPageChange={() => undefined}
        loading={list.loading}
        bodyOverride={
          <Stack spacing={2}>
            {result?.meta.notes.map((n) => (
              <Alert key={n} severity="info">
                {n}
              </Alert>
            ))}
            {result?.searched && !individual && result.summary.length > 0 && <SummaryStrip items={result.summary} />}
            {mainBody}
          </Stack>
        }
      />

      {result?.searched && (
        <Typography variant="caption" color="text.secondary" component="p" className="pret-tnum">
          Generated {formatDateTime(result.meta.generatedAt)} by {result.meta.generatedBy}
          {result.meta.asAt ? ` · as at ${formatDate(result.meta.asAt)}` : ''}
          {result.meta.viewLogged ? ' · this view is logged' : ''}
        </Typography>
      )}
    </Stack>
  );
}

export function SummaryStrip({ items }: { items: ReportResult['summary'] }) {
  return (
    <Card>
      <CardContent>
        <Box component="dl" sx={{ m: 0, display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(auto-fit, minmax(160px, 1fr))' } }}>
          {items.map((s) => (
            <Box key={s.label}>
              <Typography component="dt" color="text.secondary" sx={{ fontSize: '0.84375rem', lineHeight: '19px', fontWeight: 600 }}>
                {s.label}
              </Typography>
              <Typography component="dd" className="pret-tnum" sx={{ m: 0, mt: 0.5, fontSize: '1.25rem', lineHeight: '28px', fontWeight: 700 }}>
                {formatSummary(s.value, s.format)}
              </Typography>
            </Box>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}

/** P7 layout: header (employee no., name, department, position, join date, service — the 'header' table) · totals · Balances · Applications. */
function IndividualBody({ result, compact, phone }: { result: ReportResult; compact: boolean; phone: boolean }) {
  const section = (title: string, node: React.ReactNode) =>
    phone ? (
      <Box>
        <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
          {title}
        </Typography>
        {node}
      </Box>
    ) : (
      <Card>
        <Typography variant="h5" component="h2" sx={{ px: 2, pt: 2, pb: 1 }}>
          {title}
        </Typography>
        {node}
      </Card>
    );
  const header = result.tables.find((t) => t.key === 'header');
  const others = result.tables.filter((t) => t.key !== 'header');
  const h = header?.rows[0];
  return (
    <Stack spacing={2}>
      {header && h && (
        <Card>
          <CardContent>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, minmax(0, 1fr))' } }}>
              {header.columns.map((c) => (
                <KeyValue key={c.key} label={c.label} value={formatCell(h.cells[c.key], c.format)} />
              ))}
            </Box>
          </CardContent>
        </Card>
      )}
      {result.summary.length > 0 && <SummaryStrip items={result.summary} />}
      {section(
        'Balances',
        result.rows.length ? (
          <ReportTable caption="Balances" columns={result.columns} rows={result.rows} compact={compact} phone={phone} />
        ) : (
          <EmptyState title="No leave entitlements for this year." minHeight={120} />
        ),
      )}
      {others.map((t) => (
        <React.Fragment key={t.key}>
          {section(
          t.title,
          t.rows.length ? (
            <ReportTable caption={t.title} columns={t.columns} rows={t.rows} compact={compact} phone={phone} />
          ) : (
            <EmptyState title="No applications in this year." minHeight={120} />
          ),
          )}
        </React.Fragment>
      ))}
    </Stack>
  );
}
