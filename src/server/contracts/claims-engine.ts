// PRET claims engine — pure money and limit arithmetic (W2-005). Client-safe: no database or server code.
//
// The AUTHORITATIVE rules run in the database (app.claim_mileage_amount, app.claim_period, app.claim_limit_for,
// app.claim_evaluate — migration 20261122…_w2_005_claims_engine) because brief rule 3 requires the guards there.
// This module is the reference implementation of the same rules, used by:
//   * the UI while typing (running totals, "amount = km × rate", SST checks) — always confirmed by the server;
//   * tests/unit/w2-005-claims-engine.test.mjs — the PRD examples (US-CLAIM-003/006/008, EC-CLM-01) are asserted
//     here AND in supabase/tests/w2_005_role_matrix.sql against the SQL engine.
//
// Money (ADR-0006): decimal strings, BigInt sen, half away from zero, round once per line, totals = Σ rounded lines.
// Dates are plain 'yyyy-mm-dd' strings.
import { formatMoney, senToDecimal, toSen } from '../../lib/format/money';

export type LimitBehaviour = 'block' | 'warn';
export type LimitBasis = 'transaction' | 'month' | 'year';
export type LimitAppliesTo = 'everyone' | 'grade' | 'department' | 'employee_group' | 'employee';

export const MAX_LINE_AMOUNT = '99999.99';
export const MIN_KM = '0.1';
export const MAX_KM = '2000.0';
export const MAX_LINES = 50;
export const MAX_FILES_PER_LINE = 5;

// ---------------------------------------------------------------------------
// Decimal helpers (exact)
// ---------------------------------------------------------------------------
/** Decimal string → scaled BigInt with `scale` fraction digits (no rounding beyond scale: extra digits must be 0). */
function scaled(v: string, scale: number): bigint {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(v).trim());
  if (!m) throw new Error('Invalid number');
  const frac = (m[3] ?? '').padEnd(scale, '0');
  if (frac.length > scale && /[1-9]/.test(frac.slice(scale))) throw new Error('Too many decimal places');
  const n = BigInt(m[2]!) * 10n ** BigInt(scale) + BigInt(frac.slice(0, scale) || '0');
  return m[1] === '-' ? -n : n;
}
/** Round a value with `scale` fraction digits to sen (half away from zero). */
function roundToSen(v: bigint, scale: number): bigint {
  if (scale <= 2) return v * 10n ** BigInt(2 - scale);
  const div = 10n ** BigInt(scale - 2);
  const neg = v < 0n; const a = neg ? -v : v;
  let q = a / div; const r = a % div;
  if (r * 2n >= div) q += 1n;
  return neg ? -q : q;
}
export const money = (sen: bigint) => senToDecimal(sen);
export const sen = (v: string | number) => toSen(typeof v === 'number' ? String(v) : v);
const rm = (s: bigint) => formatMoney(senToDecimal(s), { plain: true });

/** BR-CLM-15: amount = round(km × rate, 2). km has 1 dp (Decimal(6,1)), rate 3 dp (RM/km). */
export function mileageAmount(distanceKm: string, ratePerKm: string): string {
  const km = scaled(distanceKm, 1);
  const rate = scaled(ratePerKm, 3);
  return senToDecimal(roundToSen(km * rate, 4));
}

/** BR-CLM-15 distance 0.1–2,000 km with at most 1 decimal. Returns an error sentence or null. */
export function distanceError(distanceKm: string | null | undefined): string | null {
  if (distanceKm == null || String(distanceKm).trim() === '') return 'Enter the distance (km).';
  let v: bigint;
  try { v = scaled(String(distanceKm), 1); } catch { return 'Distance must be a number with at most 1 decimal place.'; }
  if (v < 1n || v > 20000n) return 'Distance must be between 0.1 and 2,000 km.';
  return null;
}

