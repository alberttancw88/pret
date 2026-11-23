'use client';

// Shared building blocks for the employee-record screens (E3 profile, P16 my profile,
// P32 team member): URL-driven tabs (scrollable on desktop, chip row on phone),
// section cards with EDIT → inline edit mode (S-EM-04), read-only key-value grids and
// small in-card tables that become cards on phone.
import * as React from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import LockIcon from '@mui/icons-material/Lock';
import HourglassEmptyOutlinedIcon from '@mui/icons-material/HourglassEmptyOutlined';
import ErrorSummary from '../forms/ErrorSummary';
import RecordFooter, { type RecordMeta } from '../forms/RecordFooter';
import { KeyValue } from '../forms/fields';

// ---------------------------------------------------------------------------
// Tabs (?tab= in the URL so Back and deep links keep the tab)
// ---------------------------------------------------------------------------
export type TabDef = { value: string; label: string; count?: number | null; hint?: string };

export function useTabParam(tabs: TabDef[], fallback?: string): [string, (v: string) => void] {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = sp?.get('tab') ?? '';
  const current = tabs.some((t) => t.value === raw) ? raw : fallback ?? tabs[0]?.value ?? '';
  const set = React.useCallback(
    (v: string) => {
      const next = new URLSearchParams(sp?.toString() ?? '');
      next.set('tab', v);
      // list state of the previous tab does not apply to the next one
      for (const k of ['page', 'rpp', 'sort', 'dir']) next.delete(k);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [sp, router, pathname],
  );
  return [current, set];
}

export function ProfileTabs({ tabs, value, onChange, label = 'Profile sections' }: { tabs: TabDef[]; value: string; onChange: (v: string) => void; label?: string }) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  if (phone) {
    return (
      <Box role="tablist" aria-label={label} sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 1, mb: 1, '&::-webkit-scrollbar': { display: 'none' } }}>
        {tabs.map((t) => (
          <Chip
            key={t.value}
            role="tab"
            aria-selected={t.value === value}
            label={t.count !== undefined && t.count !== null ? `${t.label} (${t.count})` : t.label}
            onClick={() => onChange(t.value)}
            color={t.value === value ? 'primary' : 'default'}
            variant={t.value === value ? 'filled' : 'outlined'}
            sx={{ height: 44, flexShrink: 0 }}
          />
        ))}
      </Box>
    );
  }
  return (
    <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2, bgcolor: 'background.paper', borderRadius: 1 }}>
      <Tabs value={value} onChange={(_e, v: string) => onChange(v)} variant="scrollable" allowScrollButtonsMobile aria-label={label}>
        {tabs.map((t) => (
          <Tab
            key={t.value}
            value={t.value}
            title={t.hint}
            label={
              t.count !== undefined && t.count !== null ? (
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <span>{t.label}</span>
                  <Box component="span" sx={{ px: 0.75, borderRadius: 8, fontSize: 12, bgcolor: t.value === value ? '#EDEDFE' : '#ECEEF3', color: t.value === value ? '#3A3FBF' : '#374151' }}>
                    {t.count}
                  </Box>
                </Stack>
              ) : (
                t.label
              )
            }
          />
        ))}
      </Tabs>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Section card with EDIT → inline edit mode (S-EM-04)
// ---------------------------------------------------------------------------
export type SectionCardProps = {
  title: string;
  subtitle?: React.ReactNode;
  /** Show EDIT (the card turns into a form). */
  canEdit?: boolean;
  /** Shown with a lock instead of EDIT ("Use a change request for your own record."). */
  lockedReason?: string | null;
  editing?: boolean;
  onEdit?: () => void;
  onCancel?: () => void;
  onSave?: () => unknown;
  saving?: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string>;
  fieldLabels?: Record<string, string>;
  meta?: RecordMeta | null;
  /** Buttons in the card header (e.g. ADD JOB CHANGE, REQUEST CHANGE). */
  headerActions?: React.ReactNode;
  editLabel?: string;
  saveLabel?: string;
  children: React.ReactNode;
};

