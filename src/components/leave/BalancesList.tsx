'use client';

// L3 · Leave balances — S-LV-03 · /leave/balances (ADM, SA) · /team/balances (MGR) · F-LV-21 · US-LEAVE-028
// Search employee no. / name · Filters As at date * (default today) · Department · Work location · Leave type (default
// AL, SL, RL) · Employment status (default Active; Separated per LP14) · grouped by department (collapsible header with
// headcount) · Columns Employee › · Months of service · per type Entitled · Taken · Pending · Available (1 dp) ·
// Row → P6 ledger (ADM/SA; managers never see the ledger — F-LV-28, their row opens the team member) · EXPORT .CSV.
import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { BalanceList, BalanceListParams, BalanceListRow } from '@/server/contracts/leave';
import { exportBalancesCsv } from '@/server/actions/leave';
import ListPage from '../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import EmptyState from '../EmptyState';
import { useToast } from '../ToastProvider';
import { formatDate } from '@/lib/format';
import { DaysCell } from './common';
import { BALANCE_FILTERS } from './filters';
import type { LeaveFilterOptions } from '@/app/_lib/leave-options';

export default function BalancesList({ data, params, options, scope }: { data: BalanceList; params: BalanceListParams; options: LeaveFilterOptions; scope: 'all' | 'team' }) {
  const list = useServerList({ filters: BALANCE_FILTERS, sort: { key: 'department', direction: 'asc' } });
  const toast = useToast();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const [collapsed, setCollapsed] = React.useState<string[]>([]);
  const d = list.draft;
  const set = list.setDraftField;
  const admin = scope === 'all';
  const rowHref = (r: BalanceListRow, typeId?: string) =>
    admin
      ? typeId
        ? `/leave/ledger?employee=${encodeURIComponent(r.employee.id)}&type=${encodeURIComponent(typeId)}&year=${data.year}`
        : `/employees/${encodeURIComponent(r.employee.employeeNo ?? '')}?tab=leave`
      : `/team/${encodeURIComponent(r.employee.employeeNo ?? '')}?tab=leave`;

  const groups = data.groups.length ? data.groups : [{ department: { id: '', label: '' }, headcount: data.rows.length }];
  const rowsOf = (depId: string) => (data.groups.length ? data.rows.filter((r) => r.department.id === depId) : data.rows);

  const table = (
    <TableContainer>
      <Table size="small" aria-label="Leave balances" sx={{ minWidth: 600 }}>
        <TableHead>
          <TableRow>
            <TableCell rowSpan={2}>Employee</TableCell>
            <TableCell rowSpan={2} align="right">
              Months of service
            </TableCell>
            {data.types.map((t) => (
              <TableCell key={t.id} colSpan={4} align="center" sx={{ borderLeft: '1px solid', borderColor: 'divider' }}>
                <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="center">
                  <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: t.colour }} />
                  <span>{t.name}</span>
                </Stack>
              </TableCell>
            ))}
          </TableRow>
          <TableRow>
            {data.types.flatMap((t) =>
              ['Entitled', 'Taken', 'Pending', 'Available'].map((h, i) => (
                <TableCell key={`${t.id}-${h}`} align="right" sx={i === 0 ? { borderLeft: '1px solid', borderColor: 'divider' } : undefined}>
                  {h}
                </TableCell>
              )),
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map((g) => {
            const open = !collapsed.includes(g.department.id);
            const rows = rowsOf(g.department.id);
            return (
              <React.Fragment key={g.department.id || 'all'}>
                {data.groups.length > 0 && (
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell colSpan={2 + data.types.length * 4}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <IconButton
                          size="small"
                          aria-label={open ? `Collapse ${g.department.label}` : `Expand ${g.department.label}`}
                          aria-expanded={open}
                          onClick={() => setCollapsed((c) => (open ? [...c, g.department.id] : c.filter((x) => x !== g.department.id)))}
                        >
                          {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                        </IconButton>
                        <Typography variant="subtitle2">
                          {g.department.label} · {g.headcount} {g.headcount === 1 ? 'employee' : 'employees'}
                        </Typography>
                      </Stack>
                    </TableCell>
                  </TableRow>
                )}
                {open &&
                  rows.map((r) => (
                    <TableRow key={r.employee.id} hover>
                      <TableCell>
                        <Link component={NextLink} href={rowHref(r)}>
                          {r.employee.name}
                          {r.employee.employeeNo ? ` (${r.employee.employeeNo})` : ''}
                        </Link>
                      </TableCell>
                      <TableCell align="right" className="pret-tnum">
                        {r.monthsOfService}
                      </TableCell>
                      {data.types.flatMap((t) => {
                        const c = r.cells[t.id];
                        const cell = (v: string | undefined, i: number, k: string) => (
                          <TableCell key={`${t.id}-${k}`} align="right" sx={i === 0 ? { borderLeft: '1px solid', borderColor: 'divider' } : undefined}>
                            {k === 'available' && c && admin ? (
                              <Link component={NextLink} href={rowHref(r, t.id)} aria-label={`${t.name} ledger for ${r.employee.name}`}>
                                <DaysCell value={v} />
                              </Link>
                            ) : (
                              <DaysCell value={v} />
                            )}
                          </TableCell>
                        );
                        return [cell(c?.entitled, 0, 'entitled'), cell(c?.taken, 1, 'taken'), cell(c?.pending, 2, 'pending'), cell(c?.available, 3, 'available')];
                      })}
                    </TableRow>
                  ))}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );

  const cards = (
    <Stack spacing={1.5}>
      {groups.map((g) => (
        <Box key={g.department.id || 'all'}>
          {data.groups.length > 0 && (
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {g.department.label} · {g.headcount}
            </Typography>
          )}
          <Stack spacing={1}>
            {rowsOf(g.department.id).map((r) => (
              <Card key={r.employee.id} sx={{ p: 2 }}>
                <Link component={NextLink} href={rowHref(r)} variant="subtitle1">
                  {r.employee.name}
                </Link>
                <Typography variant="caption" color="text.secondary" component="p">
                  {r.employee.employeeNo} · {r.monthsOfService} months of service
                </Typography>
                {data.types.map((t) => {
                  const c = r.cells[t.id];
                  return (
                    <Stack key={t.id} direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
                      <Typography variant="body2">{t.name}</Typography>
                      <Typography variant="body2" className="pret-tnum">
                        {c ? (
                          <>
                            <DaysCell value={c.available} /> avail · {c.taken} taken · {c.pending} pending
                          </>
                        ) : (
                          '—'
                        )}
                      </Typography>
                    </Stack>
                  );
                })}
              </Card>
            ))}
          </Stack>
        </Box>
      ))}
    </Stack>
  );

  const body =
    data.rows.length === 0 ? (
      <Card>
        <EmptyState kind={list.activeFilterCount ? 'filtered' : 'none'} title={list.activeFilterCount ? 'No employees match these filters.' : 'No balances to show yet.'} />
      </Card>
    ) : (
      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Balances as at {formatDate(data.asAt)} · leave year {data.year}
        </Typography>
        {phone ? cards : <Card>{table}</Card>}
        <TablePagination
          component="div"
          count={data.total}
          page={data.total === 0 ? 0 : list.applied.page}
          rowsPerPage={list.applied.rowsPerPage}
          rowsPerPageOptions={[10, 25, 50, 100]}
          onPageChange={(_e, p) => list.setPage(p)}
          onRowsPerPageChange={(e) => list.setRowsPerPage(parseInt(e.target.value, 10))}
          labelRowsPerPage="Rows per page"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} of ${count}`}
        />
      </Box>
    );

  return (
    <ListPage<BalanceListRow>
      itemName={{ singular: 'employee', plural: 'employees' }}
      filters={[
        <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Employee no. or name." />,
        <DateFilter key="as" label="As at date *" value={d.asAt} onChange={(v) => set('asAt', v)} />,
        <MultiSelectFilter key="dp" label="Department" value={d.departmentIds} onChange={(v) => set('departmentIds', v)} options={options.departments.map((x) => ({ value: x.id, label: x.label }))} />,
        <MultiSelectFilter key="lc" label="Work location" value={d.locationIds} onChange={(v) => set('locationIds', v)} options={options.locations.map((x) => ({ value: x.id, label: x.label }))} />,
        <MultiSelectFilter key="t" label="Leave type (default AL, SL, RL)" value={d.leaveTypeIds} onChange={(v) => set('leaveTypeIds', v)} options={options.types.map((t) => ({ value: t.id, label: t.name }))} />,
        <SelectFilter
          key="st"
          label="Employment status"
          value={d.employmentStatus}
          onChange={(v) => set('employmentStatus', v || 'active')}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'separated', label: 'Separated' },
            { value: 'all', label: 'All' },
          ]}
        />,
      ]}
      {...list.listProps}
      onExport={async () => {
        try {
          const res = await exportBalancesCsv(params);
          if (res.ok) downloadServerCsv(res.filename || 'leave-balances', res.content);
          else toast.info(res.error);
        } catch {
          toast.info('Export failed. Please try again.');
        }
      }}
      columns={[{ key: 'employee', header: 'Employee', value: (r) => r.employee.name }]}
      rows={data.rows}
      total={data.total}
      getRowId={(r) => r.employee.id}
      bodyOverride={body}
    />
  );
}
