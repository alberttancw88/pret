// Dates and times — single source (non-functional §1–2, FR-G-03).
// Business dates are plain 'yyyy-mm-dd' strings (never JS Date, never shifted).
// Instants are shown in Malaysia time (UTC+8, no daylight saving).
// Self-contained (no imports) so Node's test runner can load it directly.

export const MYT_TIMEZONE = 'Asia/Kuala_Lumpur';
const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type DateInput = string | Date | null | undefined;

const pad2 = (n: number) => String(n).padStart(2, '0');
const PLAIN_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface Parts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mi: number;
  ss: number;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** true for a real calendar date 'yyyy-mm-dd' */
export function isValidPlainDate(value: string): boolean {
  const m = PLAIN_RE.exec(value);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  return y >= 1900 && y <= 2999 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function partsOf(input: DateInput): Parts | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'string') {
    const plain = PLAIN_RE.exec(input);
    if (plain) return isValidPlainDate(input) ? { y: +plain[1], m: +plain[2], d: +plain[3], hh: 0, mi: 0, ss: 0 } : null;
  }
  const date = input instanceof Date ? input : new Date(input);
  const t = date.getTime();
  if (Number.isNaN(t)) return null;
  const myt = new Date(t + MYT_OFFSET_MS);
  return {
    y: myt.getUTCFullYear(),
    m: myt.getUTCMonth() + 1,
    d: myt.getUTCDate(),
    hh: myt.getUTCHours(),
    mi: myt.getUTCMinutes(),
    ss: myt.getUTCSeconds(),
  };
}

/** dd/mm/yyyy (e.g. 05/03/2027). Empty string for null/invalid. */
export function formatDate(input: DateInput): string {
  const p = partsOf(input);
  return p ? `${pad2(p.d)}/${pad2(p.m)}/${p.y}` : '';
}

/** dd/mm/yyyy HH:mm, 24-hour, Malaysia time. `seconds: true` for the audit viewer (AU1). */
export function formatDateTime(input: DateInput, opts: { seconds?: boolean } = {}): string {
  const p = partsOf(input);
  if (!p) return '';
  const time = `${pad2(p.hh)}:${pad2(p.mi)}${opts.seconds ? `:${pad2(p.ss)}` : ''}`;
  return `${pad2(p.d)}/${pad2(p.m)}/${p.y} ${time}`;
}

/** MMM yyyy (e.g. Nov 2027) — disbursement month, payroll period. */
export function formatMonth(input: DateInput): string {
  const p = partsOf(input);
  return p ? `${MONTHS[p.m - 1]} ${p.y}` : '';
}

/** dd-mm-yyyy for file names (`<list>-dd-mm-yyyy.csv`). */
export function formatFileDate(input: DateInput = new Date()): string {
  return formatDate(input).replace(/\//g, '-');
}

/** The Malaysian calendar date of an instant, as 'yyyy-mm-dd'. */
export function toMytDate(instant: Date | string): string {
  const p = partsOf(instant instanceof Date ? instant : new Date(instant));
  if (!p) throw new Error('Invalid instant');
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

/** "Today" in Malaysia ('yyyy-mm-dd') — same rule as app.today_myt() in SQL. */
export function todayMyt(now: Date = new Date()): string {
  return toMytDate(now);
}

/**
 * Parses user input in dd/mm/yyyy ONLY (no guessing — EC-MIG-01). Accepts d/m/yyyy without
 * leading zeros. Returns 'yyyy-mm-dd' or null when not a real date.
 */
export function parseDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(input);
  if (!m) return null;
  const iso = `${m[3]}-${pad2(+m[2])}-${pad2(+m[1])}`;
  return isValidPlainDate(iso) ? iso : null;
}

/** Plain-date arithmetic (no timezone involved). */
export function addDays(plainDate: string, days: number): string {
  if (!isValidPlainDate(plainDate) || !Number.isInteger(days)) throw new Error('Invalid date arithmetic');
  const [y, m, d] = plainDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** Compare two plain dates: -1, 0, 1. */
export function comparePlainDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
