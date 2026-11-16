'use client';

// Server-rendered lists: the page (Server Component) reads the URL search params, calls the
// query and passes rows/total down; this hook keeps filters/sort/page in the URL via
// useListParams and wraps each navigation in a transition so ListPage can show the 2 px
// "refresh" bar while the server re-renders (interaction-notes §1).
import * as React from 'react';
import { useListParams } from './useListParams';
import type { SortState } from './ListPage';
import { csvFileName, downloadCsv, toCsv, type CsvColumn } from './csv';
import type { ListColumn } from './ListPage';

export function useServerList<F extends Record<string, string>>(defaults: { filters: F; rowsPerPage?: number; sort?: SortState }) {
  const lp = useListParams(defaults);
  const [pending, startTransition] = React.useTransition();
  const wrap =
    <A extends unknown[]>(fn: (...a: A) => void) =>
    (...a: A) =>
      startTransition(() => fn(...a));

  return {
    ...lp,
    loading: pending ? ('refresh' as const) : (false as const),
    search: wrap(lp.search),
    clear: wrap(lp.clear),
    setPage: wrap(lp.setPage),
    setRowsPerPage: wrap(lp.setRowsPerPage),
    setSort: wrap(lp.setSort),
    /** ListPage props in one spread. */
    listProps: {
      page: lp.applied.page,
      rowsPerPage: lp.applied.rowsPerPage,
      sort: lp.applied.sort,
      activeFilterCount: lp.activeFilterCount,
      loading: pending ? ('refresh' as const) : (false as const),
      onPageChange: wrap(lp.setPage),
      onRowsPerPageChange: wrap(lp.setRowsPerPage),
      onSortChange: wrap(lp.setSort),
      onSearch: wrap(lp.search),
      onClear: wrap(lp.clear),
    },
  };
}

/** Builds CSV columns from ListPage columns (header + plain `value`). */
export function csvColumnsFrom<R>(columns: ListColumn<R>[]): CsvColumn<R>[] {
  return columns.filter((c) => c.value).map((c) => ({ header: c.header, value: (r: R) => c.value!(r) }));
}

/** Download the full filtered set returned by an export action as `<list>-dd-mm-yyyy.csv`. */
export function downloadRowsAsCsv<R>(list: string, columns: ListColumn<R>[] | CsvColumn<R>[], rows: R[]) {
  const cols: CsvColumn<R>[] =
    columns.length > 0 && 'header' in columns[0] && 'key' in (columns[0] as object)
      ? csvColumnsFrom(columns as ListColumn<R>[])
      : (columns as CsvColumn<R>[]);
  downloadCsv(csvFileName(list), toCsv(cols, rows));
}

/** Helper for server-side CSV text (preferred: the server builds and access-logs it). */
export function downloadCsvText(list: string, csv: string) {
  downloadCsv(csvFileName(list), csv.startsWith('\uFEFF') ? csv : '\uFEFF' + csv);
}

/** Download a CsvFile produced by an export Server Action (server builds + access-logs it). */
export function downloadServerCsv(filenameOrStem: string, content: string) {
  const name = filenameOrStem.endsWith('.csv') ? filenameOrStem : csvFileName(filenameOrStem);
  downloadCsv(name, content.startsWith('\uFEFF') ? content : '\uFEFF' + content);
}
