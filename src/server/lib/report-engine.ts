// W2-007 M7 — pure report helpers (no database, no 'server-only'; unit-tested in tests/unit/w2-007-reports.test.mjs):
// money / days totals that reconcile to the sen / ½ day, search + sort + paging of a built report, turnover, ageing buckets,
// the payroll-input "Reversal" rule (EC-LV-14) and the CSV cell rendering used by every report export.
import type { ReportCell, ReportColumn, ReportRow } from '../contracts/reports';

// ---------------------------------------------------------------------------
// Exact sums (ADR-0006): money in integer sen, days in tenths — never float accumulation
// ---------------------------------------------------------------------------
export function sen(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const s = String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return 0;
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  const n = Number(i) * 100 + Number((f + '00').slice(0, 2)) + (Number(f.charAt(2) || '0') >= 5 ? 1 : 0);
  return neg ? -n : n;
}
export function fromSen(n: number): string {
  const neg = n < 0; const a = Math.abs(n);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}
export function sumMoney(values: unknown[]): string {
  return fromSen(values.reduce<number>((a, v) => a + sen(v), 0));
}
export function tenths(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  return Math.round(Number(v) * 10);
}
export function days1(v: unknown): string {
  return (tenths(v) / 10).toFixed(1);
}
export function sumDays(values: unknown[]): string {
  return (values.reduce<number>((a, v) => a + tenths(v), 0) / 10).toFixed(1);
}

// ---------------------------------------------------------------------------
// Search, sort and page a built report (totals are taken BEFORE paging, over the whole filtered set)
// ---------------------------------------------------------------------------
function cellText(c: ReportCell): string {
  if (c === null || c === undefined) return '';
  return Array.isArray(c) ? c.join(' ') : String(c);
}
export function searchRows(rows: ReportRow[], q: string | undefined, keys: string[]): ReportRow[] {
  const t = q?.trim().toLowerCase();
  if (!t) return rows;
  return rows.filter((r) => keys.some((k) => cellText(r.cells[k] ?? null).toLowerCase().includes(t)));
}
function cmp(a: ReportCell, b: ReportCell, format: ReportColumn['format']): number {
  const an = a === null || a === undefined || a === ''; const bn = b === null || b === undefined || b === '';
  if (an || bn) return an && bn ? 0 : an ? 1 : -1;          // blanks last
  if (format === 'money') return sen(a) - sen(b);
  if (format === 'int' || format === 'days' || format === 'percent') return Number(a) - Number(b);
  if (format === 'bool') return Number(a) - Number(b);
  return cellText(a).localeCompare(cellText(b), 'en', { numeric: true, sensitivity: 'base' });
}
export function sortRows(rows: ReportRow[], columns: ReportColumn[], sort: string | undefined, dir: 'asc' | 'desc', byGroup = false): ReportRow[] {
  const col = columns.find((c) => c.key === sort && c.sortable);
  if (!col && !byGroup) return rows;
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((x, y) => {
    if (byGroup) {
      const g = (x.group ?? '').localeCompare(y.group ?? '');
      if (g !== 0) return g;
    }
    if (!col) return 0;
    const a = x.cells[col.key] ?? null; const b = y.cells[col.key] ?? null;
    const an = a === null || a === ''; const bn = b === null || b === '';
    if (an || bn) return an && bn ? 0 : an ? 1 : -1;   // blanks last in both directions
    return sign * cmp(a, b, col.format);
  });
}
export function pageRows<T>(rows: T[], page: number, pageSize: number, all: boolean): T[] {
  if (all) return rows;
  const start = (Math.max(page, 1) - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

// ---------------------------------------------------------------------------
// People metrics
// ---------------------------------------------------------------------------
/** Turnover % = leavers ÷ average headcount (start and end of the period) × 100, 1 dp; null when the average is 0. */
export function turnoverPct(leavers: number, headcountStart: number, headcountEnd: number): string | null {
  const avg = (headcountStart + headcountEnd) / 2;
  if (avg <= 0) return null;
  return ((Math.round((leavers / avg) * 1000)) / 10).toFixed(1);
}
/** Share of the total, 1 dp. */
export function pct(part: number, total: number): string {
  return total > 0 ? (Math.round((part / total) * 1000) / 10).toFixed(1) : '0.0';
}
/** Approved-not-disbursed ageing buckets 0–30 / 31–60 / > 60 days (count and money). */
export function ageingBuckets(items: { ageDays: number; amount: string }[]) {
  const b = { d0_30: { count: 0, amount: 0 }, d31_60: { count: 0, amount: 0 }, over60: { count: 0, amount: 0 } };
  for (const i of items) {
    const k = i.ageDays <= 30 ? 'd0_30' : i.ageDays <= 60 ? 'd31_60' : 'over60';
    b[k].count += 1; b[k].amount += sen(i.amount);
  }
  return {
    d0_30: { count: b.d0_30.count, amount: fromSen(b.d0_30.amount) },
    d31_60: { count: b.d31_60.count, amount: fromSen(b.d31_60.amount) },
    over60: { count: b.over60.count, amount: fromSen(b.over60.amount) },
  };
}
/** Completed years between two ISO dates (age, service). */
export function completedYears(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  let y = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) y -= 1;
  return y;
}
export function addYears(d: string, n: number): string {
  const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y + n, m - 1, dd));
  if (t.getUTCMonth() !== m - 1) t.setUTCDate(0);   // 29/02 → 28/02
  return t.toISOString().slice(0, 10);
}
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
export function monthsBetween(fromMonth: string, toMonth: string, max = 36): string[] {
  const out: string[] = [];
  let [y, m] = fromMonth.split('-').map(Number) as [number, number];
  const [ty, tm] = toMonth.split('-').map(Number) as [number, number];
  while ((y < ty || (y === ty && m <= tm)) && out.length < max) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthLabel(month: string, short = false): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const n = MONTHS[m - 1] ?? '';
  return `${short ? n.slice(0, 3) : n} ${y}`;
}

