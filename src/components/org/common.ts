// Shared helpers for organisation screens (client- and server-safe).
import type { OrgOption, Stamps } from '@/server/contracts/org';
import type { RecordMeta } from '../forms/RecordFooter';
import type { Option } from '../forms/fields';

export const stampsMeta = (s: Partial<Stamps> | null | undefined): RecordMeta | null =>
  s
    ? {
        createdAt: s.createdAt ?? null,
        createdByName: s.createdByName ?? null,
        updatedAt: s.updatedAt ?? null,
        updatedByName: s.updatedByName ?? null,
      }
    : null;

export const activeLabel = (b: boolean) => (b ? ('Active' as const) : ('Inactive' as const));

/** URL value '' = all (contract activeFilterSchema: all | active | inactive). */
export const ACTIVE_FILTER_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];
export const activeParam = (v: string): 'all' | 'active' | 'inactive' => (v === 'active' || v === 'inactive' ? v : 'all');

/**
 * Select options from getOrgOptions(): active items, plus an inactive one when it is the
 * record's current value (shown "(inactive)") so editing never silently clears it.
 */
export function orgOptions(list: OrgOption[], keep?: (string | null | undefined)[]): Option[] {
  return list
    .filter((o) => o.isActive || (keep ?? []).includes(o.id))
    .map((o) => ({ value: o.id, label: `${o.code ? `${o.code} · ` : ''}${o.label}${o.isActive ? '' : ' (inactive)'}` }));
}

/** Filter options include inactive items (to find records still pointing at them). */
export function orgFilterOptions(list: OrgOption[]): Option[] {
  return list.map((o) => ({ value: o.id, label: `${o.code ? `${o.code} · ` : ''}${o.label}${o.isActive ? '' : ' (inactive)'}` }));
}

/** Counts that arrive with employee records (W2-003) are null until then. */
export const countOrDash = (n: number | null | undefined) => (n === null || n === undefined ? '' : n);
