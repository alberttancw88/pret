// Unit tests — W2-005 claims engine reference implementation (src/server/contracts/claims-engine.ts).
// The same PRD examples are asserted against the SQL engine in supabase/tests/w2_005_role_matrix.sql (section B).
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
const m = await import('../../src/server/contracts/claims-engine.ts');

test('mileage at the D31 rate RM 0.500/km: amount = round(km × rate, 2), half away from zero (BR-CLM-15, US-CLAIM-006)', () => {
  assert.equal(m.mileageAmount('42.5', '0.500'), '21.25');
  assert.equal(m.mileageAmount('12.3', '0.500'), '6.15');
  assert.equal(m.mileageAmount('0.1', '0.500'), '0.05');
  assert.equal(m.mileageAmount('2000', '0.500'), '1000.00');
  assert.equal(m.mileageAmount('33.3', '0.575'), '19.15');            // 19.1475 → 19.15 (rounding rule with a 3-dp rate)
  assert.equal(m.mileageAmount('10.5', '0.333'), '3.50');             // 3.4965 → 3.50
  assert.throws(() => m.mileageAmount('1.25', '0.5'));                // km has 1 dp
});
test('distance 0.1–2,000 km with 1 decimal', () => {
  assert.equal(m.distanceError('0.1'), null);
  assert.equal(m.distanceError('2000'), null);
  assert.match(m.distanceError('0') ?? '', /between 0.1 and 2,000/);
  assert.match(m.distanceError('2000.1') ?? '', /between/);
  assert.match(m.distanceError('1.25') ?? '', /1 decimal/);
  assert.match(m.distanceError('') ?? '', /Enter the distance/);
});
test('amount and SST (BR-CLM-11)', () => {
  assert.equal(m.amountError('10.00', '0'), null);
  assert.equal(m.amountError('99999.99', null), null);
  assert.equal(m.amountError('0', null)?.field, 'amountInclSst');
  assert.equal(m.amountError('100000', null)?.field, 'amountInclSst');
  assert.equal(m.amountError('10.00', '10.01')?.message, 'SST cannot be more than the amount.');
  assert.equal(m.amountError('10.00', '-1')?.field, 'sstAmount');
});
test('totals: Σ lines incl. SST, Σ SST, excl. SST — exact to the sen (CH5–CH7, ADR-0006)', () => {
  assert.deepEqual(m.claimTotals([{ amountInclSst: '120.00', sstAmount: '7.20' }, { amountInclSst: '21.25' }]), { total: '141.25', sst: '7.20', exclSst: '134.05' });
  const many = Array.from({ length: 10 }, () => ({ amountInclSst: '0.10', sstAmount: '0.01' }));
  assert.deepEqual(m.claimTotals(many), { total: '1.00', sst: '0.10', exclSst: '0.90' });     // 0.1 × 10 = 1.00 exactly (no float drift)
});
test('periods follow the limit-refresh day (BR-CLM-13)', () => {
  assert.deepEqual(m.monthPeriod('2027-11-15', 31), { from: '2027-11-01', to: '2027-11-30' });
  assert.deepEqual(m.monthPeriod('2027-11-26', 25), { from: '2027-11-26', to: '2027-12-25' });
  assert.deepEqual(m.monthPeriod('2027-11-25', 25), { from: '2027-10-26', to: '2027-11-25' });
  assert.deepEqual(m.monthPeriod('2027-02-10', 31), { from: '2027-02-01', to: '2027-02-28' });
  assert.deepEqual(m.monthPeriod('2027-03-01', 30), { from: '2027-03-01', to: '2027-03-30' });
  assert.deepEqual(m.monthPeriod('2028-03-01', 31), { from: '2028-03-01', to: '2028-03-31' });
  assert.deepEqual(m.yearPeriod('2027-06-01', 31), { from: '2027-01-01', to: '2027-12-31' });
  assert.deepEqual(m.yearPeriod('2027-12-26', 25), { from: '2027-12-26', to: '2028-12-25' });
  assert.equal(m.earliestTransactionDate('2027-03-01', 60), '2026-12-31');
});
test('limit evaluation — EC-CLM-01 / US-CLAIM-003 / US-CLAIM-008 messages', () => {
  const r = { appliesTo: 'everyone', perTransaction: '300.00', perMonth: null, perYear: null, behaviour: 'block' };
  const over = m.evaluateLimit(r, '350.00');
  assert.equal(over.message, 'Exceeds RM 300.00 per transaction');
  assert.equal(over.blocking, true); assert.equal(over.overBy, '50.00');
  assert.equal(m.evaluateLimit(r, '120.00').message, 'Within limit (RM 120.00 of RM 300.00)');
  assert.equal(m.evaluateLimit(r, '300.00').status, 'within');                         // equal to the limit is within
  const warn = m.evaluateLimit({ ...r, behaviour: 'warn' }, '350.00');
  assert.equal(warn.message, 'Over limit by RM 50.00 (warning)'); assert.equal(warn.blocking, false);
  const mo = { appliesTo: 'everyone', perTransaction: null, perMonth: '500.00', perYear: '1000.00', behaviour: 'block' };
  const cum = m.evaluateLimit(mo, '250.00', '300.00', '300.00');
  assert.equal(cum.basis, 'month'); assert.equal(cum.message, 'Exceeds RM 500.00 per month (over by RM 50.00)');
  assert.equal(m.evaluateLimit(mo, '100.00', '300.00', '850.00').message, 'Within limit (RM 950.00 of RM 1,000.00 this year)');
  assert.equal(m.evaluateLimit(null, '1.00').status, 'no_limit');
  assert.equal(m.evaluateLimit(r, '0.10', '0', '0').used, '0.10');
});
test('limit precedence employee > department > grade > group > everyone (BR-CLM-14)', () => {
  const facts = { employeeId: 'E1', departmentId: 'D1', gradeId: 'G1', groupIds: ['GR1'] };
  const base = { perTransaction: '300.00', perMonth: null, perYear: null, behaviour: 'block', effectiveFrom: '2020-01-01', effectiveTo: null };
  const all = [
    { ...base, appliesTo: 'everyone', targetId: null },
    { ...base, appliesTo: 'employee_group', targetId: 'GR1', perTransaction: '350.00' },
    { ...base, appliesTo: 'grade', targetId: 'G1', perTransaction: '400.00' },
    { ...base, appliesTo: 'department', targetId: 'D1', perTransaction: '450.00' },
    { ...base, appliesTo: 'employee', targetId: 'E1', perTransaction: '500.00' },
  ];
  assert.equal(m.pickLimit(all, facts, '2027-01-01')?.perTransaction, '500.00');
  assert.equal(m.pickLimit(all.slice(0, 4), facts, '2027-01-01')?.perTransaction, '450.00');
  assert.equal(m.pickLimit(all.slice(0, 3), facts, '2027-01-01')?.perTransaction, '400.00');
  assert.equal(m.pickLimit(all.slice(0, 2), facts, '2027-01-01')?.perTransaction, '350.00');
  assert.equal(m.pickLimit(all, { ...facts, employeeId: 'E2', departmentId: 'D2', gradeId: 'G2', groupIds: [] }, '2027-01-01')?.perTransaction, '300.00');
  assert.equal(m.pickLimit([{ ...base, appliesTo: 'everyone', targetId: null, effectiveTo: '2026-12-31' }], facts, '2027-01-01'), null);
  // US-CLAIM-003: category RM 300, employee-specific RM 500 → RM 450 within for that employee, blocked for another
  assert.equal(m.evaluateLimit(m.pickLimit(all.filter((x) => x.appliesTo === 'everyone' || x.appliesTo === 'employee'), facts, '2027-01-01'), '450.00').status, 'within');
  assert.equal(m.evaluateLimit(m.pickLimit(all.filter((x) => x.appliesTo === 'everyone'), facts, '2027-01-01'), '450.00').blocking, true);
});
test('limits summary text (C5)', () => {
  assert.equal(m.limitSummary({ perTransaction: '300.00', perMonth: null, perYear: null }), 'RM 300.00 / transaction');
  assert.equal(m.limitSummary({ perTransaction: null, perMonth: '1000', perYear: '5000.5' }), 'RM 1,000.00 / month · RM 5,000.50 / year');
  assert.equal(m.limitSummary(null), 'No limit');
});
