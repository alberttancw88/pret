'use client';

// StatusChip — the single source of truth for status colours (components.md §3; Sunrise
// mapping theme-tokens.md §3.5). Label text is fixed by UX (interaction-notes §15);
// colour = palette.tone[T]. Pill, 24 px, 12/16 700, no leading dot (icons only for flags).
import * as React from 'react';
import Chip from '@mui/material/Chip';
import type { Theme } from '@mui/material/styles';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ScheduleIcon from '@mui/icons-material/Schedule';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PersonAddAltIcon from '@mui/icons-material/PersonAddAlt';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import EventIcon from '@mui/icons-material/Event';
import LockIcon from '@mui/icons-material/Lock';
import type { ToneName } from '@/theme/augment';

export type ChipVariant = 'filled' | 'outlined' | 'solid';
type IconKey = 'warning' | 'clock' | 'copy' | 'onBehalf' | 'emergency' | 'attach' | 'expired' | 'event' | 'lock';
type Spec = { tone: ToneName; variant: ChipVariant; icon?: IconKey };

const ICONS: Record<IconKey, React.ElementType> = {
  warning: WarningAmberIcon,
  clock: ScheduleIcon,
  copy: ContentCopyIcon,
  onBehalf: PersonAddAltIcon,
  emergency: PriorityHighIcon,
  attach: AttachFileIcon,
  expired: EventBusyIcon,
  event: EventIcon,
  lock: LockIcon,
};

const f = (tone: ToneName, icon?: IconKey): Spec => ({ tone, variant: 'filled', icon });
const o = (tone: ToneName, icon?: IconKey): Spec => ({ tone, variant: 'outlined', icon });
const s = (tone: ToneName, icon?: IconKey): Spec => ({ tone, variant: 'solid', icon });

/** components.md §3.2 — every status set in the wireframes. Keys are the fixed labels. */
export const STATUS_MAP = {
  claim: {
    New: f('grey'),
    Submitted: f('warning'),
    Approved: f('info'),
    Disbursed: f('success'),
    Rejected: f('error'),
    Withdrawn: o('grey'),
    Cancelled: o('error'),
    'Over limit': s('warning', 'warning'),
    'Late (override)': o('warning', 'clock'),
    'Possible duplicate': o('warning', 'copy'),
    'On behalf': o('violet', 'onBehalf'),
  },
  leave: {
    'Pending L1': f('warning'),
    'Pending L2': f('warning'),
    Approved: f('success'),
    Rejected: f('error'),
    Withdrawn: o('grey'),
    'Cancellation pending': f('info'),
    Cancelled: f('grey'),
    EMERGENCY: s('error', 'emergency'),
    'On behalf': o('violet', 'onBehalf'),
    'Attachment pending': o('warning', 'attach'),
    'MC invalid': o('error'),
    'Delegated from': o('violet'), // label: "Delegated from {approver}"
  },
  credit: {
    Pending: f('warning'),
    Approved: f('success'),
    Rejected: f('error'),
    Withdrawn: o('grey'),
    Expired: f('grey', 'expired'),
  },
  changeRequest: {
    Submitted: f('warning'),
    Approved: f('success'),
    Rejected: f('error'),
    Cancelled: f('grey'),
  },
  employment: {
    'Pending Join': f('grey'),
    'On Probation': f('info'),
    Confirmed: f('success'),
    'Notice Period': f('warning'),
    Separated: s('grey'),
    Withdrawn: o('grey'),
    Scheduled: o('violet', 'event'),
  },
  batch: {
    Draft: f('grey'),
    'Pending approval': f('warning'),
    Approved: f('info'),
    Exported: f('pink'),
    Disbursed: f('success'),
    Cancelled: o('grey'),
    'Outputs out of date': s('warning', 'warning'),
  },
  payrollRun: {
    Draft: f('grey'),
    'In Review': f('info'),
    'Pending Approval': f('warning'),
    Approved: o('success'),
    Finalised: f('success', 'lock'),
    Cancelled: o('grey'),
    Parallel: f('pink'),
    Live: o('violet'),
  },
  import: {
    Validated: f('info'),
    Committed: f('success'),
    Failed: f('error'),
  },
  user: {
    Invited: f('info'),
    Active: f('success'),
    Locked: f('error'),
    Disabled: f('grey'),
    Expired: o('grey'),
  },
  phCalendar: {
    'Not started': o('grey'),
    Draft: o('warning'),
    Published: f('success'),
  },
  /** Master-data Active flag (organisation lists, W2-002). */
  active: {
    Active: f('success'),
    Inactive: o('grey'),
  },
  accessReview: {
    'Not reviewed': o('warning'),
    Reviewed: f('success'),
  },
  payslip: {
    'Not generated': o('grey'),
    Generated: f('info'),
    Published: o('success'),
    Viewed: f('success'),
    Revised: f('warning'),
  },
  eaForm: {
    Draft: f('grey'),
    Final: f('info'),
    Issued: f('success'),
    'Re-issued': f('violet'),
  },
  statutoryTable: {
    Draft: f('grey'),
    Verified: f('success'),
    Superseded: o('grey'),
  },
  dsr: {
    Open: f('info'),
    Responded: f('success'),
    Extended: f('warning'),
    Closed: f('grey'),
  },
  role: {
    Employee: s('violet'),
    Manager: s('violet'),
    Admin: s('violet'),
    'Super Admin': s('violet'),
    'Admin · External': o('violet'),
  },
} as const satisfies Record<string, Record<string, Spec>>;

