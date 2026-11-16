'use client';

// Keeps a list's filters, sort, page and rows-per-page in the URL so Back from a detail
// returns to the same view (FR-G-06, components.md §6.1). Filter edits stay as a draft
// until SEARCH/Enter; CLEAR resets to the list's defaults.
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { SortState } from './ListPage';

export type ListParams<F extends Record<string, string>> = {
  filters: F;
  page: number;
  rowsPerPage: number;
  sort?: SortState;
};

export function useListParams<F extends Record<string, string>>(defaults: {
  filters: F;
  rowsPerPage?: number;
  sort?: SortState;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const search = useSearchParams();

  const applied: ListParams<F> = React.useMemo(() => {
    const filters = { ...defaults.filters };
    for (const key of Object.keys(filters)) {
      const v = search?.get(key);
      if (v !== null && v !== undefined) (filters as Record<string, string>)[key] = v;
    }
    const sortKey = search?.get('sort');
    const dir = search?.get('dir');
    return {
      filters,
      page: Math.max(0, Number(search?.get('page') ?? 0) || 0),
      rowsPerPage: Number(search?.get('rpp')) || defaults.rowsPerPage || 25,
      sort: sortKey ? { key: sortKey, direction: dir === 'desc' ? 'desc' : 'asc' } : defaults.sort,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const [draft, setDraft] = React.useState<F>(applied.filters);
  React.useEffect(() => setDraft(applied.filters), [applied.filters]);

  const push = React.useCallback(
    (next: ListParams<F>) => {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(next.filters)) {
        if (v !== defaults.filters[k]) sp.set(k, v);
      }
      if (next.page) sp.set('page', String(next.page));
      if (next.rowsPerPage !== (defaults.rowsPerPage ?? 25)) sp.set('rpp', String(next.rowsPerPage));
      if (next.sort && (next.sort.key !== defaults.sort?.key || next.sort.direction !== defaults.sort?.direction)) {
        sp.set('sort', next.sort.key);
        sp.set('dir', next.sort.direction);
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, pathname],
  );

  const activeFilterCount = Object.entries(applied.filters).filter(([k, v]) => v !== '' && v !== defaults.filters[k]).length;

  return {
    applied,
    draft,
    setDraftField: (key: keyof F, value: string) => setDraft((d) => ({ ...d, [key]: value })),
    activeFilterCount,
    search: () => push({ ...applied, filters: draft, page: 0 }),
    clear: () => {
      setDraft(defaults.filters);
      push({ ...applied, filters: defaults.filters, page: 0 });
    },
    setPage: (page: number) => push({ ...applied, page }),
    setRowsPerPage: (rowsPerPage: number) => push({ ...applied, rowsPerPage, page: 0 }),
    setSort: (sort: SortState) => push({ ...applied, sort, page: 0 }),
  };
}
