'use client';

// P10 · Leave calendar — S-PT-10 · /leave/calendar · F-LV-23 · US-LEAVE-030 (also Admin Leave ▸ Calendar)
// ‹ Month › · [Month | Week] · Filters Department · Work location · Holidays for location (default mine) · Leave type
// (viewers with type visibility) · Include pending (MGR, ADM, SA) · Search employee name · EXPORT .CSV (same masking).
// Visibility (server, §6.14 / Q17): EMP peers "On leave" / "On leave (AM)" approved only; MGR reportees with type
// (Sick/Maternity/Hospitalisation → "Medical"), pending hatched; ADM/SA everyone with type. Tap an entry → MGR/ADM:
// S-AP-02; EMP peers: no detail. Desktop: rows per employee × days. Phone: month grid with dots; tapping a day lists it.
import * as React from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { addDaysIso, type CalendarEntry, type CalendarParams, type LeaveCalendar } from '@/server/contracts/leave';
import { exportLeaveCalendarCsv } from '@/server/actions/leave';
import ListPage from '../list/ListPage';
import { KeywordField, MultiSelectFilter, SelectFilter, YesNoFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import { useToast } from '../ToastProvider';
import { formatDate } from '@/lib/format';
import { CALENDAR_FILTERS } from './filters';
import type { LeaveFilterOptions } from '@/app/_lib/leave-options';
import { leaveType, surface } from '@/theme/palette';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dow = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

function entryBg(e: CalendarEntry) {
  const c = e.colour ?? leaveType[0];
  if (e.status !== 'approved') return `repeating-linear-gradient(45deg, ${c}55 0 4px, #fff 4px 8px)`;
  if (e.session === 'am') return `linear-gradient(90deg, ${c} 50%, transparent 50%)`;
  if (e.session === 'pm') return `linear-gradient(90deg, transparent 50%, ${c} 50%)`;
  return c;
}

export default function LeaveCalendarView({
  cal,
  params,
  options,
  anchor,
  view,
  canSeePending,
}: {
  cal: LeaveCalendar;
  params: CalendarParams;
  options: LeaveFilterOptions;
  anchor: string;
  view: 'month' | 'week';
  canSeePending: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '/leave/calendar';
  const sp = useSearchParams();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const toast = useToast();
  const list = useServerList({ filters: CALENDAR_FILTERS });
  const d = list.draft;
  const set = list.setDraftField;
  const [selectedDay, setSelectedDay] = React.useState<string | null>(null);

  const go = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp?.toString() ?? '');
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const shift = (dir: -1 | 1) => {
    if (view === 'week') go({ month: addDaysIso(anchor, 7 * dir) });
    else {
      const [y, m] = anchor.split('-').map(Number) as [number, number];
      const t = new Date(Date.UTC(y, m - 1 + dir, 1));
      go({ month: t.toISOString().slice(0, 10) });
    }
  };
  const [ay, am] = anchor.split('-').map(Number) as [number, number];
  const title = view === 'week' ? `${formatDate(cal.from)} – ${formatDate(cal.to)}` : `${MONTHS[am - 1]} ${ay}`;
  const dates = days(cal.from, cal.to);
  const holidays = new Map(cal.holidays.map((h) => [h.date, h]));
  const byEmpDate = new Map<string, CalendarEntry[]>();
  for (const e of cal.entries) {
    const k = `${e.employeeId}|${e.date}`;
    byEmpDate.set(k, [...(byEmpDate.get(k) ?? []), e]);
  }
  const entriesOn = (date: string) => cal.entries.filter((e) => e.date === date);
  const empName = new Map(cal.employees.map((e) => [e.employeeId, e.name]));
  const entryHref = (e: CalendarEntry) => (e.refNo ? `/approvals/leave/${encodeURIComponent(e.refNo)}` : null);

  const header = (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
      <IconButton aria-label={view === 'week' ? 'Previous week' : 'Previous month'} onClick={() => shift(-1)}>
        <ChevronLeftIcon />
      </IconButton>
      <Typography variant="h5" component="h2" sx={{ minWidth: 180, textAlign: 'center' }}>
        {title}
      </Typography>
      <IconButton aria-label={view === 'week' ? 'Next week' : 'Next month'} onClick={() => shift(1)}>
        <ChevronRightIcon />
      </IconButton>
      <ToggleButtonGroup size="small" exclusive value={view} onChange={(_e, v) => v && go({ view: v === 'month' ? '' : v })} aria-label="Calendar view">
        <ToggleButton value="month">Month</ToggleButton>
        <ToggleButton value="week">Week</ToggleButton>
      </ToggleButtonGroup>
      <Button size="small" onClick={() => go({ month: '' })}>
        Today
      </Button>
      <Box sx={{ flex: 1 }} />
      {cal.holidayLocation && (
        <Typography variant="caption" color="text.secondary">
          ◆ Public holidays for {cal.holidayLocation.label}
        </Typography>
      )}
    </Stack>
  );

  const legend = cal.showTypes && cal.legend.length > 0 && (
    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }} aria-label="Legend">
      {cal.legend.map((l) => (
        <Stack key={l.id} direction="row" spacing={0.5} alignItems="center">
          <Box aria-hidden sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: l.colour }} />
          <Typography variant="caption">{l.label}</Typography>
        </Stack>
      ))}
      {canSeePending && (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Box aria-hidden sx={{ width: 12, height: 12, borderRadius: '3px', background: `repeating-linear-gradient(45deg, ${leaveType[0]}55 0 3px, #fff 3px 6px)`, border: `1px solid ${surface.handle}` }} />
          <Typography variant="caption">Pending</Typography>
        </Stack>
      )}
      <Typography variant="caption">◆ Public holiday</Typography>
    </Stack>
  );

  const grid = (
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={{ borderCollapse: 'collapse', minWidth: '100%', fontSize: 12 }} aria-label="Leave calendar">
        <thead>
          <tr>
            <Box component="th" sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1, textAlign: 'left', p: 1, minWidth: 160 }}>
              Employee
            </Box>
            {dates.map((dt) => {
              const h = holidays.get(dt);
              const we = dow(dt) >= 5;
              return (
                <Tooltip key={dt} title={h ? `${h.name}${h.half ? ' (half day)' : ''} · ${h.state}` : ''}>
                  <Box component="th" sx={{ p: 0.5, minWidth: view === 'week' ? 80 : 30, textAlign: 'center', bgcolor: h ? 'tile.peach.bg' : we ? 'grey.50' : undefined, fontWeight: 500 }}>
                    <div>{WD[dow(dt)]!.slice(0, view === 'week' ? 3 : 2)}</div>
                    <div className="pret-tnum">
                      {Number(dt.slice(8))}
                      {h ? ' ◆' : ''}
                    </div>
                  </Box>
                </Tooltip>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {cal.employees.length === 0 && (
            <tr>
              <Box component="td" colSpan={dates.length + 1} sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
                No one is on leave in this period.
              </Box>
            </tr>
          )}
          {cal.employees.map((emp) => (
            <tr key={emp.employeeId}>
              <Box component="td" sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1, p: 1, borderTop: '1px solid', borderColor: 'divider', whiteSpace: 'nowrap' }}>
                {emp.name}
                {emp.isSelf ? ' (you)' : ''}
                <Typography variant="caption" color="text.secondary" component="div">
                  {emp.department}
                </Typography>
              </Box>
              {dates.map((dt) => {
                const es = byEmpDate.get(`${emp.employeeId}|${dt}`) ?? [];
                const h = holidays.get(dt);
                return (
                  <Box component="td" key={dt} sx={{ p: 0.25, borderTop: '1px solid', borderColor: 'divider', bgcolor: h ? 'tile.peach.bg' : dow(dt) >= 5 ? 'grey.50' : undefined, textAlign: 'center' }}>
                    {es.map((e) => {
                      const href = entryHref(e);
                      const label = `${emp.name} · ${formatDate(e.date)} · ${e.label}${e.status !== 'approved' ? ' (pending)' : ''}`;
                      const box = <Box sx={{ height: 20, borderRadius: '3px', background: entryBg(e), border: e.colour ? undefined : `1px solid ${leaveType[0]}` }} />;
                      return (
                        <Tooltip key={`${e.session}-${e.refNo ?? ''}`} title={label}>
                          {href ? (
                            <ButtonBase component={NextLink} href={href} aria-label={label} sx={{ display: 'block', width: '100%' }}>
                              {box}
                            </ButtonBase>
                          ) : (
                            <Box aria-label={label} role="img">
                              {box}
                            </Box>
                          )}
                        </Tooltip>
                      );
                    })}
                  </Box>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Box>
      {cal.holidays.length > 0 && (
        <Stack spacing={0.25} sx={{ mt: 1 }}>
          {cal.holidays.map((h) => (
            <Typography key={h.date + h.name} variant="caption">
              ◆ {formatDate(h.date)} {h.name} ({h.state}){h.half ? ' · half day' : ''}
            </Typography>
          ))}
        </Stack>
      )}
    </Box>
  );

  // Phone: month grid with dots; tap a day → list
  const lead = dow(cal.from);
  const cells: (string | null)[] = [...Array(lead).fill(null), ...dates];
  const phoneGrid = (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
        {WD.map((w) => (
          <Typography key={w} variant="caption" align="center" color="text.secondary">
            {w.slice(0, 2)}
          </Typography>
        ))}
        {cells.map((dt, i) => {
          if (!dt) return <Box key={`x${i}`} />;
          const es = entriesOn(dt);
          const h = holidays.get(dt);
          const sel = selectedDay === dt;
          return (
            <ButtonBase
              key={dt}
              onClick={() => setSelectedDay(dt)}
              aria-label={`${formatDate(dt)}: ${es.length} on leave${h ? `, ${h.name}` : ''}`}
              sx={{ minHeight: 48, flexDirection: 'column', borderRadius: '10px', border: '1px solid', borderColor: sel ? 'primary.main' : 'divider', bgcolor: h ? 'tile.peach.bg' : dow(dt) >= 5 ? 'grey.50' : 'background.paper' }}
            >
              <Typography variant="body2" className="pret-tnum">
                {Number(dt.slice(8))}
                {h ? '◆' : ''}
              </Typography>
              <Stack direction="row" spacing={0.25}>
                {es.slice(0, 3).map((e, j) => (
                  <Box key={j} sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: e.colour ?? 'primary.main', opacity: e.status === 'approved' ? 1 : 0.5 }} />
                ))}
              </Stack>
            </ButtonBase>
          );
        })}
      </Box>
      {selectedDay && (
        <Card variant="outlined" sx={{ mt: 2 }}>
          <CardContent>
            <Typography variant="subtitle1">{formatDate(selectedDay)}</Typography>
            {holidays.get(selectedDay) && <Typography variant="body2">◆ {holidays.get(selectedDay)!.name}</Typography>}
            {entriesOn(selectedDay).length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No one is on leave.
              </Typography>
            ) : (
              entriesOn(selectedDay).map((e) => {
                const href = entryHref(e);
                const text = `${empName.get(e.employeeId) ?? ''} — ${e.label}${e.status !== 'approved' ? ' (pending)' : ''}`;
                return (
                  <Typography key={`${e.employeeId}-${e.session}`} variant="body2" sx={{ minHeight: 32, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box component="span" sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: e.colour ?? 'primary.main', display: 'inline-block' }} />
                    {href ? (
                      <Link component={NextLink} href={href}>
                        {text}
                      </Link>
                    ) : (
                      text
                    )}
                  </Typography>
                );
              })
            )}
          </CardContent>
        </Card>
      )}
    </Box>
  );

  const filters: React.ReactNode[] = [
    <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} label="Search employee" />,
    <MultiSelectFilter key="dp" label="Department" value={d.departmentIds} onChange={(v) => set('departmentIds', v)} options={options.departments.map((x) => ({ value: x.id, label: x.label }))} />,
    <MultiSelectFilter key="lc" label="Work location" value={d.locationIds} onChange={(v) => set('locationIds', v)} options={options.locations.map((x) => ({ value: x.id, label: x.label }))} />,
    <SelectFilter key="hl" label="Holidays for location" value={d.holidayLocationId} onChange={(v) => set('holidayLocationId', v)} options={options.locations.map((x) => ({ value: x.id, label: x.label }))} />,
  ];
  if (cal.showTypes) filters.push(<MultiSelectFilter key="t" label="Leave type" value={d.leaveTypeIds} onChange={(v) => set('leaveTypeIds', v)} options={options.types.map((t) => ({ value: t.id, label: t.name }))} />);
  if (canSeePending) filters.push(<YesNoFilter key="p" label="Include pending" value={d.includePending} onChange={(v) => set('includePending', v)} />);

  return (
    <ListPage<{ id: string }>
      itemName={{ singular: 'entry', plural: 'calendar entries' }}
      filters={filters}
      {...list.listProps}
      onExport={async () => {
        try {
          const res = await exportLeaveCalendarCsv(params);
          if (res.ok) downloadServerCsv(res.filename || 'leave-calendar', res.content);
          else toast.info(res.error);
        } catch {
          toast.info('Export failed. Please try again.');
        }
      }}
      columns={[{ key: 'id', header: 'Entry', value: (r) => r.id }]}
      rows={[]}
      total={0}
      getRowId={(r) => r.id}
      bodyOverride={
        <Card>
          <CardContent sx={{ p: { xs: 1.5, sm: 2 } }}>
            {header}
            {legend}
            {cal.scope === 'peer' && (
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
                Colleagues show as “On leave” only (approved leave; leave type not shown).
              </Typography>
            )}
            {phone && view === 'month' ? phoneGrid : grid}
          </CardContent>
        </Card>
      }
    />
  );
}