export type StatusSet = keyof typeof STATUS_MAP;
export type StatusValue<S extends StatusSet> = keyof (typeof STATUS_MAP)[S] & string;

export const STATUS_SETS = Object.keys(STATUS_MAP) as StatusSet[];

/** Type guard for values coming from the database as plain strings. */
export function isStatusValue<S extends StatusSet>(set: S, value: string): value is StatusValue<S> {
  return Object.prototype.hasOwnProperty.call(STATUS_MAP[set], value);
}

export type StatusChipProps<S extends StatusSet> = {
  set: S;
  value: StatusValue<S>;
  /** Override the label (e.g. "Delegated from Sample Manager"); the mapping still keys on `value`. */
  label?: string;
  size?: 'small' | 'xsmall';
  className?: string;
};

export function chipSx(toneName: ToneName, variant: ChipVariant) {
  return (t: Theme) => {
    const T = t.palette.tone[toneName] ?? t.palette.tone.grey;
    if (variant === 'outlined') return { bgcolor: 'transparent', color: T.fg, border: `1px solid ${T.border}` };
    if (variant === 'solid') return { bgcolor: T.solid, color: T.solidFg, border: '1px solid transparent' };
    return { bgcolor: T.bg, color: T.fg, border: '1px solid transparent' };
  };
}

/** Shape shared by every status-style chip (StatusChip, ToneChip, contract-tone chips). */
export function chipBaseSx(compact = false) {
  return {
    height: compact ? 20 : 24,
    borderRadius: '999px',
    fontSize: compact ? '0.75rem' : '0.78125rem', // 12 / 12.5 px (review: nothing below 12)
    lineHeight: compact ? '16px' : '16px',
    fontWeight: 700,
    maxWidth: '100%',
    '& .MuiChip-label': { px: compact ? 1 : 1.25 },
    '& .MuiChip-icon': { color: 'inherit', fontSize: 14, ml: 0.75, mr: -0.5 },
  } as const;
}

export default function StatusChip<S extends StatusSet>({ set, value, label, size = 'small', className }: StatusChipProps<S>) {
  const table = STATUS_MAP[set] as Record<string, Spec>;
  let spec = table[value as string];
  if (!spec) {
    // Never crash, never a random colour (components.md §3.2 fallback).
    if (process.env.NODE_ENV !== 'production') console.warn(`StatusChip: unknown ${set} status "${String(value)}"`);
    spec = o('grey');
  }
  const Icon = spec.icon ? ICONS[spec.icon] : null;
  const compact = size === 'xsmall' || set === 'role';
  return (
    <Chip
      size="small"
      className={className}
      label={label ?? value}
      icon={Icon ? <Icon aria-hidden /> : undefined}
      sx={[chipSx(spec.tone, spec.variant), chipBaseSx(compact)]}
    />
  );
}
