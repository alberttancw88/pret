'use client';

// Canonical list pattern — wireframes.md §0.2, components.md §6, reference-interact-ui.md.
// Filter card → action bar (EXPORT .CSV · ADD NEW … · CLEAR · SEARCH) → table card
// (first column = drill-in link, status chips, money right-aligned, 👁 + ⋮ actions)
// → bulk bar + pagination ("Rows per page" · "1–25 of N").
// Phone (< 600 px): filters collapse to "Filters (n)" bottom sheet, rows become cards.
// Sunrise (theme-tokens.md §9–§10): white filter and table cards (radius 20), lavender-white
// header, 60 px rows (48 compact) with a Comfortable | Compact toggle on desktop.
//
// Data is server-paginated: the page owns rows/total/page/sort and passes callbacks
// (use `useListParams` to keep that state in the URL so Back returns to the same view).
import * as React from 'react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Checkbox from '@mui/material/Checkbox';
import Drawer from '@mui/material/Drawer';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import FilterListIcon from '@mui/icons-material/FilterList';
import LockIcon from '@mui/icons-material/Lock';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import EmptyState from '../EmptyState';
import ErrorState from '../ErrorState';
import { CardListSkeleton, TableSkeleton } from '../Skeletons';
import { CompactFields, DensityToggle, useDensity } from './density';

export type ListColumn<R> = {
  key: string;
  header: string;
  render?: (row: R) => React.ReactNode;
  /** Plain value for CSV export (and default render). */
  value?: (row: R) => string | number | null | undefined;
  kind?: 'text' | 'money' | 'date' | 'status';
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  /** 'low' columns hide first on tablet (600–1023 px). */
  priority?: 'high' | 'low';
  /** Phone card: omit this column. */
  hideOnCard?: boolean;
  minWidth?: number;
};

export type RowAction = { label: string; onClick: () => void; danger?: boolean };
export type SortState = { key: string; direction: 'asc' | 'desc' };

export type ListPageProps<R> = {
  /** e.g. { singular: 'claim', plural: 'claims' } — used in empty states and aria labels. */
  itemName: { singular: string; plural: string };
  /** Filter fields; the first should be the keyword search (see KeywordField). */
  filters?: React.ReactNode[];
  /** Number of populated filters (drives "Filters (n)" and the filtered empty state). */
  activeFilterCount?: number;
  onSearch?: () => void;
  onClear?: () => void;
  onExport?: () => void | Promise<void>;
  /** Sensitive lists: lock icon + "Access is logged" before download. */
  exportSensitive?: boolean;
  addNew?: { label: string; href?: string; onClick?: () => void };
  /** Extra action-bar buttons, placed before ADD NEW. */
  extraActions?: React.ReactNode;

  columns: ListColumn<R>[];
  rows: R[];
  getRowId: (row: R) => string;
  /** Drill-in target for the first column link and the 👁 icon. */
  getRowHref?: (row: R) => string;
  /** Human reference for aria labels ("View CL-2027-00012"); defaults to the first column value. */
  getRowRef?: (row: R) => string;
  rowActions?: (row: R) => RowAction[];

  total: number;
  page: number; // 0-based
  rowsPerPage: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rowsPerPage: number) => void;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;

  /** 'initial' = skeleton rows; 'refresh' = 2 px progress bar, rows stay. */
  loading?: 'initial' | 'refresh' | false;
  error?: { message?: string; reference?: string; onRetry?: () => void } | null;
  /** "Nothing exists yet" state; defaults to "No {plural} yet." */
  empty?: { title?: string; helper?: string; action?: React.ReactNode };

  /** Bulk selection (desktop only, where allowed). */
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  bulkActions?: React.ReactNode;
  /** Replaces the table card + pagination (e.g. a calendar view under the same filters). */
  bodyOverride?: React.ReactNode;
};

const ROWS_PER_PAGE = [10, 25, 50, 100];
const PORTAL_PREFIXES = ['/my', '/team', '/directory', '/notifications', '/home', '/account', '/org-chart'];

function cellValue<R>(col: ListColumn<R>, row: R): React.ReactNode {
  if (col.render) return col.render(row);
  const v = col.value?.(row);
  return v === null || v === undefined || v === '' ? '—' : v;
}

