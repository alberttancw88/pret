import { formatDate, formatDateTime, formatFileDate } from '../../lib/format/date';
import type { CsvFile } from '../contracts/common';

// CSV exports (every ListPage). UTF-8 with BOM (Excel), CRLF, RFC 4180 quoting, dd/mm/yyyy dates,
// and formula-injection protection: cells starting with = + - @ TAB CR are prefixed with '.

export type CsvValue = string | number | boolean | null | undefined;

function cell(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Builds the CsvFile result: `<base>-dd-mm-yyyy.csv`. */
export function csvFile(base: string, headers: string[], rows: CsvValue[][]): CsvFile {
  return {
    filename: `${base}-${formatFileDate()}.csv`,
    contentType: 'text/csv',
    content: toCsv(headers, rows),
    rowCount: rows.length,
  };
}

export const csvDate = (v: string | Date | null | undefined) => formatDate(v ?? null);
export const csvDateTime = (v: string | Date | null | undefined, seconds = false) => formatDateTime(v ?? null, { seconds });