/** BR-CLM-11: 0 < amount ≤ 99,999.99; 0 ≤ SST ≤ amount. Returns { field, message } or null. */
export function amountError(amountInclSst: string | null | undefined, sstAmount: string | null | undefined): { field: 'amountInclSst' | 'sstAmount'; message: string } | null {
  let a: bigint;
  try { a = sen(String(amountInclSst ?? '')); } catch { return { field: 'amountInclSst', message: 'Enter the amount (RM).' }; }
  if (a <= 0n) return { field: 'amountInclSst', message: 'Amount must be more than RM 0.00.' };
  if (a > sen(MAX_LINE_AMOUNT)) return { field: 'amountInclSst', message: 'Amount must be at most RM 99,999.99.' };
  if (sstAmount == null || String(sstAmount).trim() === '') return null;
  let s: bigint;
  try { s = sen(String(sstAmount)); } catch { return { field: 'sstAmount', message: 'Enter a valid SST amount.' }; }
  if (s < 0n) return { field: 'sstAmount', message: 'SST cannot be negative.' };
  if (s > a) return { field: 'sstAmount', message: 'SST cannot be more than the amount.' };
  return null;
}

/** CH5–CH7 totals: Σ line amounts incl. SST, Σ SST, total − SST (exact). */
export function claimTotals(lines: { amountInclSst: string; sstAmount?: string | null }[]): { total: string; sst: string; exclSst: string } {
  let t = 0n; let s = 0n;
  for (const l of lines) { t += sen(l.amountInclSst); s += l.sstAmount ? sen(l.sstAmount) : 0n; }
  return { total: money(t), sst: money(s), exclSst: money(t - s) };
}

// ---------------------------------------------------------------------------
// Periods (BR-CLM-13 — the limit-refresh day; 31 = calendar month end)
// ---------------------------------------------------------------------------
function ymd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function daysIn(y: number, m: number): number { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function clampDay(y: number, m: number, day: number): string { return ymd(y, m, Math.min(day, daysIn(y, m))); }
function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
}
function shiftMonth(y: number, m: number, k: number): [number, number] {
  const i = y * 12 + (m - 1) + k; return [Math.floor(i / 12), (i % 12) + 1];
}

/** Monthly limit period containing `date`: ends on the refresh day (clamped to the month's last day). */
export function monthPeriod(date: string, refreshDay = 31): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const endThis = clampDay(y, m, refreshDay);
  if (date <= endThis) {
    const [py, pm] = shiftMonth(y, m, -1);
    return { from: addDays(clampDay(py, pm, refreshDay), 1), to: endThis };
  }
  const [ny, nm] = shiftMonth(y, m, 1);
  return { from: addDays(endThis, 1), to: clampDay(ny, nm, refreshDay) };
}
/** Yearly limit period containing `date`: ends on the refresh day of December (31 → calendar year). */
export function yearPeriod(date: string, refreshDay = 31): { from: string; to: string } {
  const y = Number(date.slice(0, 4));
  const endThis = clampDay(y, 12, refreshDay);
  if (date <= endThis) return { from: addDays(clampDay(y - 1, 12, refreshDay), 1), to: endThis };
  return { from: addDays(endThis, 1), to: clampDay(y + 1, 12, refreshDay) };
}

/** BR-CLM-10: earliest allowed transaction date = today − deadline days. */
export function earliestTransactionDate(today: string, deadlineDays: number): string { return addDays(today, -deadlineDays); }

// ---------------------------------------------------------------------------
// Limits (BR-CLM-13 / BR-CLM-14)
// ---------------------------------------------------------------------------
export type LimitRule = {
  appliesTo: LimitAppliesTo;
  perTransaction: string | null;
  perMonth: string | null;
  perYear: string | null;
  behaviour: LimitBehaviour;
};
export type LimitCandidate = LimitRule & { targetId: string | null; effectiveFrom: string; effectiveTo: string | null };
export type LimitFacts = { employeeId: string; departmentId: string | null; gradeId: string | null; groupIds: string[] };
const PRECEDENCE: Record<LimitAppliesTo, number> = { employee: 1, department: 2, grade: 3, employee_group: 4, everyone: 5 };