// ---------------------------------------------------------------------------
// F-RPT-21 payroll-input pack — unpaid-leave reversal lines (EC-LV-14)
// ---------------------------------------------------------------------------
export type ExportedUnpaidLine = { applicationId: string; refNo: string; month: string; days: string; reversal?: boolean };
export type CurrentUnpaid = { applicationId: string; month: string; days: string; status: string };
/**
 * Lines exported for EARLIER payroll months whose leave was later cancelled / withdrawn / shortened produce one reversal line
 * (negative days = the days no longer unpaid) in the first pack exported after the change. A line is reversed only once:
 * if a reversal for that application was already exported, it is not repeated.
 */
export function unpaidReversals(previous: ExportedUnpaidLine[], current: CurrentUnpaid[], month: string): ExportedUnpaidLine[] {
  const now = new Map(current.map((c) => [`${c.applicationId}|${c.month}`, c]));
  const reversed = new Set(previous.filter((l) => l.reversal).map((l) => `${l.applicationId}|${l.month}`));
  const out: ExportedUnpaidLine[] = [];
  const seen = new Set<string>();
  for (const l of previous) {
    if (l.reversal || l.month >= month) continue;
    const k = `${l.applicationId}|${l.month}`;
    if (reversed.has(k) || seen.has(k)) continue;
    seen.add(k);
    const c = now.get(k);
    const stillDays = c && (c.status === 'approved' || c.status === 'cancellation_pending') ? tenths(c.days) : 0;
    const diff = tenths(l.days) - stillDays;
    if (diff > 0) out.push({ applicationId: l.applicationId, refNo: l.refNo, month: l.month, days: (-diff / 10).toFixed(1), reversal: true });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Export cell rendering (CSV / xlsx / PDF share it): dd/mm/yyyy, money 2 dp, days 1 dp, Yes/No, lists joined
// ---------------------------------------------------------------------------
export function dmy(v: string | null | undefined): string {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}
export function exportCell(c: ReportCell, format: ReportColumn['format']): string | number | null {
  if (c === null || c === undefined || c === '') return null;
  if (Array.isArray(c)) return c.join('; ');
  switch (format) {
    case 'date': return dmy(String(c));
    case 'datetime': {
      const d = new Date(String(c));
      if (Number.isNaN(d.getTime())) return String(c);
      const myt = new Date(d.getTime() + 8 * 3600_000);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${p(myt.getUTCDate())}/${p(myt.getUTCMonth() + 1)}/${myt.getUTCFullYear()} ${p(myt.getUTCHours())}:${p(myt.getUTCMinutes())}`;
    }
    case 'money': return fromSen(sen(c));
    case 'days': return days1(c);
    case 'bool': return c === true || c === 'true' ? 'Yes' : 'No';
    case 'int': return Number(c);
    default: return String(c);
  }
}
