'use client';

// Shared leave renderers (W2-004). Every enum, label and tone comes from the contract
// (src/server/contracts/leave.ts, approvals.ts) — nothing re-invented here.
// Dates dd/mm/yyyy, days to 1 dp (formatDays from the leave engine), status via StatusChip.
import * as React from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import {
  CREDIT_STATUS_LABELS,
  LEAVE_SESSION_LABELS,
  LEAVE_STATUS_LABELS,
  formatDays,
  formatSignedDays,
  type CreditStatus,
  type LeaveSessionValue,
  type LeaveStatus,
  type LeaveTypeRef,
} from '@/server/contracts/leave';
import { TASK_STATUS_LABELS, type TaskStatus } from '@/server/contracts/approvals';
import StatusChip, { chipSx, type StatusValue } from '../StatusChip';
import { formatDate } from '@/lib/format';
import type { Option } from '../forms/fields';

export { formatDays, formatSignedDays };

/** "8.5 days" / compact "8.5 d". */
export const daysText = (d: string | number | null | undefined, unit: 'days' | 'd' = 'days') => {
  const t = formatDays(d);
  return t ? `${t}${unit === 'd' ? ' d' : Number(t) === 1 ? ' day' : ' days'}` : '';
};

/** "05/05/2027 (Full) – 07/05/2027 (AM)" — sessions only when not Full. */
export function rangeText(start: string, end: string, startSession?: LeaveSessionValue, endSession?: LeaveSessionValue, alwaysSessions = false): string {
  const s = (d: string, ss?: LeaveSessionValue) => `${formatDate(d)}${ss && (alwaysSessions || ss !== 'full') ? ` (${LEAVE_SESSION_LABELS[ss]})` : ''}`;
  if (start === end) return s(start, startSession);
  return `${s(start, startSession)} – ${s(end, endSession)}`;
}

/** Leave status chip — Pending shows "Pending L1/L2" (PRD §6.10). */
export function LeaveStatusChip({ status, level }: { status: LeaveStatus; level?: number | null }) {
  if (status === 'pending') {
    const lv = level && level > 0 ? level : 1;
    return <StatusChip set="leave" value={lv >= 2 ? 'Pending L2' : 'Pending L1'} label={`Pending L${lv}`} />;
  }
  return <StatusChip set="leave" value={LEAVE_STATUS_LABELS[status] as StatusValue<'leave'>} />;
}
export const leaveStatusText = (status: LeaveStatus, level?: number | null) =>
  status === 'pending' ? `Pending L${level && level > 0 ? level : 1}` : LEAVE_STATUS_LABELS[status];

export function CreditStatusChip({ status, expired }: { status: CreditStatus; expired?: boolean }) {
  if (status === 'approved' && expired) return <StatusChip set="credit" value="Expired" />;
  return <StatusChip set="credit" value={CREDIT_STATUS_LABELS[status] as StatusValue<'credit'>} />;
}

export function EmergencyChip() {
  return <StatusChip set="leave" value="EMERGENCY" />;
}

/** Flag chips used on lists and detail headers. */
export function LeaveFlags({
  emergency,
  onBehalf,
  onBehalfName,
  attachmentPending,
  mcInvalid,
  mcNotChecked,
}: {
  emergency?: boolean;
  onBehalf?: boolean;
  onBehalfName?: string | null;
  attachmentPending?: boolean;
  mcInvalid?: boolean;
  mcNotChecked?: boolean;
}) {
  const any = emergency || onBehalf || onBehalfName || attachmentPending || mcInvalid || mcNotChecked;
  if (!any) return <>—</>;
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {emergency && <EmergencyChip />}
      {(onBehalf || onBehalfName) && <StatusChip set="leave" value="On behalf" label={onBehalfName ? `On behalf by ${onBehalfName}` : 'On behalf'} />}
      {attachmentPending && <StatusChip set="leave" value="Attachment pending" />}
      {mcInvalid && <StatusChip set="leave" value="MC invalid" />}
      {mcNotChecked && !mcInvalid && <StatusChip set="leave" value="Attachment pending" label="MC not checked" />}
    </Stack>
  );
}

/** Approval-trail decision chip (task status). */
export function TaskStatusChip({ status }: { status: TaskStatus }) {
  const tone = status === 'approved' ? 'success' : status === 'rejected' ? 'error' : status === 'open' ? 'warning' : 'grey';
  return (
    <Chip
      size="small"
      label={TASK_STATUS_LABELS[status]}
      variant="filled"
      sx={[chipSx(tone, status === 'open' || status === 'approved' || status === 'rejected' ? 'filled' : 'outlined'), { height: 24, borderRadius: '6px', fontWeight: 600, fontSize: '0.75rem' }]}
    />
  );
}

/** Colour swatch + type name (LT32). */
export function TypeLabel({ type, hideColour }: { type: Pick<LeaveTypeRef, 'name' | 'colour'> & { code?: string }; hideColour?: boolean }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" component="span">
      {!hideColour && <Box component="span" aria-hidden sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: type.colour, flexShrink: 0, display: 'inline-block' }} />}
      <span>{type.name}</span>
    </Stack>
  );
}

/** Right-aligned 1-dp number cell; negative in red. */
export function DaysCell({ value, signed }: { value: string | number | null | undefined; signed?: boolean }) {
  if (value === null || value === undefined || value === '') return <>—</>;
  const n = Number(value);
  const text = signed ? formatSignedDays(value) : n < 0 ? `−${formatDays(Math.abs(n))}` : formatDays(value);
  return (
    <Box component="span" className="pret-tnum" sx={{ fontVariantNumeric: 'tabular-nums', color: n < 0 ? '#B42318' : undefined, whiteSpace: 'nowrap' }}>
      {text}
    </Box>
  );
}

export function HintIcon({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <Tooltip title={title} enterTouchDelay={0}>
      {children}
    </Tooltip>
  );
}

/** Caption + value row used in balance panels. */
export function PanelRow({ label, value, strong, tone }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; tone?: 'error' | 'muted' }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 0.25 }}>
      <Typography variant="body2" color={tone === 'muted' ? 'text.secondary' : 'text.primary'} fontWeight={strong ? 700 : 400}>
        {label}
      </Typography>
      <Typography variant="body2" className="pret-tnum" fontWeight={strong ? 700 : 500} sx={{ color: tone === 'error' ? '#B42318' : undefined, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Stack>
  );
}

export const optionsFrom = <K extends string>(labels: Record<K, string>, keys?: readonly K[]): Option[] =>
  (keys ?? (Object.keys(labels) as K[])).map((k) => ({ value: k, label: labels[k] }));

/** Year options: current year ± range. */
export function yearOptions(current: number, back = 2, forward = 1): Option[] {
  const out: Option[] = [];
  for (let y = current + forward; y >= current - back; y -= 1) out.push({ value: String(y), label: String(y) });
  return out;
}

/** Client-side idempotency key per form instance (EC-LV-09). */
export function useIdempotencyKey(): [string, () => void] {
  const make = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : '00000000-0000-4000-8000-' + Math.floor(Math.random() * 1e12).toString(16).padStart(12, '0');
  const [key, setKey] = React.useState<string>(make);
  return [key, () => setKey(make())];
}

/** Opens a Server-Action download URL result in a new tab. */
export async function openUrl(fn: () => Promise<{ ok: true; url: string } | { ok: false; error: string }>, onError: (msg: string) => void) {
  try {
    const res = await fn();
    if (res.ok) window.open(res.url, '_blank', 'noopener');
    else onError(res.error);
  } catch {
    onError('Could not open the file.');
  }
}
