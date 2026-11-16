// Server-side reader for the list URL state written by useListParams (filters by key,
// `page` 0-based, `rpp`, `sort`, `dir`). Server Components call this with the page's
// searchParams so the query receives exactly what the list shows. Server- and client-safe.

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

export type ReadListParams<F extends Record<string, string>> = {
  filters: F;
  page: number;
  rowsPerPage: number;
  sort?: { key: string; direction: 'asc' | 'desc' };
};

const RPP = [10, 25, 50, 100];

export function readListParams<F extends Record<string, string>>(
  sp: SearchParamsRecord | undefined,
  defaults: { filters: F; rowsPerPage?: number; sort?: { key: string; direction: 'asc' | 'desc' } },
): ReadListParams<F> {
  const get = (k: string) => {
    const v = sp?.[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const filters = { ...defaults.filters };
  for (const key of Object.keys(filters)) {
    const v = get(key);
    if (typeof v === 'string') (filters as Record<string, string>)[key] = v;
  }
  const rpp = Number(get('rpp'));
  const sortKey = get('sort');
  return {
    filters,
    page: Math.max(0, Number(get('page') ?? 0) || 0),
    rowsPerPage: RPP.includes(rpp) ? rpp : defaults.rowsPerPage ?? 25,
    sort: sortKey ? { key: sortKey, direction: get('dir') === 'desc' ? 'desc' : 'asc' } : defaults.sort,
  };
}

/** '' → undefined; 'a,b' → ['a','b'] for multi-select filters kept as comma lists in the URL. */
export const opt = (v: string): string | undefined => (v === '' ? undefined : v);
export const optList = (v: string): string[] | undefined => (v === '' ? undefined : v.split(',').filter(Boolean));
export const optBool = (v: string): boolean | undefined => (v === 'yes' ? true : v === 'no' ? false : undefined);

/**
 * Contract page params (`pageParamsSchema`: q, page 1-based, pageSize, dir) + a validated sort
 * key from the list's allowed set (unknown keys fall back to the default sort).
 */
export function toPageParams<S extends string>(
  lp: ReadListParams<Record<string, string> & { q?: string }>,
  allowedSorts: readonly S[],
): { q?: string; page: number; pageSize: number; dir: 'asc' | 'desc'; sort?: S } {
  const sortKey = lp.sort?.key;
  const sort = sortKey && (allowedSorts as readonly string[]).includes(sortKey) ? (sortKey as S) : undefined;
  return {
    q: lp.filters.q ? lp.filters.q : undefined,
    page: lp.page + 1,
    pageSize: lp.rowsPerPage,
    dir: sort ? lp.sort!.direction : 'asc',
    ...(sort ? { sort } : {}),
  };
}

/** Single value of a search param. */
export function spValue(sp: SearchParamsRecord | undefined, key: string): string | undefined {
  const v = sp?.[key];
  return Array.isArray(v) ? v[0] : v;
}
