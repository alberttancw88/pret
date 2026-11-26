'use client';

// Generic report table for the R3 viewer (wireframes-reports.md §R3): renders ReportColumn[] + ReportRow[]
// from the contract — header groups (e.g. leave type over Entitled / CF / …), department group rows,
// subtotal / total rows (bold), "Reversal"-style badges, drill-in link on the first column, sortable
// headers. Phone (< 600 px): one card per row (MGR / EMP reports are used on phones).
import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Typography from '@mui/material/Typography';
import LockIcon from '@mui/icons-material/Lock';
import type { ReportColumn, ReportRow } from '@/server/contracts/reports';
import { columnHeader, formatCell, isNumericFormat } from './format';

export type ReportSort = { key: string; direction: 'asc' | 'desc' };

type Props = {
  caption: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  sort?: ReportSort;
  onSortChange?: (s: ReportSort) => void;
  compact?: boolean;
  phone?: boolean;
};

const MAX_CARD_FIELDS = 8;

function Badge({ label }: { label: string }) {
  return <Chip size="small" label={label} sx={(t) => ({ ml: 1, height: 22, fontWeight: 700, bgcolor: t.palette.tone.warning.bg, color: t.palette.tone.warning.fg })} />;
}

function headerGroups(columns: ReportColumn[]): { label: string | null; span: number }[] | null {
  if (!columns.some((c) => c.group)) return null;
  const out: { label: string | null; span: number }[] = [];
  for (const c of columns) {
    const g = c.group ?? null;
    const last = out[out.length - 1];
    if (last && last.label === g && g !== null) last.span += 1;
    else out.push({ label: g, span: 1 });
  }
  return out;
}

export default function ReportTable({ caption, columns, rows, sort, onSortChange, compact, phone }: Props) {
  const grouped = rows.some((r) => r.group);
  if (phone) return <ReportCards caption={caption} columns={columns} rows={rows} grouped={grouped} />;

  const groups = headerGroups(columns);
  const align = (c: ReportColumn) => (isNumericFormat(c.format) ? 'right' : c.format === 'bool' ? 'center' : 'left');

  const headCell = (c: ReportColumn, rowSpan?: number) => {
    const active = sort?.key === c.key;
    const label = (
      <>
        {columnHeader(c)}
        {c.sensitive && <LockIcon aria-label="Sensitive — access is logged" sx={{ fontSize: 13, ml: 0.5, verticalAlign: '-2px' }} />}
      </>
    );
    return (
      <TableCell key={c.key} align={align(c)} rowSpan={rowSpan} sortDirection={active ? sort?.direction : false} sx={{ whiteSpace: 'nowrap' }}>
        {c.sortable && onSortChange ? (
          <TableSortLabel
            active={active}
            direction={active ? sort?.direction : 'asc'}
            onClick={() => onSortChange({ key: c.key, direction: active && sort?.direction === 'asc' ? 'desc' : 'asc' })}
          >
            {label}
          </TableSortLabel>
        ) : (
          label
        )}
      </TableCell>
    );
  };

  let lastGroup: string | null | undefined;
  const body: React.ReactNode[] = [];
  rows.forEach((r, idx) => {
    if (grouped && (r.kind ?? 'row') === 'row' && r.group && r.group !== lastGroup) {
      lastGroup = r.group;
      body.push(
        <TableRow key={`g-${r.group}-${idx}`}>
          <TableCell colSpan={columns.length} sx={{ bgcolor: 'tone.violet.bg', color: 'tone.violet.fg', fontWeight: 700, py: 1 }}>
            {r.group}
          </TableCell>
        </TableRow>,
      );
    }
    const strong = r.kind === 'subtotal' || r.kind === 'total';
    body.push(
      <TableRow
        key={r.id}
        hover={!strong}
        sx={{
          height: compact ? 44 : 52,
          ...(strong && { '& td': { fontWeight: 700 }, bgcolor: r.kind === 'total' ? 'tone.violet.bg' : 'action.hover' }),
        }}
      >
        {columns.map((c, i) => {
          const text = formatCell(r.cells[c.key], c.format);
          const numeric = isNumericFormat(c.format) || c.format === 'date' || c.format === 'datetime';
          return (
            <TableCell
              key={c.key}
              align={align(c)}
              className={numeric ? 'pret-tnum' : undefined}
              sx={numeric ? { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } : undefined}
            >
              {i === 0 && r.href ? (
                <Link component={NextLink} href={r.href} className="pret-tnum">
                  {text}
                </Link>
              ) : (
                text
              )}
              {i === 0 && r.badge && <Badge label={r.badge} />}
            </TableCell>
          );
        })}
      </TableRow>,
    );
  });

  return (
    <TableContainer>
      <Table aria-label={caption} size={compact ? 'small' : 'medium'} sx={{ minWidth: Math.min(600, columns.length * 110) }}>
        <TableHead>
          {groups ? (
            <>
              <TableRow>
                {(() => {
                  let i = 0;
                  return groups.map((g, gi) => {
                    const cols = columns.slice(i, i + g.span);
                    i += g.span;
                    if (g.label === null) return cols.map((c) => headCell(c, 2));
                    return (
                      <TableCell key={`hg-${gi}`} colSpan={g.span} align="center" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                        {g.label}
                      </TableCell>
                    );
                  });
                })()}
              </TableRow>
              <TableRow>{columns.filter((c) => c.group).map((c) => headCell(c))}</TableRow>
            </>
          ) : (
            <TableRow>{columns.map((c) => headCell(c))}</TableRow>
          )}
        </TableHead>
        <TableBody>{body}</TableBody>
      </Table>
    </TableContainer>
  );
}

