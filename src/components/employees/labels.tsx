'use client';

// Labels, option lists and small renderers shared by the employee screens. Every enum and
// label comes from the contract (src/server/contracts/employees.ts) — nothing re-invented.
import * as React from 'react';
import NextLink from 'next/link';
import Link from '@mui/material/Link';
import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import {
  CR_STATUS_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  MY_STATE_LABELS,
  type Address,
  type Completeness,
  type CrStatus,
  type EmployeeRef,
  type EmploymentStatus,
  type MyState,
  type Ref,
} from '@/server/contracts/employees';
import StatusChip, { type StatusValue } from '../StatusChip';
import type { Option } from '../forms/fields';
import { formatDate, formatPhone } from '@/lib/format';

export const optionsOf = <K extends string>(labels: Record<K, string>, keys?: readonly K[]): Option[] =>
  (keys ?? (Object.keys(labels) as K[])).map((k) => ({ value: k, label: labels[k] }));

export const yesNo = (b: boolean | null | undefined) => (b === null || b === undefined ? '—' : b ? 'Yes' : 'No');
export const YES_NO_OPTIONS: Option[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];
export const boolToYesNo = (b: boolean | null | undefined) => (b === null || b === undefined ? '' : b ? 'yes' : 'no');
export const yesNoToBool = (v: string): boolean | null => (v === 'yes' ? true : v === 'no' ? false : null);

export const refLabel = (r: Ref | null | undefined) => r?.label ?? '';
export const empLabel = (e: EmployeeRef | null | undefined) => (e ? `${e.name} (${e.employeeNo})` : '');
export const stateLabel = (s: MyState | string | null | undefined) => (s ? (MY_STATE_LABELS as Record<string, string>)[s] ?? s : '');
export const phone = (v: string | null | undefined) => (v ? formatPhone(v) || v : '');

export function addressText(a: Address | null | undefined): string {
  if (!a) return '';
  return [a.line1, a.line2, a.line3, `${a.postcode} ${a.city}`, stateLabel(a.state), a.country].filter(Boolean).join(', ');
}

export function EmploymentStatusChip({ status }: { status: EmploymentStatus }) {
  return <StatusChip set="employment" value={EMPLOYMENT_STATUS_LABELS[status] as StatusValue<'employment'>} />;
}
export function CrStatusChip({ status }: { status: CrStatus }) {
  return <StatusChip set="changeRequest" value={CR_STATUS_LABELS[status] as StatusValue<'changeRequest'>} />;
}
export function ScheduledChip() {
  return <StatusChip set="employment" value="Scheduled" />;
}

export function EmployeeLink({ e, admin = true }: { e: EmployeeRef | null | undefined; admin?: boolean }) {
  if (!e) return <>—</>;
  if (!admin) return <>{empLabel(e)}</>;
  return (
    <Link component={NextLink} href={`/employees/${encodeURIComponent(e.employeeNo)}`}>
      {e.name}
    </Link>
  );
}

/** Completeness % with colour band and the missing fields in a tooltip (F-EMP-24). */
export function CompletenessBadge({ c, href }: { c: Completeness; href?: string }) {
  const color = c.pct >= 100 ? 'success.main' : c.pct >= 80 ? 'warning.main' : 'error.main';
  const bg = c.pct >= 100 ? 'tone.success.bg' : c.pct >= 80 ? 'tone.warning.bg' : 'tone.error.bg';
  const tip = c.missing.length ? `Missing: ${c.missing.map((m) => m.label + (m.payroll ? ' (payroll)' : '')).join(', ')}` : 'Complete';
  const badge = (
    <Box component="span" className="pret-tnum" sx={{ px: 1, py: 0.25, borderRadius: 1, fontSize: 13, fontWeight: 600, color, bgcolor: bg, whiteSpace: 'nowrap' }}>
      {c.pct}%
    </Box>
  );
  return (
    <Tooltip title={tip} arrow enterTouchDelay={0}>
      {href ? (
        <Link component={NextLink} href={href} underline="none" aria-label={`Completeness ${c.pct}%. ${tip}`}>
          {badge}
        </Link>
      ) : (
        <span aria-label={`Completeness ${c.pct}%. ${tip}`}>{badge}</span>
      )}
    </Tooltip>
  );
}

export const dateOr = (d: string | null | undefined) => formatDate(d) || '';

/** Converts a dotted server field-error map for a sub-object ("identity.mykad") to local keys. */
export function scopeErrors(errors: Record<string, string>, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  const p = prefix ? `${prefix}.` : '';
  for (const [k, v] of Object.entries(errors)) if (!p || k.startsWith(p)) out[p ? k.slice(p.length) : k] = v;
  return out;
}

export const newIdempotencyKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined;
