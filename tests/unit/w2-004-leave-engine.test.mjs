// Unit tests — W2-004 leave engine reference implementation (src/server/contracts/leave-engine.ts).
// The same PRD acceptance examples are asserted against the SQL engine in supabase/tests/w2_004_role_matrix.sql (section B).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); } catch (e) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw e;
    }
  },
});
const m = await import('../../src/server/contracts/leave-engine.ts');

const AL = [{ fromYears: 0, toYears: 2, days: 12 }, { fromYears: 2, toYears: 5, days: 12 }, { fromYears: 5, toYears: null, days: 16 }];
const STAT_AL = [{ fromYears: 0, toYears: 2, days: 8 }, { fromYears: 2, toYears: 5, days: 12 }, { fromYears: 5, toYears: null, days: 16 }];
const SL = [{ fromYears: 0, toYears: 2, days: 14 }, { fromYears: 2, toYears: 5, days: 18 }, { fromYears: 5, toYears: null, days: 22 }];
const base = { year: 2027, basis: 'by_day', rounding: 'up_half', prorate: true, eaFloor: true, statutoryBands: STAT_AL };

// ---------------------------------------------------------------------------
// Rounding (LP4)
// ---------------------------------------------------------------------------
test('LP4 rounding: up / nearest / down to ½, Employment Act rule', () => {
  assert.equal(m.roundLeaveDays(6.016, 'up_half'), 6.5);
  assert.equal(m.roundLeaveDays(9.76, 'up_half'), 10);
  assert.equal(m.roundLeaveDays(6.0, 'up_half'), 6);
  assert.equal(m.roundLeaveDays(6.2, 'nearest_half'), 6);
  assert.equal(m.roundLeaveDays(6.25, 'nearest_half'), 6.5);
  assert.equal(m.roundLeaveDays(6.9, 'down_half'), 6.5);
  assert.equal(m.roundLeaveDays(4.5, 'employment_act'), 5);
  assert.equal(m.roundLeaveDays(4.49, 'employment_act'), 4);
});
test('formatDays / formatSignedDays (1 decimal, minus sign)', () => {
  assert.equal(m.formatDays(8.5), '8.5');
  assert.equal(m.formatDays('12'), '12.0');
  assert.equal(m.formatSignedDays(1.5), '+1.5');
  assert.equal(m.formatSignedDays(-2), '−2.0');
});

// ---------------------------------------------------------------------------
// Service years / completed months (BR-LV-10, L-03)
// ---------------------------------------------------------------------------
test('BR-LV-10 completed years of service', () => {
  assert.equal(m.serviceYearsOn('2022-07-01', '2027-06-30'), 4);
  assert.equal(m.serviceYearsOn('2022-07-01', '2027-07-01'), 5);
  assert.equal(m.serviceYearsOn('2027-03-10', '2027-01-01'), 0);
});
test('completed months (joiner 10/03 → 9 months to 31/12)', () => {
  assert.equal(m.completedMonths('2027-03-10', '2027-12-31'), 9);
  assert.equal(m.completedMonths('2027-01-01', '2027-06-30'), 6);
  assert.equal(m.completedMonths('2027-01-15', '2027-02-13'), 0);
});

// ---------------------------------------------------------------------------
// Entitlement + pro-rating (BR-LV-11–16) — PRD examples
// ---------------------------------------------------------------------------
test('BR-LV-12 full-year employee: band days', () => {
  const r = m.computeEntitlement({ ...base, bands: AL, serviceStart: '2025-01-01', joinDate: '2025-01-01' });
  assert.equal(r.entitled, 12);
});
test('US-LEAVE-006 joiner 10/03/2027: 12 × 297/365 = 9.76 → 10.0', () => {
  const r = m.computeEntitlement({ ...base, bands: AL, serviceStart: '2027-03-10', joinDate: '2027-03-10' });
  assert.equal(r.entitled, 10);
  assert.equal(Math.round(r.unrounded * 100) / 100, 9.76);
});
test('US-LEAVE-007 5-year anniversary 01/07: 12×181/365 + 16×184/365 = 14.02 → 14.5', () => {
  const r = m.computeEntitlement({ ...base, bands: AL, serviceStart: '2022-07-01', joinDate: '2022-07-01' });
  assert.equal(r.entitled, 14.5);
});
test('US-LEAVE-035 leaver LWD 30/06: 12 × 181/365 = 5.95 → 6.0', () => {
  const r = m.computeEntitlement({ ...base, bands: AL, serviceStart: '2025-01-01', joinDate: '2025-01-01', lastDay: '2027-06-30' });
  assert.equal(r.entitled, 6);
});
test('US-LEAVE-005 accrual: earned to date at 02/07/2027 = 12 × 183/365 → 6.5', () => {
  const i = { ...base, bands: AL, serviceStart: '2025-01-01', joinDate: '2025-01-01' };
  assert.equal(m.earnedToDate(i, '2027-07-02'), 6.5);
  assert.equal(m.earnedToDate(i, '2027-12-31'), 12);
  assert.equal(m.earnedToDate(i, '2026-12-31'), 0);
});
test('US-LEAVE-006 Sick not pro-rated for joiners (LT9 = No): full band 14', () => {
  const r = m.computeEntitlement({ ...base, prorate: false, bands: SL, serviceStart: '2027-03-10', joinDate: '2027-03-10' });
  assert.equal(r.entitled, 14);
});
test('Sick ≥ 5 years = 22 (s60F)', () => {
  const r = m.computeEntitlement({ ...base, prorate: false, bands: SL, serviceStart: '2019-01-01', joinDate: '2019-01-01' });
  assert.equal(r.entitled, 22);
});
test('LP3 by completed month: joiner 10/03 → 9/12 × 12 = 9.0', () => {
  const r = m.computeEntitlement({ ...base, basis: 'by_month', bands: AL, serviceStart: '2027-03-10', joinDate: '2027-03-10' });
  assert.equal(r.entitled, 9);
});
test('LP5 EA floor lifts a low pro-rated result (statutory 8 × completed months)', () => {
  const low = [{ fromYears: 0, toYears: null, days: 2 }];
  const r = m.computeEntitlement({ ...base, bands: low, serviceStart: '2027-01-01', joinDate: '2027-01-01', lastDay: '2027-09-30' });
  assert.equal(r.entitled, 6);                     // 8 × 9/12 = 6 > 2 × 273/365
  assert.equal(r.floorApplied, true);
});
test('F-LV-31 override wins over bands (pro-rated like a band)', () => {
  const r = m.computeEntitlement({ ...base, bands: AL, serviceStart: '2025-01-01', joinDate: '2025-01-01', override: 18 });
  assert.equal(r.entitled, 18);
});
test('not employed in the year → 0', () => {
  const r = m.computeEntitlement({ ...base, bands: AL, serviceStart: '2028-02-01', joinDate: '2028-02-01' });
  assert.equal(r.entitled, 0);
});

