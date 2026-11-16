// Unit tests — src/lib/format/date.ts (FR-G-03: dd/mm/yyyy, dd/mm/yyyy HH:mm MYT).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, formatDate, formatDateTime, formatFileDate, formatMonth, isValidPlainDate, parseDate, todayMyt, toMytDate,
} from '../../src/lib/format/date.ts';

test('formatDate renders plain dates as dd/mm/yyyy without timezone shift', () => {
  assert.equal(formatDate('2027-03-05'), '05/03/2027');
  assert.equal(formatDate('2026-12-31'), '31/12/2026');
  assert.equal(formatDate('2027-02-30'), '');
  assert.equal(formatDate(null), '');
  assert.equal(formatDate(undefined), '');
  assert.equal(formatDate(''), '');
  assert.equal(formatDate('not a date'), '');
});

test('formatDate converts instants to the Malaysian calendar date', () => {
  // 16:30 UTC on 4 March = 00:30 MYT on 5 March
  assert.equal(formatDate(new Date('2027-03-04T16:30:00Z')), '05/03/2027');
  assert.equal(formatDate('2027-03-04T15:59:59Z'), '04/03/2027');
});

test('formatDateTime is 24-hour Malaysia time', () => {
  assert.equal(formatDateTime('2027-11-15T02:42:00Z'), '15/11/2027 10:42');
  assert.equal(formatDateTime(new Date('2027-11-15T15:05:09Z')), '15/11/2027 23:05');
  assert.equal(formatDateTime('2027-11-15T15:05:09Z', { seconds: true }), '15/11/2027 23:05:09');
  assert.equal(formatDateTime('2027-12-31T16:00:00Z'), '01/01/2028 00:00');
  assert.equal(formatDateTime(null), '');
});

test('formatMonth and formatFileDate', () => {
  assert.equal(formatMonth('2027-11-01'), 'Nov 2027');
  assert.equal(formatMonth('2027-01-31'), 'Jan 2027');
  assert.equal(formatFileDate('2027-03-05'), '05-03-2027');
});

test('parseDate accepts dd/mm/yyyy only and validates the calendar', () => {
  assert.equal(parseDate('05/03/2027'), '2027-03-05');
  assert.equal(parseDate('5/3/2027'), '2027-03-05');
  assert.equal(parseDate(' 29/02/2028 '), '2028-02-29');
  assert.equal(parseDate('29/02/2027'), null);
  assert.equal(parseDate('31/04/2027'), null);
  assert.equal(parseDate('2027-03-05'), null);   // ISO typed by a user: rejected (no guessing)
  assert.equal(parseDate('03/05/27'), null);
  assert.equal(parseDate('13/13/2027'), null);
  assert.equal(parseDate(''), null);
});

test('todayMyt / toMytDate switch at 00:00 MYT', () => {
  assert.equal(todayMyt(new Date('2027-01-01T15:59:59Z')), '2027-01-01');
  assert.equal(todayMyt(new Date('2027-01-01T16:00:00Z')), '2027-01-02');
  assert.equal(toMytDate('2027-06-30T23:00:00Z'), '2027-07-01');
});

test('plain-date helpers', () => {
  assert.equal(isValidPlainDate('2028-02-29'), true);
  assert.equal(isValidPlainDate('2027-02-29'), false);
  assert.equal(addDays('2027-12-31', 1), '2028-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
});
