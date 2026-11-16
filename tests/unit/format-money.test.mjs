// Unit tests — src/lib/format/money.ts (FR-G-04: RM 1,234.56; ADR-0006: no float maths).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareMoney, formatAmount, formatDays, formatMoney, formatRatePerKm, parseMoney, sumMoney, toDecimalString, toSen,
} from '../../src/lib/format/money.ts';

const NBSP = ' ';
const MINUS = '−';

test('formatMoney (screen) uses RM + no-break space and U+2212 minus', () => {
  assert.equal(formatMoney('1234.56'), `RM${NBSP}1,234.56`);
  assert.equal(formatMoney('0'), `RM${NBSP}0.00`);
  assert.equal(formatMoney('-12'), `${MINUS}RM${NBSP}12.00`);
  assert.equal(formatMoney('1234567.8'), `RM${NBSP}1,234,567.80`);
  assert.equal(formatMoney('999'), `RM${NBSP}999.00`);
  assert.equal(formatMoney(1000), `RM${NBSP}1,000.00`);
  assert.equal(formatMoney(null), '');
  assert.equal(formatMoney('abc'), '');
});

test('formatMoney plain (CSV / PDF / email) is ASCII "RM 1,234.56"', () => {
  assert.equal(formatMoney('1234.56', { plain: true }), 'RM 1,234.56');
  assert.equal(formatMoney('-1234.5', { plain: true }), '-RM 1,234.50');
  assert.equal(formatMoney('-0.001', { plain: true }), 'RM 0.00');     // rounds to zero: no sign
});

test('formatAmount for table cells', () => {
  assert.equal(formatAmount('1234.56'), '1,234.56');
  assert.equal(formatAmount('-12'), `${MINUS}12.00`);
  assert.equal(formatAmount('-12', { plain: true }), '-12.00');
});

test('rounding is half away from zero at 2 dp, exactly (no float error)', () => {
  assert.equal(toDecimalString('1.005'), '1.01');        // float would give 1.00
  assert.equal(toDecimalString('2.675'), '2.68');        // float would give 2.67
  assert.equal(toDecimalString('-1.005'), '-1.01');
  assert.equal(toDecimalString('1.004999'), '1.00');
  assert.equal(toDecimalString(0.1 + 0.2), '0.30');
  assert.equal(toDecimalString(1e21), '1000000000000000000000.00');
  assert.equal(toDecimalString(5e-7), '0.00');
  assert.equal(toSen('12.34'), 1234n);
  assert.throws(() => toSen('12,34'));
  assert.throws(() => toSen(Number.NaN));
});

test('sumMoney adds exactly in sen', () => {
  assert.equal(sumMoney(['0.10', '0.20', '0.30']), '0.60');
  assert.equal(sumMoney(Array.from({ length: 1000 }, () => '0.01')), '10.00');
  assert.equal(sumMoney(['100.00', '-0.01', null, '']), '99.99');
  assert.equal(compareMoney('10.00', '9.99'), 1);
  assert.equal(compareMoney('10', '10.00'), 0);
});

test('parseMoney accepts the documented input forms and rejects the rest', () => {
  assert.equal(parseMoney('1234.56'), '1234.56');
  assert.equal(parseMoney('1,234.56'), '1234.56');
  assert.equal(parseMoney('RM 1,234.56'), '1234.56');
  assert.equal(parseMoney(`RM${NBSP}1,234.5`), '1234.50');
  assert.equal(parseMoney('rm12'), '12.00');
  assert.equal(parseMoney('-RM 12'), '-12.00');
  assert.equal(parseMoney(`${MINUS}12.00`), '-12.00');
  assert.equal(parseMoney('0'), '0.00');
  assert.equal(parseMoney('12.345'), null);       // max 2 dp
  assert.equal(parseMoney('1,23.45'), null);      // malformed grouping
  assert.equal(parseMoney('12a'), null);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('--5'), null);
  assert.equal(parseMoney(null), null);
});

test('formatDays shows 1 dp', () => {
  assert.equal(formatDays(12.5), '12.5 days');
  assert.equal(formatDays('8'), '8.0 days');
  assert.equal(formatDays(8.5, 'd'), `8.5${NBSP}d`);
  assert.equal(formatDays(-1.5), `${MINUS}1.5 days`);
  assert.equal(formatDays('0.25'), '0.3 days');
});

test('formatRatePerKm shows 3 dp', () => {
  assert.equal(formatRatePerKm('0.6', { plain: true }), 'RM 0.600/km');
  assert.equal(formatRatePerKm('0.6555', { plain: true }), 'RM 0.656/km');
});