// ---------------------------------------------------------------------------
// Day count (BR-LV-21–24)
// ---------------------------------------------------------------------------
const pattern = (d) => ({ 0: 'rest', 6: 'off' })[new Date(`${d}T00:00:00Z`).getUTCDay()] ?? 'full';
const cal = (from, to, holidays = {}) => {
  const out = [];
  for (let d = from; d <= to; d = m.addDaysIso(d, 1)) out.push({ date: d, dayType: pattern(d), holiday: holidays[d] ?? null });
  return out;
};
test('US-LEAVE-009 Thu 30/08/2029 – Mon 03/09/2029 with 31/08 National Day → 2 days', () => {
  const r = m.countLeaveDays(cal('2029-08-30', '2029-09-03', { '2029-08-31': { name: 'National Day', half: false } }), 'full', 'full', 'working_days');
  assert.equal(r.total, 2);
  assert.deepEqual(r.days.map((d) => d.kind), ['working', 'public_holiday', 'off', 'rest', 'working']);
});
test('EC-LV-01 same dates, no holiday in that state → 3 days', () => {
  assert.equal(m.countLeaveDays(cal('2029-08-30', '2029-09-03'), 'full', 'full', 'working_days').total, 3);
});
test('BR-LV-24 weekend only → 0', () => {
  assert.equal(m.countLeaveDays(cal('2029-09-01', '2029-09-02'), 'full', 'full', 'working_days').total, 0);
});
test('BR-LV-22 half days: single AM = 0.5; first PM + last AM = 1.0 over two days', () => {
  assert.equal(m.countLeaveDays(cal('2029-09-03', '2029-09-03'), 'am', 'am', 'working_days').total, 0.5);
  assert.equal(m.countLeaveDays(cal('2029-09-03', '2029-09-04'), 'pm', 'am', 'working_days').total, 1);
});
test('half working day counts 0.5; a half session on it is still 0.5; half-day PH halves a full day', () => {
  assert.equal(m.dayWeight({ date: 'x', dayType: 'half', holiday: null }, 'full', 'working_days').weight, 0.5);
  assert.equal(m.dayWeight({ date: 'x', dayType: 'half', holiday: null }, 'am', 'working_days').weight, 0.5);
  assert.equal(m.dayWeight({ date: 'x', dayType: 'full', holiday: { name: 'Eve', half: true } }, 'full', 'working_days').weight, 0.5);
});
test('calendar-day basis counts every date', () => {
  assert.equal(m.countLeaveDays(cal('2029-09-01', '2029-09-07'), 'full', 'full', 'calendar_days').total, 7);
});
test('BR-LV-22 session rules', () => {
  assert.equal(m.sessionError('2029-09-03', '2029-09-03', 'am', 'am'), null);
  assert.match(m.sessionError('2029-09-03', '2029-09-04', 'am', 'full'), /Full or PM/);
  assert.match(m.sessionError('2029-09-03', '2029-09-04', 'full', 'pm'), /Full or AM/);
  assert.match(m.sessionError('2029-09-04', '2029-09-03', 'full', 'full'), /on or after/);
});
test('BR-LV-23 consecutive types: maternity 98 → start + 97; paternity 7 → start + 6', () => {
  assert.equal(m.consecutiveEndDate('2027-01-01', 98), '2027-04-08');
  assert.equal(m.consecutiveEndDate('2027-01-01', 7), '2027-01-07');
});
test('BR-LV-25 split at 31/12', () => {
  assert.deepEqual(m.splitByYear('2027-12-30', '2028-01-03'),
    [{ year: 2027, start: '2027-12-30', end: '2027-12-31' }, { year: 2028, start: '2028-01-01', end: '2028-01-03' }]);
});
