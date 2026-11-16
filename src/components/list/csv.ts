// CSV helpers for list exports (components.md §6.4): filtered set, all pages, visible
// columns only; dates dd/mm/yyyy, money plain 2 dp (no "RM"); filename <list>-dd-mm-yyyy.csv.
// Production exports are generated server-side (api/export, access-logged); this builder
// is used by client pages that already hold the full filtered set (e.g. the dev gallery).
import { formatFileDate } from '@/lib/format';

export type CsvColumn<R> = { header: string; value: (row: R) => string | number | null | undefined };

function escape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv<R>(columns: CsvColumn<R>[], rows: R[]): string {
  const lines = [columns.map((c) => escape(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => escape(c.value(row))).join(','));
  return '﻿' + lines.join('\r\n');
}

export function csvFileName(list: string, date: Date = new Date()): string {
  return `${list}-${formatFileDate(date)}.csv`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