export function SectionCard({
  title,
  subtitle,
  canEdit,
  lockedReason,
  editing,
  onEdit,
  onCancel,
  onSave,
  saving,
  error,
  fieldErrors,
  fieldLabels,
  meta,
  headerActions,
  editLabel = 'Edit',
  saveLabel = 'Save',
  children,
}: SectionCardProps) {
  const headingId = React.useId();
  return (
    <Card component="section" aria-labelledby={headingId}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: subtitle ? 0.5 : 2 }}>
          <Typography id={headingId} variant="h5" component="h2" sx={{ flexGrow: 1 }}>
            {title}
          </Typography>
          {headerActions}
          {!editing && canEdit && onEdit && (
            <Button size="small" variant="outlined" startIcon={<EditOutlinedIcon />} onClick={onEdit}>
              {editLabel}
            </Button>
          )}
          {!editing && !canEdit && lockedReason && (
            <Tooltip title={lockedReason}>
              <Chip size="small" icon={<LockIcon />} label="Locked" variant="outlined" aria-label={lockedReason} />
            </Tooltip>
          )}
        </Stack>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {subtitle}
          </Typography>
        )}
        {editing ? (
          <Box
            component="form"
            noValidate
            onSubmit={(e: React.FormEvent) => {
              e.preventDefault();
              if (!saving) void onSave?.();
            }}
          >
            <ErrorSummary error={error} fieldErrors={fieldErrors} labels={fieldLabels} />
            <fieldset disabled={saving} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
              {children}
            </fieldset>
            <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
              <Button variant="outlined" color="inherit" onClick={onCancel} disabled={saving}>
                Cancel
              </Button>
              <Button variant="contained" type="submit" loading={saving}>
                {saving ? 'Saving…' : saveLabel}
              </Button>
            </Stack>
          </Box>
        ) : (
          children
        )}
        <RecordFooter meta={meta} />
      </CardContent>
    </Card>
  );
}

/** Plain card with a heading (read-only sections). */
export function InfoCard({ title, actions, children, subtitle }: { title: string; actions?: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <SectionCard title={title} headerActions={actions} subtitle={subtitle}>
      {children}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Read-only key-value grid
// ---------------------------------------------------------------------------
export type KV = { label: string; value: React.ReactNode; full?: boolean; hidden?: boolean };

export function KVGrid({ items, columns = 3 }: { items: KV[]; columns?: 2 | 3 | 4 }) {
  const md = 12 / columns;
  return (
    <Grid container spacing={2}>
      {items
        .filter((i) => !i.hidden)
        .map((i) => (
          <Grid key={i.label} size={{ xs: 12, sm: i.full ? 12 : 6, md: i.full ? 12 : md }}>
            <KeyValue label={i.label} value={i.value} />
          </Grid>
        ))}
    </Grid>
  );
}

// ---------------------------------------------------------------------------
// Small table inside a card (desktop) / cards (phone)
// ---------------------------------------------------------------------------
export type MiniColumn<R> = { key: string; header: string; render: (r: R) => React.ReactNode; align?: 'left' | 'right' | 'center'; minWidth?: number };

export function MiniTable<R>({
  columns,
  rows,
  getRowId,
  empty = 'Nothing recorded.',
  rowActions,
  caption,
}: {
  columns: MiniColumn<R>[];
  rows: R[];
  getRowId: (r: R) => string;
  empty?: React.ReactNode;
  rowActions?: (r: R) => React.ReactNode;
  caption?: string;
}) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
        {empty}
      </Typography>
    );
  }
  if (phone) {
    return (
      <Stack spacing={1}>
        {rows.map((r) => (
          <Box key={getRowId(r)} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
            <Stack spacing={0.75}>
              {columns.map((c, i) => (
                <Box key={c.key} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    {c.header}
                  </Typography>
                  <Typography variant={i === 0 ? 'subtitle2' : 'body2'} component="div" sx={{ textAlign: 'right' }}>
                    {c.render(r) ?? '—'}
                  </Typography>
                </Box>
              ))}
              {rowActions && <Box sx={{ textAlign: 'right' }}>{rowActions(r)}</Box>}
            </Stack>
          </Box>
        ))}
      </Stack>
    );
  }
  return (
    <TableContainer>
      <Table size="small" aria-label={caption}>
        <TableHead>
          <TableRow>
            {columns.map((c) => (
              <TableCell key={c.key} align={c.align} sx={{ minWidth: c.minWidth, whiteSpace: 'nowrap' }}>
                {c.header}
              </TableCell>
            ))}
            {rowActions && <TableCell align="right">Action</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={getRowId(r)} hover>
              {columns.map((c) => (
                <TableCell key={c.key} align={c.align}>
                  {c.render(r) ?? '—'}
                </TableCell>
              ))}
              {rowActions && (
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  {rowActions(r)}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** "Available after W2-00x" placeholder inside a tab (brief §3). */
export function TabPlaceholder({ title, body, links }: { title: string; body: string; links?: { label: string; href: string }[] }) {
  return (
    <Card>
      <CardContent>
        <Stack spacing={1.5} alignItems="center" sx={{ textAlign: 'center', py: 5, maxWidth: 560, mx: 'auto' }} role="status">
          <HourglassEmptyOutlinedIcon aria-hidden sx={{ fontSize: 48, color: '#8F95A3' }} />
          <Typography variant="h5" component="h2">
            {title}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {body}
          </Typography>
          {links && links.length > 0 && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent="center">
              {links.map((l) => (
                <Button key={l.href} component={NextLink} href={l.href} variant="outlined">
                  {l.label}
                </Button>
              ))}
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export function InlineNotice({ severity = 'info', children }: { severity?: 'info' | 'warning' | 'error' | 'success'; children: React.ReactNode }) {
  return (
    <Alert severity={severity} variant="outlined" sx={{ mb: 2 }}>
      {children}
    </Alert>
  );
}