export default function ListPage<R>(props: ListPageProps<R>) {
  const {
    itemName,
    filters = [],
    activeFilterCount = 0,
    onSearch,
    onClear,
    onExport,
    exportSensitive,
    addNew,
    extraActions,
    columns,
    rows,
    getRowId,
    getRowHref,
    getRowRef,
    rowActions,
    total,
    page,
    rowsPerPage,
    onPageChange,
    onRowsPerPageChange,
    sort,
    onSortChange,
    loading = false,
    error,
    empty,
    selectable,
    selected = [],
    onSelectedChange,
    bulkActions,
    bodyOverride,
  } = props;

  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [overflow, setOverflow] = React.useState<HTMLElement | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const [rowMenu, setRowMenu] = React.useState<{ anchor: HTMLElement; actions: RowAction[] } | null>(null);
  const [density, setDensity] = useDensity();
  // Density is an admin-list control (§10); self-service lists stay comfortable.
  const pathname = usePathname() ?? '';
  // Admin screens under a portal prefix (A15/A16 /notifications/log|templates, W2-007) keep the density toggle.
  const adminUnderPortal = pathname.startsWith('/notifications/log') || pathname.startsWith('/notifications/templates');
  const portalList = !adminUnderPortal && PORTAL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const compact = density === 'compact' && !phone && !portalList;

  const refOf = (row: R) => getRowRef?.(row) ?? String(columns[0]?.value?.(row) ?? getRowId(row));
  const bulk = selectable && !phone;
  const pageIds = rows.map(getRowId);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
  const someOnPage = pageIds.some((id) => selected.includes(id));

  const runExport = async () => {
    if (!onExport) return;
    setExporting(true);
    try {
      await onExport();
    } finally {
      setExporting(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSheetOpen(false);
    onSearch?.();
  };

  // ---- Buttons --------------------------------------------------------------
  const exportBtn = onExport && (
    <Tooltip title={exportSensitive ? 'Access is logged' : ''} disableHoverListener={!exportSensitive}>
      <span>
        <Button
          variant="contained"
          color="success"
          startIcon={exportSensitive ? <LockIcon /> : <FileDownloadOutlinedIcon />}
          onClick={runExport}
          loading={exporting}
          loadingPosition="start"
        >
          {exporting ? 'Preparing…' : 'Export .CSV'}
        </Button>
      </span>
    </Tooltip>
  );
  const addBtn =
    addNew &&
    (addNew.href ? (
      <Button variant="contained" startIcon={<AddIcon />} component={NextLink} href={addNew.href}>
        {addNew.label}
      </Button>
    ) : (
      <Button variant="contained" startIcon={<AddIcon />} onClick={addNew.onClick}>
        {addNew.label}
      </Button>
    ));
  const clearBtn = onClear && (
    <Button variant="outlined" color="inherit" onClick={() => onClear()} type="button">
      Clear
    </Button>
  );
  const searchBtn = onSearch && (
    <Button variant="contained" type="submit" disabled={loading === 'refresh'}>
      Search
    </Button>
  );

  // ---- Filter card / sheet ---------------------------------------------------
  const filterGrid = (
    <CompactFields enabled={compact}>
      <Grid container spacing={compact ? 1.5 : 2}>
        {filters.map((f, i) => (
          <Grid key={i} size={{ xs: 12, sm: 6, md: 4 }}>
            {f}
          </Grid>
        ))}
      </Grid>
    </CompactFields>
  );

  // Phone pass (W2-006): the action row shows even when a list has no filters, and the
  // list's extra actions (MARK ALL READ, NEW OVERRIDE, …) are no longer dropped on phones.
  const filterArea = phone ? (
    (filters.length > 0 || onExport || addNew || extraActions) && (
      <>
        <Stack direction="row" spacing={1} alignItems="center">
          {filters.length > 0 && (
            <Badge badgeContent={activeFilterCount} color="primary" invisible={activeFilterCount === 0}>
              <Button variant="outlined" color="inherit" startIcon={<FilterListIcon />} onClick={() => setSheetOpen(true)}>
                Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
              </Button>
            </Badge>
          )}
          <Box sx={{ flex: 1 }} />
          {(onExport || addNew) && (
            <>
              <IconButton aria-label="More actions" onClick={(e) => setOverflow(e.currentTarget)}>
                <MoreVertIcon />
              </IconButton>
              <Menu anchorEl={overflow} open={Boolean(overflow)} onClose={() => setOverflow(null)}>
                {onExport && (
                  <MenuItem
                    onClick={() => {
                      setOverflow(null);
                      void runExport();
                    }}
                  >
                    Export .CSV
                  </MenuItem>
                )}
                {addNew &&
                  (addNew.href ? (
                    <MenuItem component={NextLink} href={addNew.href} onClick={() => setOverflow(null)}>
                      {addNew.label}
                    </MenuItem>
                  ) : (
                    <MenuItem
                      onClick={() => {
                        setOverflow(null);
                        addNew.onClick?.();
                      }}
                    >
                      {addNew.label}
                    </MenuItem>
                  ))}
              </Menu>
            </>
          )}
        </Stack>
        {extraActions && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ '& > *': { flex: '1 1 auto' } }}>
            {extraActions}
          </Stack>
        )}
        <Drawer
          anchor="bottom"
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          slotProps={{ paper: { sx: { borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '90dvh', borderRight: 0, boxShadow: 8 } } }}
        >
          <Box component="form" onSubmit={submit} role="dialog" aria-label="Filters">
            <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1 }} aria-hidden>
              <Box sx={{ width: 32, height: 4, borderRadius: 2, bgcolor: 'grey.300' }} />
            </Box>
            <Typography variant="h4" component="h2" sx={{ px: 2, pt: 1.5, pb: 1 }}>
              Filters
            </Typography>
            <Box sx={{ px: 2, pb: 2, overflowY: 'auto' }}>{filterGrid}</Box>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                position: 'sticky',
                bottom: 0,
                px: 2,
                pt: 1.5,
                pb: 'calc(12px + env(safe-area-inset-bottom))',
                bgcolor: 'background.paper',
                borderTop: '1px solid',
                borderColor: 'divider',
                '& > *': { flex: 1, minHeight: 48 },
              }}
            >
              {clearBtn}
              {searchBtn}
            </Stack>
          </Box>
        </Drawer>
      </>
    )
  ) : (
    <Box component="form" onSubmit={submit} noValidate>
      {filters.length > 0 && (
        <Card sx={{ p: compact ? 2 : { sm: 2, md: 2.5 } }}>
          {filterGrid}
        </Card>
      )}
      <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
        {bodyOverride === undefined && !portalList && (
          <Box sx={{ mr: 'auto' }}>
            <DensityToggle value={density} onChange={setDensity} />
          </Box>
        )}
        {exportBtn}
        {extraActions}
        {addBtn}
        {clearBtn}
        {searchBtn}
      </Stack>
    </Box>
  );

  // ---- Body -------------------------------------------------------------------
  const filteredEmpty = activeFilterCount > 0;
  const emptyNode = filteredEmpty ? (
    <EmptyState
      kind="filtered"
      title={`No ${itemName.plural} match these filters.`}
      actions={
        onClear && (
          <Button variant="outlined" color="inherit" onClick={onClear}>
            Clear
          </Button>
        )
      }
    />
  ) : (
    <EmptyState title={empty?.title ?? `No ${itemName.plural} yet.`} helper={empty?.helper} actions={empty?.action} />
  );

  const openRowMenu = (e: React.MouseEvent<HTMLElement>, row: R) => {
    const actions = rowActions?.(row) ?? [];
    if (actions.length) setRowMenu({ anchor: e.currentTarget, actions });
  };

  const firstCell = (row: R) => {
    const content = cellValue(columns[0], row);
    const href = getRowHref?.(row);
    return href ? (
      <Link component={NextLink} href={href} className="pret-tnum">
        {content}
      </Link>
    ) : (
      content
    );
  };

  const actionCell = (row: R) => {
    const href = getRowHref?.(row);
    const hasMenu = (rowActions?.(row) ?? []).length > 0;
    return (
      <Stack direction="row" spacing={0} justifyContent="flex-end">
        {href && (
          <Tooltip title="View">
            <IconButton component={NextLink} href={href} aria-label={`View ${refOf(row)}`} size="small">
              <VisibilityOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {hasMenu && (
          <IconButton aria-label={`More actions for ${refOf(row)}`} size="small" onClick={(e) => openRowMenu(e, row)}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
        )}
      </Stack>
    );
  };

  const statusCol = columns.find((c) => c.kind === 'status');
  const cardFields = columns.slice(1).filter((c) => c !== statusCol && !c.hideOnCard).slice(0, 4);

  const cards = (
    <Stack spacing={1.5} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }} aria-label={itemName.plural}>
      {rows.map((row) => {
        const href = getRowHref?.(row);
        const hasMenu = (rowActions?.(row) ?? []).length > 0;
        return (
          <Card component="li" variant="portal" key={getRowId(row)} sx={{ position: 'relative', minHeight: 88 }}>
            <Box sx={{ p: 2, pr: hasMenu ? 7 : 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} flexWrap="wrap" useFlexGap>
                {/* References never break mid-number (Plus Jakarta Sans runs wide); chips wrap below. */}
                <Typography variant="subtitle1" component="p" sx={{ minWidth: 0, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {href ? (
                    <Link
                      component={NextLink}
                      href={href}
                      className="pret-tnum"
                      // Whole card is the tap target (stretched link).
                      sx={{ '&::after': { content: '""', position: 'absolute', inset: 0 } }}
                    >
                      {cellValue(columns[0], row)}
                    </Link>
                  ) : (
                    cellValue(columns[0], row)
                  )}
                </Typography>
                {statusCol && <Box sx={{ flexShrink: 0 }}>{cellValue(statusCol, row)}</Box>}
              </Stack>
              <Grid container spacing={1.5} sx={{ mt: 1 }}>
                {cardFields.map((c) => (
                  <Grid key={c.key} size={6} sx={{ textAlign: c.kind === 'money' ? 'right' : 'left' }}>
                    <Typography variant="caption" color="text.secondary" component="p">
                      {c.header}
                    </Typography>
                    <Typography variant="body2" component="div" fontWeight={c.kind === 'money' ? 700 : 400}>
                      {cellValue(c, row)}
                    </Typography>
                  </Grid>
                ))}
              </Grid>
            </Box>
            {hasMenu && (
              <IconButton
                aria-label={`More actions for ${refOf(row)}`}
                onClick={(e) => openRowMenu(e, row)}
                sx={{ position: 'absolute', top: 4, right: 4, width: 44, height: 44, zIndex: 1 }}
              >
                <MoreVertIcon />
              </IconButton>
            )}
          </Card>
        );
      })}
    </Stack>
  );

  const hideLow = { display: { xs: 'table-cell', sm: 'none', md: 'table-cell' } } as const;

  const table = (
    <TableContainer>
      <Table aria-label={itemName.plural} size={compact ? 'small' : 'medium'} sx={{ minWidth: 600 }}>
        <TableHead>
          <TableRow>
            {bulk && (
              <TableCell padding="checkbox">
                <Checkbox
                  indeterminate={someOnPage && !allOnPage}
                  checked={allOnPage}
                  onChange={() =>
                    onSelectedChange?.(
                      allOnPage ? selected.filter((id) => !pageIds.includes(id)) : Array.from(new Set([...selected, ...pageIds])),
                    )
                  }
                  slotProps={{ input: { 'aria-label': `Select all ${itemName.plural} on this page` } }}
                />
              </TableCell>
            )}
            {columns.map((c) => {
              const align = c.align ?? (c.kind === 'money' ? 'right' : 'left');
              const sortable = c.sortable !== false && !!onSortChange;
              const active = sort?.key === c.key;
              return (
                <TableCell
                  key={c.key}
                  align={align}
                  sortDirection={active ? sort?.direction : false}
                  sx={{ minWidth: c.minWidth, ...(c.priority === 'low' ? hideLow : {}) }}
                >
                  {sortable ? (
                    <TableSortLabel
                      active={active}
                      direction={active ? sort?.direction : 'asc'}
                      onClick={() =>
                        onSortChange?.({ key: c.key, direction: active && sort?.direction === 'asc' ? 'desc' : 'asc' })
                      }
                    >
                      {c.header}
                    </TableSortLabel>
                  ) : (
                    c.header
                  )}
                </TableCell>
              );
            })}
            {(getRowHref || rowActions) && (
              <TableCell align="right" sx={{ width: 96 }}>
                Action
              </TableCell>
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const id = getRowId(row);
            const isSel = selected.includes(id);
            return (
              <TableRow key={id} hover selected={isSel} sx={{ height: compact ? 48 : 60 }}>
                {bulk && (
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={isSel}
                      onChange={() => onSelectedChange?.(isSel ? selected.filter((s) => s !== id) : [...selected, id])}
                      slotProps={{ input: { 'aria-label': `Select ${refOf(row)}` } }}
                    />
                  </TableCell>
                )}
                {columns.map((c, i) => {
                  const align = c.align ?? (c.kind === 'money' ? 'right' : 'left');
                  return (
                    <TableCell
                      key={c.key}
                      align={align}
                      className={c.kind === 'money' || c.kind === 'date' ? 'pret-tnum' : undefined}
                      sx={{
                        ...(c.priority === 'low' ? hideLow : {}),
                        ...(c.kind === 'money' || c.kind === 'date' ? { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } : {}),
                      }}
                    >
                      {i === 0 ? firstCell(row) : cellValue(c, row)}
                    </TableCell>
                  );
                })}
                {(getRowHref || rowActions) && <TableCell align="right" sx={{ py: 0.25 }}>{actionCell(row)}</TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );

  let body: React.ReactNode;
  if (error) body = <Box sx={{ p: 2 }}><ErrorState kind="card" message={error.message} reference={error.reference} onRetry={error.onRetry} /></Box>;
  else if (loading === 'initial') body = phone ? <Box sx={{ p: 2 }}><CardListSkeleton /></Box> : <TableSkeleton columns={Math.min(columns.length, 6)} />;
  else if (rows.length === 0) body = emptyNode;
  else body = phone ? cards : table;

  const pagination = (
    <TablePagination
      component="div"
      count={total}
      page={total === 0 ? 0 : page}
      rowsPerPage={rowsPerPage}
      rowsPerPageOptions={ROWS_PER_PAGE}
      onPageChange={(_e, p) => onPageChange(p)}
      onRowsPerPageChange={(e) => onRowsPerPageChange(parseInt(e.target.value, 10))}
      labelRowsPerPage="Rows per page"
      labelDisplayedRows={({ from, to, count }) => `${from}–${to} of ${count}`}
      sx={phone ? { border: 0, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-input': { display: 'none' } } : undefined}
    />
  );

  return (
    <Stack spacing={2}>
      {filterArea}

      {bodyOverride !== undefined ? (
        bodyOverride
      ) : phone ? (
        <Box>
          {loading === 'refresh' && <LinearProgress aria-label="Loading" sx={{ mb: 1 }} />}
          {body}
          {rows.length > 0 && !error && loading !== 'initial' && pagination}
        </Box>
      ) : (
        <Card sx={{ position: 'relative', overflow: 'hidden' }} aria-busy={loading ? 'true' : undefined}>
          {loading === 'refresh' && (
            <LinearProgress aria-label="Loading" sx={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2 }} />
          )}
          {body}
          {bulk && selected.length > 0 && (
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ px: 2, py: 1, bgcolor: 'tone.violet.bg', color: 'tone.violet.fg', borderTop: '1px solid', borderColor: 'divider' }}
            >
              <Typography variant="body2" fontWeight={600} aria-live="polite">
                {selected.length} selected:
              </Typography>
              {bulkActions}
            </Stack>
          )}
          {!error && loading !== 'initial' && pagination}
        </Card>
      )}

      <Menu anchorEl={rowMenu?.anchor} open={Boolean(rowMenu)} onClose={() => setRowMenu(null)}>
        {rowMenu?.actions.map((a) => (
          <MenuItem
            key={a.label}
            onClick={() => {
              setRowMenu(null);
              a.onClick();
            }}
            sx={a.danger ? { color: 'error.main' } : undefined}
          >
            {a.label}
          </MenuItem>
        ))}
      </Menu>
    </Stack>
  );
}