function ReportCards({ caption, columns, rows, grouped }: { caption: string; columns: ReportColumn[]; rows: ReportRow[]; grouped: boolean }) {
  const [first, ...rest] = columns;
  let lastGroup: string | null | undefined;
  const items: React.ReactNode[] = [];
  rows.forEach((r, idx) => {
    if (grouped && (r.kind ?? 'row') === 'row' && r.group && r.group !== lastGroup) {
      lastGroup = r.group;
      items.push(
        <Typography key={`g-${idx}`} component="li" variant="overline" color="text.secondary" sx={{ pt: 1 }}>
          {r.group}
        </Typography>,
      );
    }
    const strong = r.kind === 'subtotal' || r.kind === 'total';
    const label = first ? formatCell(r.cells[first.key], first.format) : r.id;
    items.push(
      <Card component="li" variant="portal" key={r.id} sx={{ position: 'relative', ...(strong && { bgcolor: r.kind === 'total' ? 'tone.violet.bg' : 'action.hover' }) }}>
        <Box sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle1" component="p" sx={{ fontWeight: 700 }}>
              {r.href ? (
                <Link component={NextLink} href={r.href} className="pret-tnum" sx={{ '&::after': { content: '""', position: 'absolute', inset: 0 } }}>
                  {label}
                </Link>
              ) : (
                label
              )}
            </Typography>
            {r.badge && <Badge label={r.badge} />}
          </Stack>
          <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
            {rest.slice(0, MAX_CARD_FIELDS).map((c) => (
              <Grid key={c.key} size={6} sx={{ textAlign: isNumericFormat(c.format) ? 'right' : 'left' }}>
                <Typography variant="caption" color="text.secondary" component="p">
                  {c.group ? `${c.group} · ` : ''}
                  {columnHeader(c)}
                </Typography>
                <Typography variant="body2" component="div" className="pret-tnum" fontWeight={strong || c.format === 'money' ? 700 : 500}>
                  {formatCell(r.cells[c.key], c.format)}
                </Typography>
              </Grid>
            ))}
          </Grid>
          {rest.length > MAX_CARD_FIELDS && (
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
              +{rest.length - MAX_CARD_FIELDS} more columns in the export.
            </Typography>
          )}
        </Box>
      </Card>,
    );
  });
  return (
    <Stack spacing={1.5} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }} aria-label={caption}>
      {items}
    </Stack>
  );
}
