'use client';

// Shared bits for the W2-006 portal screens (P11, P20, G5, G6, G7).
import * as React from 'react';
import Chip from '@mui/material/Chip';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ToneName } from '@/theme/augment';
import { chipSx } from '../StatusChip';

/** Status chip from a contract tone (info / success / grey / error / warning). */
export function ToneChip({ label, tone, outlined }: { label: string; tone: string; outlined?: boolean }) {
  const t = (['info', 'success', 'grey', 'error', 'warning', 'indigo'].includes(tone) ? tone : 'grey') as ToneName;
  return (
    <Chip
      size="small"
      label={label}
      sx={[chipSx(t, outlined ? 'outlined' : 'filled'), { height: 24, borderRadius: '6px', fontWeight: 600, fontSize: '0.75rem', '& .MuiChip-label': { px: 1 } }]}
    />
  );
}

/** Replace URL params immediately (year ▾, view toggle, tabs) — null removes a key; page resets. */
export function useSetParams() {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const search = useSearchParams();
  const [pending, start] = React.useTransition();
  const set = React.useCallback(
    (patch: Record<string, string | null>) => {
      const sp = new URLSearchParams(search?.toString() ?? '');
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') sp.delete(k);
        else sp.set(k, v);
      }
      const qs = sp.toString();
      start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [router, pathname, search],
  );
  return { set, pending };
}

/** "2 h ago" style relative time for the bell panel (dd/mm/yyyy after 7 days). */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d <= 7) return `${d} d ago`;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(t));
}

/** Human file size ("1.2 MB"). */
export function fileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
