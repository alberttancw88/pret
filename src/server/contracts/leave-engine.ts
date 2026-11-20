// PRET leave engine — pure arithmetic (W2-004). Client-safe: no database or server code.
//
// The AUTHORITATIVE engine runs in the database (app.leave_day_weights, app.compute_entitlement,
// app.leave_balance_for — migrations 20261119130xxx) because every guard in brief rule 3 must hold in
// the database and the nightly pg_cron job generates entitlements. This module is the reference
// implementation of the same rules, used by:
//   * the contracts (BR-LV-22 session rules in applyLeaveSchema),
//   * the E2 wizard opening-leave step (entitlement this year shown before the employee exists),
//   * the UI (rounding / day formatting), and
//   * tests/unit/w2-004-leave-engine.test.mjs — the PRD acceptance examples (US-LEAVE-005/006/007/009/035)
//     are asserted here AND in supabase/tests/w2_004_role_matrix.sql against the SQL engine.
//
// Rules: BR-LV-10–16 (service bands, pro-rating, accrual), BR-LV-21–24 (day count), LP3/LP4/LP5.
// Dates are plain 'yyyy-mm-dd' strings; arithmetic is done in UTC days (no time zones).

export type LeaveRounding = 'up_half' | 'nearest_half' | 'down_half' | 'employment_act';
export type ProrateBasis = 'by_day' | 'by_month';
export type DayType = 'full' | 'half' | 'off' | 'rest';
export type LeaveSession = 'full' | 'am' | 'pm';
export type CountBasis = 'working_days' | 'calendar_days' | 'consecutive_calendar_days';

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
const DAY_MS = 86_400_000;
export function toDayNo(d: string): number {
  const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, dd) / DAY_MS;
}
export function fromDayNo(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}
export function addDaysIso(d: string, n: number): string {
  return fromDayNo(toDayNo(d) + n);
}
export function daysBetweenInclusive(a: string, b: string): number {
  return toDayNo(b) - toDayNo(a) + 1;
}
export function daysInYear(year: number): number {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS;
}
export function addMonthsIso(d: string, n: number): string {
  const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(dd, last));
  return t.toISOString().slice(0, 10);
}
/** BR-LV-10: completed years of continuous service on a date (0 before the service date). */
export function serviceYearsOn(serviceStart: string, on: string): number {
  if (on < serviceStart) return 0;
  const [sy, sm, sd] = serviceStart.split('-').map(Number) as [number, number, number];
  const [y, m, d] = on.split('-').map(Number) as [number, number, number];
  let years = y - sy;
  if (m < sm || (m === sm && d < sd)) years -= 1;
  return Math.max(0, years);
}
/** Completed months of service between two dates (inclusive end) — L-03 / LP3 "by completed month". */
export function completedMonths(from: string, toInclusive: string): number {
  if (toInclusive < from) return 0;
  let n = 0;
  while (addDaysIso(addMonthsIso(from, n + 1), -1) <= toInclusive) n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// Rounding (LP4) — results are in ½-day steps (ledger CHECK chk_half_steps)
// ---------------------------------------------------------------------------
const clean = (x: number) => Math.round(x * 1e6) / 1e6;
export function roundLeaveDays(x: number, rounding: LeaveRounding): number {
  const v = clean(x);
  switch (rounding) {
    case 'up_half': return Math.ceil(v * 2) / 2;
    case 'nearest_half': return Math.floor(v * 2 + 0.5) / 2;
    case 'down_half': return Math.floor(v * 2) / 2;
    case 'employment_act': { const i = Math.floor(v); return v - i >= 0.5 ? i + 1 : i; }
  }
}
/** Days to 1 decimal for display ("8.5"). */
export function formatDays(x: number | string | null | undefined): string {
  if (x === null || x === undefined || x === '') return '';
  const n = typeof x === 'string' ? Number(x) : x;
  return Number.isFinite(n) ? n.toFixed(1) : '';
}
/** Signed days for the ledger ("+1.5" / "−2.0"). */
export function formatSignedDays(x: number | string): string {
  const n = typeof x === 'string' ? Number(x) : x;
  return n > 0 ? `+${n.toFixed(1)}` : n < 0 ? `−${Math.abs(n).toFixed(1)}` : '0.0';
}

// ---------------------------------------------------------------------------
// Entitlement (BR-LV-11–16, LP2–LP5)
// ---------------------------------------------------------------------------
export type Band = { fromYears: number; toYears: number | null; days: number };
export function bandDaysFor(bands: Band[], years: number): number {
  const b = bands.find((x) => years >= x.fromYears && (x.toYears === null || years < x.toYears));
  return b ? b.days : 0;
}

export type EntitlementInput = {
  year: number;
  bands: Band[];
  /** F2 continuous-service date (drives the band) */
  serviceStart: string;
  /** F1 join date (drives joiner pro-rating) */
  joinDate: string;
  /** G5 last working day, if separating (drives leaver pro-rating) */
  lastDay?: string | null;
  basis: ProrateBasis;
  rounding: LeaveRounding;
  /** LT9 */
  prorate: boolean;
  /** LP5 — floor = statutory band × completed months ÷ 12, Employment-Act rounding */
  eaFloor: boolean;
  statutoryBands?: Band[];
  /** F-LV-31 per-employee override (yearly days; pro-rated like a band when LT9 = Yes) */
  override?: number | null;
};
export type EntitlementResult = {
  /** yearly entitlement after pro-rating, rounding, EA floor (½-day steps) */
  entitled: number;
  /** un-rounded value (6 dp) */
  unrounded: number;
  activeFrom: string | null;
  activeTo: string | null;
  floorApplied: boolean;
};

function yearWindow(i: Pick<EntitlementInput, 'year' | 'joinDate' | 'lastDay'>) {
  const ys = `${i.year}-01-01`;
  const ye = `${i.year}-12-31`;
  const a = i.joinDate > ys ? i.joinDate : ys;
  const b = i.lastDay && i.lastDay < ye ? i.lastDay : ye;
  return { ys, ye, a, b };
}

/** Σ band(d)/N over [from, to] (by day) or Σ band(slice start)/12 over completed month slices (by month). */
function accrue(i: EntitlementInput, from: string, to: string, bandAt: (d: string) => number): number {
  if (to < from) return 0;
  if (i.basis === 'by_day') {
    const n = daysInYear(i.year);
    let sum = 0;
    for (let d = toDayNo(from); d <= toDayNo(to); d += 1) sum += bandAt(fromDayNo(d));
    return sum / n;
  }
  let sum = 0;
  for (let k = 0; ; k += 1) {
    const s = addMonthsIso(from, k);
    const e = addDaysIso(addMonthsIso(from, k + 1), -1);
    if (e > to) break;
    sum += bandAt(s);
  }
  return sum / 12;
}

export function computeEntitlement(i: EntitlementInput): EntitlementResult {
  const { ys, ye, a, b } = yearWindow(i);
  if (a > b) return { entitled: 0, unrounded: 0, activeFrom: null, activeTo: null, floorApplied: false };
  const bandAt = (d: string) => (i.override != null ? i.override : bandDaysFor(i.bands, serviceYearsOn(i.serviceStart, d)));
  const raw = i.prorate ? accrue(i, a, b, bandAt) : accrue({ ...i, basis: 'by_day' }, ys, ye, bandAt);
  let entitled = roundLeaveDays(raw, i.rounding);
  let floorApplied = false;
  const partYear = a > ys || b < ye;
  if (i.prorate && i.eaFloor && partYear && i.statutoryBands?.length) {
    const stat = bandDaysFor(i.statutoryBands, serviceYearsOn(i.serviceStart, b));
    const floor = roundLeaveDays((stat * completedMonths(a, b)) / 12, 'employment_act');
    if (floor > entitled) { entitled = floor; floorApplied = true; }
  }
  return { entitled, unrounded: clean(raw), activeFrom: a, activeTo: b, floorApplied };
}

/**
 * BR-LV-14 earned to date under accrual: the yearly entitlement accrued up to and including `asAt`
 * (the last day of the leave applied for), rounded per LP4, never above the yearly entitlement.
 */
export function earnedToDate(i: EntitlementInput, asAt: string): number {
  const full = computeEntitlement(i);
  const { ys, a, b } = yearWindow(i);
  if (asAt < a) return 0;
  if (asAt >= b) return full.entitled;
  const bandAt = (d: string) => (i.override != null ? i.override : bandDaysFor(i.bands, serviceYearsOn(i.serviceStart, d)));
  const raw = accrue(i, i.prorate ? a : ys, asAt, bandAt);
  return Math.min(roundLeaveDays(raw, i.rounding), full.entitled);
}

// ---------------------------------------------------------------------------
// Day count (BR-LV-21–24)
// ---------------------------------------------------------------------------
export type CalendarDay = {
  date: string;
  /** the employee's working-week pattern day type in force on that date */
  dayType: DayType;
  /** PH or replacement holiday observed in the employee's PH calendar (work state / F20 override) */
  holiday: { name: string; half: boolean } | null;
};
export type DayKind = 'working' | 'half_working' | 'off' | 'rest' | 'public_holiday' | 'half_public_holiday' | 'calendar';
export type CountedDay = { date: string; session: LeaveSession; weight: number; kind: DayKind; label: string };

export function dayWeight(day: CalendarDay, session: LeaveSession, basis: CountBasis): { weight: number; kind: DayKind; label: string } {
  if (basis !== 'working_days') return { weight: session === 'full' ? 1 : 0.5, kind: 'calendar', label: 'Calendar day' };
  if (day.dayType === 'rest') return { weight: 0, kind: 'rest', label: 'Rest day' };
  if (day.dayType === 'off') return { weight: 0, kind: 'off', label: 'Off day' };
  let base = day.dayType === 'full' ? 1 : 0.5;
  let kind: DayKind = day.dayType === 'full' ? 'working' : 'half_working';
  let label = day.dayType === 'full' ? 'Working day' : 'Half working day';
  if (day.holiday && !day.holiday.half) return { weight: 0, kind: 'public_holiday', label: `Public holiday: ${day.holiday.name}` };
  if (day.holiday && day.holiday.half) {
    base = day.dayType === 'full' ? 0.5 : 0;
    kind = 'half_public_holiday';
    label = `Half-day public holiday: ${day.holiday.name}`;
  }
  // "A half day on a half working day counts 0.5 (no further halving)"
  const weight = session === 'full' ? base : Math.min(base, 0.5);
  return { weight, kind, label };
}

/** BR-LV-22: allowed sessions. Single day: Full / AM / PM. Multi-day: first Full or PM; last Full or AM. */
export function sessionError(startDate: string, endDate: string, startSession: LeaveSession, endSession: LeaveSession): string | null {
  if (endDate < startDate) return 'End date must be on or after the start date.';
  if (startDate === endDate) return endSession === startSession || endSession === 'full' ? null : 'A single day has one session.';
  if (startSession === 'am') return 'The first day of a multi-day application can be Full or PM only.';
  if (endSession === 'pm') return 'The last day of a multi-day application can be Full or AM only.';
  return null;
}

export function sessionFor(date: string, startDate: string, endDate: string, startSession: LeaveSession, endSession: LeaveSession): LeaveSession {
  if (startDate === endDate) return startSession;
  if (date === startDate) return startSession;
  if (date === endDate) return endSession;
  return 'full';
}

/** Total days and per-date breakdown for a resolved calendar (one entry per date start..end). */
export function countLeaveDays(
  calendar: CalendarDay[], startSession: LeaveSession, endSession: LeaveSession, basis: CountBasis,
): { total: number; days: CountedDay[] } {
  if (!calendar.length) return { total: 0, days: [] };
  const start = calendar[0]!.date;
  const end = calendar[calendar.length - 1]!.date;
  const days = calendar.map((c) => {
    const session = sessionFor(c.date, start, end, startSession, endSession);
    const w = dayWeight(c, session, basis);
    return { date: c.date, session, ...w };
  });
  return { total: clean(days.reduce((s, d) => s + d.weight, 0)), days };
}

/** BR-LV-23: consecutive-calendar types — end = start + days per occurrence − 1. */
export function consecutiveEndDate(startDate: string, daysPerOccurrence: number): string {
  return addDaysIso(startDate, Math.ceil(daysPerOccurrence) - 1);
}

/** BR-LV-25: split a range at 31/12 into per-year parts. */
export function splitByYear(startDate: string, endDate: string): { year: number; start: string; end: string }[] {
  const out: { year: number; start: string; end: string }[] = [];
  let s = startDate;
  while (s <= endDate) {
    const y = Number(s.slice(0, 4));
    const ye = `${y}-12-31`;
    const e = endDate < ye ? endDate : ye;
    out.push({ year: y, start: s, end: e });
    s = `${y + 1}-01-01`;
  }
  return out;
}
