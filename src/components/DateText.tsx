// Date display — dd/mm/yyyy everywhere; date-time dd/mm/yyyy HH:mm (MYT); month MMM yyyy.
// Server-safe (no client hooks).
import * as React from 'react';
import { formatDate, formatDateTime, formatMonth, type DateInput } from '@/lib/format';

export type DateTextProps = {
  value: DateInput;
  mode?: 'date' | 'datetime' | 'month';
  /** Shown when value is empty. */
  empty?: string;
};

export default function DateText({ value, mode = 'date', empty = '—' }: DateTextProps) {
  const text = mode === 'datetime' ? formatDateTime(value) : mode === 'month' ? formatMonth(value) : formatDate(value);
  if (!text) return <span>{empty}</span>;
  const iso = value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : undefined;
  return (
    <time dateTime={iso} className="pret-tnum" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
      {text}
    </time>
  );
}
