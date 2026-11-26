// Report cell formatting and file downloads (W2-007, R3 viewer).
// Dates dd/mm/yyyy, money "RM 1,234.56" (tables: "1,234.56" under a "(RM)" header), days to 1 dp.
import type { ReportCell, ReportColumn, ReportDownload, ReportFormat } from '@/server/contracts/reports';
import { formatAmount, formatDate, formatDateTime, formatDays, formatMoney } from '@/lib/format';

const NUMERIC: ReportFormat[] = ['int', 'days', 'money', 'percent'];

export function isNumericFormat(format: ReportFormat): boolean {
  return NUMERIC.includes(format);
}

/** Plain text for one cell (table and phone cards). Empty → "—". */
export function formatCell(value: ReportCell | undefined, format: ReportFormat): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  switch (format) {
    case 'date':
      return formatDate(String(value)) || String(value);
    case 'datetime':
      return formatDateTime(String(value)) || String(value);
    case 'money':
      return formatAmount(value as string | number) || String(value);
    case 'days': {
      const s = formatDays(value as string | number, 'd');
      return s ? s.replace(/ d$/, '') : String(value);
    }
    case 'percent': {
      const n = Number(value);
      return Number.isFinite(n) ? `${n.toLocaleString('en-MY', { maximumFractionDigits: 1 })}%` : String(value);
    }
    case 'int': {
      const n = Number(value);
      return Number.isFinite(n) ? n.toLocaleString('en-MY') : String(value);
    }
    case 'bool':
      return value === true || value === 'true' ? '✓' : '—';
    case 'list':
      return String(value);
    default:
      return String(value);
  }
}

/** Header text; money columns carry "(RM)" so cells can show plain amounts. */
export function columnHeader(c: Pick<ReportColumn, 'label' | 'format'>): string {
  return c.format === 'money' && !/\(RM\)/.test(c.label) ? `${c.label} (RM)` : c.label;
}

/** Summary values (strip above the table) — money in full "RM 1,234.56". */
export function formatSummary(value: string, format: ReportFormat): string {
  if (format === 'money') {
    return formatMoney(value) || value;
  }
  if (format === 'days') {
    return formatDays(value) || value;
  }
  return formatCell(value, format);
}

/** Save a file returned by an export Server Action (CSV utf8 / .xlsx and PDF base64). */
export function saveDownload(file: ReportDownload): void {
  let blob: Blob;
  if (file.encoding === 'base64') {
    const bin = atob(file.content);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    blob = new Blob([bytes], { type: file.contentType });
  } else {
    const text = file.contentType.startsWith('text/csv') && !file.content.startsWith('﻿') ? '﻿' + file.content : file.content;
    blob = new Blob([text], { type: file.contentType });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
