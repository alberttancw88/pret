'use client';

// O7 calendar view — month grids for the selected year and state, holidays as labelled
// dots; click → edit (wireframe O7). Every coloured mark pairs with a text list under the
// month (accessibility: never colour-only).
import * as React from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { formatDate } from '@/lib/format';

export type CalendarHoliday = {
  id: string;
  date: string; // yyyy-mm-dd
  name: string;
  replacement?: boolean;
  observed?: boolean;
  halfDay?: boolean;
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthCells(year: number, month: number): (number | null)[] {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay(); // 0 Sun
  const lead = (first + 6) % 7; // Monday-first
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}

const pad = (n: number) => String(n).padStart(2, '0');

export default function HolidayCalendarView({
  year,
  holidays,
  onSelect,
}: {
  year: number;
  holidays: CalendarHoliday[];
  onSelect?: (id: string) => void;
}) {
  const byDate = React.useMemo(() => {
    const m = new Map<string, CalendarHoliday[]>();
    for (const h of holidays) m.set(h.date, [...(m.get(h.date) ?? []), h]);
    return m;
  }, [holidays]);

  return (
    <Grid container spacing={2}>
      {MONTHS.map((name, mi) => {
        const inMonth = holidays.filter((h) => h.date.startsWith(`${year}-${pad(mi + 1)}-`)).sort((a, b) => a.date.localeCompare(b.date));
        return (
          <Grid key={name} size={{ xs: 12, sm: 6, lg: 4 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
                  {name} {year}
                </Typography>
                <Box
                  role="grid"
                  aria-label={`${name} ${year}`}
                  sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, textAlign: 'center' }}
                >
                  {DOW.map((d) => (
                    <Typography key={d} variant="caption" color="text.secondary" role="columnheader">
                      {d}
                    </Typography>
                  ))}
                  {monthCells(year, mi).map((d, i) => {
                    if (d === null) return <Box key={`e${i}`} />;
                    const iso = `${year}-${pad(mi + 1)}-${pad(d)}`;
                    const hs = byDate.get(iso);
                    const weekend = i % 7 >= 5;
                    if (!hs) {
                      return (
                        <Typography
                          key={iso}
                          variant="body2"
                          role="gridcell"
                          className="pret-tnum"
                          sx={{ py: 0.5, color: weekend ? 'text.secondary' : 'text.primary' }}
                        >
                          {d}
                        </Typography>
                      );
                    }
                    const replacement = hs.every((h) => h.replacement);
                    return (
                      <ButtonBase
                        key={iso}
                        role="gridcell"
                        onClick={() => !replacement && onSelect?.(hs[0].id)}
                        aria-label={`${formatDate(iso)}: ${hs.map((h) => h.name).join(', ')}`}
                        sx={{
                          py: 0.5,
                          borderRadius: 1,
                          fontWeight: 700,
                          fontSize: '0.875rem',
                          bgcolor: replacement ? 'tone.violet.bg' : 'tone.warning.bg',
                          color: replacement ? 'tone.violet.fg' : 'warning.dark',
                          border: '1px solid',
                          borderColor: replacement ? 'grey.300' : 'warning.light',
                        }}
                        className="pret-tnum"
                      >
                        {d}
                      </ButtonBase>
                    );
                  })}
                </Box>
                <Stack component="ul" spacing={0.5} sx={{ listStyle: 'none', p: 0, m: 0, mt: 1.5 }}>
                  {inMonth.length === 0 && (
                    <Typography component="li" variant="body2" color="text.secondary">
                      No holidays.
                    </Typography>
                  )}
                  {inMonth.map((h) => (
                    <Typography key={h.id + h.date} component="li" variant="body2">
                      <span className="pret-tnum">{formatDate(h.date)}</span> ·{' '}
                      {h.replacement || !onSelect ? (
                        h.name
                      ) : (
                        <Link component="button" type="button" onClick={() => onSelect(h.id)} sx={{ verticalAlign: 'baseline' }}>
                          {h.name}
                        </Link>
                      )}
                      {h.halfDay ? ' (half day)' : ''}
                      {h.observed === false ? ' (not observed)' : ''}
                    </Typography>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
}