/** BR-CLM-14 precedence employee > department > grade > employee group > everyone, effective on `date`. */
export function pickLimit<T extends LimitCandidate>(candidates: T[], facts: LimitFacts, date: string): T | null {
  const hits = candidates.filter((c) => c.effectiveFrom <= date && (c.effectiveTo === null || c.effectiveTo >= date)
    && (c.appliesTo === 'everyone'
      || (c.appliesTo === 'employee' && c.targetId === facts.employeeId)
      || (c.appliesTo === 'department' && c.targetId === facts.departmentId)
      || (c.appliesTo === 'grade' && c.targetId === facts.gradeId)
      || (c.appliesTo === 'employee_group' && c.targetId !== null && facts.groupIds.includes(c.targetId))));
  hits.sort((a, b) => PRECEDENCE[a.appliesTo] - PRECEDENCE[b.appliesTo] || (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return hits[0] ?? null;
}

/** CLN16 limit check result (also stored on claim_lines.limit_check by the database). */
export type LimitCheck = {
  status: 'no_limit' | 'within' | 'over';
  behaviour: LimitBehaviour | null;
  /** the limit that decided the result (null = no limit) */
  basis: LimitBasis | null;
  limit: string | null;
  /** used in the period including this line (transaction: the line amount) */
  used: string | null;
  overBy: string | null;
  /** true → blocks submission (Block behaviour) */
  blocking: boolean;
  /** "Within limit (RM 120.00 of RM 300.00)" · "Exceeds RM 300.00 per transaction" · "Over limit by RM 50.00 (warning)" */
  message: string;
};
const BASIS_WORD: Record<LimitBasis, string> = { transaction: 'per transaction', month: 'per month', year: 'per year' };

/**
 * Evaluates one line. usedMonth / usedYear = Σ of the employee's OTHER live lines (Submitted / Approved / Disbursed and the
 * earlier lines of the same claim) in the category and period, all amounts incl. SST (Q19).
 */
export function evaluateLimit(rule: LimitRule | null, amountInclSst: string, usedMonth = '0', usedYear = '0'): LimitCheck {
  if (!rule || (rule.perTransaction === null && rule.perMonth === null && rule.perYear === null)) {
    return { status: 'no_limit', behaviour: null, basis: null, limit: null, used: null, overBy: null, blocking: false, message: 'No limit' };
  }
  const a = sen(amountInclSst);
  const checks: { basis: LimitBasis; limit: bigint; used: bigint }[] = [];
  if (rule.perTransaction !== null) checks.push({ basis: 'transaction', limit: sen(rule.perTransaction), used: a });
  if (rule.perMonth !== null) checks.push({ basis: 'month', limit: sen(rule.perMonth), used: sen(usedMonth) + a });
  if (rule.perYear !== null) checks.push({ basis: 'year', limit: sen(rule.perYear), used: sen(usedYear) + a });
  const over = checks.find((c) => c.used > c.limit);
  if (over) {
    const by = over.used - over.limit;
    const blocking = rule.behaviour === 'block';
    return {
      status: 'over', behaviour: rule.behaviour, basis: over.basis, limit: money(over.limit), used: money(over.used), overBy: money(by), blocking,
      message: blocking
        ? over.basis === 'transaction' ? `Exceeds ${rm(over.limit)} per transaction` : `Exceeds ${rm(over.limit)} ${BASIS_WORD[over.basis]} (over by ${rm(by)})`
        : `Over limit by ${rm(by)} (warning)`,
    };
  }
  // tightest remaining headroom; ties keep the first basis (transaction → month → year), as the SQL engine
  let tight = checks[0]!;
  for (const c of checks) if (c.limit - c.used < tight.limit - tight.used) tight = c;
  return {
    status: 'within', behaviour: rule.behaviour, basis: tight.basis, limit: money(tight.limit), used: money(tight.used), overBy: null, blocking: false,
    message: `Within limit (${rm(tight.used)} of ${rm(tight.limit)}${tight.basis === 'transaction' ? '' : ` ${tight.basis === 'month' ? 'this month' : 'this year'}`})`,
  };
}

/** Short limits summary for the C5 list / P14 policy text: "RM 300.00 / transaction · RM 1,000.00 / month". */
export function limitSummary(rule: Pick<LimitRule, 'perTransaction' | 'perMonth' | 'perYear'> | null): string {
  if (!rule) return 'No limit';
  const p: string[] = [];
  if (rule.perTransaction) p.push(`${rm(sen(rule.perTransaction))} / transaction`);
  if (rule.perMonth) p.push(`${rm(sen(rule.perMonth))} / month`);
  if (rule.perYear) p.push(`${rm(sen(rule.perYear))} / year`);
  return p.length ? p.join(' · ') : 'No limit';
}
