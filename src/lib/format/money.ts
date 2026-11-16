// Money (MYR) — single source (non-functional §1, §3; ADR-0006; UI components.md money rules).
// Exact decimal handling via BigInt sen — never floating-point arithmetic on money.
// Rounding: half away from zero to 2 dp (Postgres round(x, 2) semantics).
// Self-contained (no imports) so Node's test runner can load it directly.

export type MoneyInput = string | number | bigint | null | undefined;

const NBSP = ' ';
const MINUS = '−';

export interface MoneyFormatOptions {
  /**
   * Plain ASCII output ("RM 1,234.56", "-RM 12.00") for CSV, PDF and email text.
   * Default (screens): no-break space after RM and U+2212 minus (UI components.md).
   */
  plain?: boolean;
}

/** Decimal string → integer sen, rounding half away from zero at 2 dp. Throws on invalid input. */
export function toSen(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value * 100n;
  let s: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid amount');
    // Shortest round-trip representation; exponent forms are expanded below.
    s = String(value);
  } else {
    s = value.trim();
  }
  let m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) {
    const e = /^([+-]?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(s);
    if (!e) throw new Error('Invalid amount');
    const digits = e[2] + (e[3] ?? '');
    const exp = Number(e[4]) - (e[3] ?? '').length;
    const expanded =
      exp >= 0 ? digits + '0'.repeat(exp) : digits.length > -exp ? `${digits.slice(0, exp)}.${digits.slice(exp)}` : `0.${'0'.repeat(-exp - digits.length)}${digits}`;
    m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(e[1] + expanded)!;
  }
  const neg = m[1] === '-';
  const frac = (m[3] ?? '').padEnd(3, '0');
  let sen = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
  const rest = frac.slice(2);
  if (rest[0] >= '5') sen += 1n; // half away from zero (applied to the magnitude)
  return neg && sen !== 0n ? -sen : sen;
}

/** Integer sen → canonical decimal string with 2 dp ("-1234.50"). */
export function senToDecimal(sen: bigint): string {
  const neg = sen < 0n;
  const abs = neg ? -sen : sen;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** Canonical 2-dp decimal string for storage/APIs ("1234.50"). */
export function toDecimalString(value: string | number | bigint): string {
  return senToDecimal(toSen(value));
}

function groupThousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function parts(value: MoneyInput): { neg: boolean; body: string } | null {
  if (value === null || value === undefined || value === '') return null;
  let sen: bigint;
  try {
    sen = toSen(value);
  } catch {
    return null;
  }
  const neg = sen < 0n;
  const abs = neg ? -sen : sen;
  return { neg, body: `${groupThousands((abs / 100n).toString())}.${String(abs % 100n).padStart(2, '0')}` };
}

/** "RM 1,234.56" · negative "−RM 12.00" · zero "RM 0.00". Empty string for null/invalid. */
export function formatMoney(value: MoneyInput, opts: MoneyFormatOptions = {}): string {
  const p = parts(value);
  if (!p) return '';
  const space = opts.plain ? ' ' : NBSP;
  const minus = opts.plain ? '-' : MINUS;
  return `${p.neg ? minus : ''}RM${space}${p.body}`;
}

/** Table cell (header carries "(RM)"): "1,234.56" · "−12.00". */
export function formatAmount(value: MoneyInput, opts: MoneyFormatOptions = {}): string {
  const p = parts(value);
  if (!p) return '';
  return `${p.neg ? (opts.plain ? '-' : MINUS) : ''}${p.body}`;
}

/**
 * Parses user-typed money: "1234.56", "1,234.56", "RM 1,234.56", "RM1234", "-RM 12", "−12.00".
 * At most 2 decimal places; thousands separators must be well-formed. Returns the canonical
 * decimal string ("1234.56") or null when invalid.
 */
export function parseMoney(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  let s = input.replace(/[ \s]/g, '').replace(/−/g, '-');
  if (s === '') return null;
  let neg = false;
  if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  }
  s = s.replace(/^RM/i, '');
  if (s.startsWith('-')) {
    if (neg) return null;
    neg = true;
    s = s.slice(1);
  }
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const decimal = `${neg ? '-' : ''}${m[1].replace(/,/g, '')}.${(m[2] ?? '').padEnd(2, '0')}`;
  return toDecimalString(decimal);
}

/** Exact sum of amounts (each rounded to sen first — "round once per line"). */
export function sumMoney(values: MoneyInput[]): string {
  let total = 0n;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    total += toSen(v);
  }
  return senToDecimal(total);
}

/** Exact comparison: -1, 0, 1. */
export function compareMoney(a: string | number, b: string | number): number {
  const x = toSen(a), y = toSen(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Leave days to 1 dp (FR-G-04): "12.5 days" · compact "8.5 d". */
export function formatDays(days: number | string | null | undefined, unit: 'days' | 'd' = 'days'): string {
  if (days === null || days === undefined || days === '') return '';
  const s = typeof days === 'number' ? String(days) : days.trim();
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return '';
  // tenths, half away from zero
  const frac = (m[3] ?? '').padEnd(2, '0');
  let tenths = BigInt(m[2]) * 10n + BigInt(frac[0]);
  if (frac[1] >= '5') tenths += 1n;
  const neg = m[1] === '-' && tenths !== 0n;
  const body = `${tenths / 10n}.${tenths % 10n}`;
  return `${neg ? MINUS : ''}${body}${unit === 'd' ? `${NBSP}d` : ' days'}`;
}

/** Rate per km, 3 dp: "RM 0.600/km" (CC11). */
export function formatRatePerKm(value: string | number | null | undefined, opts: MoneyFormatOptions = {}): string {
  if (value === null || value === undefined || value === '') return '';
  const s = typeof value === 'number' ? String(value) : value.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return '';
  const frac = (m[2] ?? '').padEnd(4, '0');
  let milli = BigInt(m[1]) * 1000n + BigInt(frac.slice(0, 3));
  if (frac[3] >= '5') milli += 1n;
  return `RM${opts.plain ? ' ' : NBSP}${milli / 1000n}.${String(milli % 1000n).padStart(3, '0')}/km`;
}
