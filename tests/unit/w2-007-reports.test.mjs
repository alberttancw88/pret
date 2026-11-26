// Unit tests — W2-007 M7 reports: exact totals (ADR-0006, reconcile to the sen / ½ day), search / sort / page with totals over the
// whole filtered set, people metrics, the payroll-input pack Reversal rule (EC-LV-14), export cell formatting and the contract
// (role scoping of the catalogue, a param schema per report, no claims sheet — D16).
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
const e = await import('../../src/server/lib/report-engine.ts');
const c = await import('../../src/server/contracts/reports.ts');

const row = (id, cells, extra = {}) => ({ id, cells, href: null, ...extra });

test('money totals are exact to the sen (no float drift) and handle negatives / bad input', () => {
  assert.equal(e.sumMoney(['0.10', '0.20']), '0.30');
  assert.equal(e.sumMoney(Array(1000).fill('0.01')), '10.00');
  assert.equal(e.sumMoney(['1234.56', '-0.56', '1', null, '', 'abc']), '1235.00');
  assert.equal(e.fromSen(e.sen('-12.3')), '-12.30');
  assert.equal(e.sen('10.005'), 1001);
  assert.equal(e.sumMoney([]), '0.00');
});

test('day totals are exact to the ½ day and print with 1 decimal', () => {
  assert.equal(e.sumDays(['0.5', '0.5', '1.0', 2]), '4.0');
  assert.equal(e.sumDays(Array(3).fill('0.1')), '0.3');
  assert.equal(e.days1('8'), '8.0');
  assert.equal(e.days1(null), '0.0');
});

test('reconciliation: summary totals cover the WHOLE filtered set, not just the page', () => {
  const columns = [c.REPORT_FORMATS && { key: 'name', label: 'Name', format: 'text', sortable: true }, { key: 'amt', label: 'Amount', format: 'money', sortable: true }];
  const rows = Array.from({ length: 60 }, (_, i) => row(String(i), { name: `Emp ${String(i).padStart(2, '0')}`, amt: '10.05' }));
  const filtered = e.searchRows(rows, 'emp 1', ['name']);   // Emp 10…19
  assert.equal(filtered.length, 10);
  const page = e.pageRows(filtered, 1, 4, false);
  assert.equal(page.length, 4);
  assert.equal(e.sumMoney(filtered.map((r) => r.cells.amt)), '100.50');
  assert.equal(e.pageRows(filtered, 3, 4, false).length, 2);
  assert.equal(e.pageRows(filtered, 1, 4, true).length, 10);    // exports: all rows
  const sorted = e.sortRows(rows.slice(0, 5).map((r, i) => row(r.id, { ...r.cells, amt: ['9.00', '10.00', '100.00', null, '2.50'][i] })), columns, 'amt', 'asc');
  assert.deepEqual(sorted.map((r) => r.cells.amt), ['2.50', '9.00', '10.00', '100.00', null]);  // numeric, blanks last
  const desc = e.sortRows(sorted, columns, 'amt', 'desc');
  assert.equal(desc[0].cells.amt, '100.00');
  assert.equal(desc.at(-1).cells.amt, null);
});

test('grouped sort keeps department groups together (Leave balances)', () => {
  const cols = [{ key: 'emp', label: 'Employee', format: 'text', sortable: true }];
  const rows = [row('1', { emp: 'Zed' }, { group: 'Sales' }), row('2', { emp: 'Amy' }, { group: 'Sales' }), row('3', { emp: 'Bob' }, { group: 'Finance' })];
  assert.deepEqual(e.sortRows(rows, cols, 'emp', 'asc', true).map((r) => r.cells.emp), ['Bob', 'Amy', 'Zed']);
});

test('people metrics: turnover, share, ageing buckets, ages and service dates', () => {
  assert.equal(e.turnoverPct(3, 50, 54), '5.8');
  assert.equal(e.turnoverPct(1, 0, 0), null);
  assert.equal(e.pct(1, 3), '33.3');
  assert.deepEqual(e.ageingBuckets([{ ageDays: 0, amount: '10.10' }, { ageDays: 30, amount: '0.90' }, { ageDays: 31, amount: '5' }, { ageDays: 61, amount: '1.01' }]),
    { d0_30: { count: 2, amount: '11.00' }, d31_60: { count: 1, amount: '5.00' }, over60: { count: 1, amount: '1.01' } });
  assert.equal(e.completedYears('1966-11-27', '2026-11-26'), 59);
  assert.equal(e.completedYears('1966-11-26', '2026-11-26'), 60);
  assert.equal(e.addYears('1964-02-29', 60), '2024-02-29');
  assert.equal(e.addYears('1965-02-28', 1), '1966-02-28');
  assert.equal(e.addYears('2000-02-29', 1), '2001-02-28');
  assert.deepEqual(e.monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(e.monthsBetween('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.equal(e.monthLabel('2026-11'), 'November 2026');
  assert.equal(e.monthLabel('2026-11', true), 'Nov 2026');
});

test('payroll-input pack (EC-LV-14): cancelled or shortened unpaid leave exported earlier produces one Reversal line', () => {
  const prev = [
    { applicationId: 'a1', refNo: 'LV-1', month: '2026-10', days: '2.0' },     // later cancelled → -2.0
    { applicationId: 'a2', refNo: 'LV-2', month: '2026-10', days: '3.0' },     // shortened to 1.0 → -2.0
    { applicationId: 'a3', refNo: 'LV-3', month: '2026-10', days: '1.0' },     // unchanged → nothing
    { applicationId: 'a4', refNo: 'LV-4', month: '2026-09', days: '1.0' },     // cancelled but already reversed in Oct pack → nothing
    { applicationId: 'a4', refNo: 'LV-4', month: '2026-09', days: '-1.0', reversal: true },
    { applicationId: 'a5', refNo: 'LV-5', month: '2026-11', days: '1.0' },     // same month (re-export) → handled by the current list, not reversed
    { applicationId: 'a1', refNo: 'LV-1', month: '2026-10', days: '2.0' },     // exported twice (v1, v2) → reversed once
  ];
  const now = [
    { applicationId: 'a1', month: '2026-10', days: '2', status: 'cancelled' },
    { applicationId: 'a2', month: '2026-10', days: '1', status: 'approved' },
    { applicationId: 'a3', month: '2026-10', days: '1', status: 'approved' },
    { applicationId: 'a4', month: '2026-09', days: '1', status: 'cancelled' },
    { applicationId: 'a5', month: '2026-11', days: '0', status: 'cancelled' },
  ];
  assert.deepEqual(e.unpaidReversals(prev, now, '2026-11'), [
    { applicationId: 'a1', refNo: 'LV-1', month: '2026-10', days: '-2.0', reversal: true },
    { applicationId: 'a2', refNo: 'LV-2', month: '2026-10', days: '-2.0', reversal: true },
  ]);
  assert.deepEqual(e.unpaidReversals([], now, '2026-11'), []);
});

test('export cells: dd/mm/yyyy, MYT date-time, money 2 dp, days 1 dp, Yes/No, lists joined', () => {
  assert.equal(e.exportCell('2026-11-26', 'date'), '26/11/2026');
  assert.equal(e.exportCell('2026-11-25T16:30:00.000Z', 'datetime'), '26/11/2026 00:30');
  assert.equal(e.exportCell('1234.5', 'money'), '1234.50');
  assert.equal(e.exportCell('2', 'days'), '2.0');
  assert.equal(e.exportCell(true, 'bool'), 'Yes');
  assert.equal(e.exportCell(false, 'bool'), 'No');
  assert.equal(e.exportCell(['a', 'b'], 'list'), 'a; b');
  assert.equal(e.exportCell(null, 'text'), null);
  assert.equal(e.dmy('2026-01-05'), '05/01/2026');
});

test('contract: one param schema per report; defaults; MGR only on its 4 team reports; EMP only on the individual leave report', () => {
  for (const id of c.REPORT_IDS) {
    assert.ok(c.REPORT_PARAM_SCHEMAS[id], id);
    assert.equal(c.REPORT_CATALOGUE[id].id, id);
    assert.equal(c.REPORT_CATALOGUE[id].path, `/reports/${id}`);
    const p = c.REPORT_PARAM_SCHEMAS[id].parse({});
    assert.equal(p.page, 1); assert.equal(p.pageSize, 25); assert.equal(p.run, false);
  }
  const mgr = c.REPORT_IDS.filter((id) => c.REPORT_CATALOGUE[id].roles.includes('MGR')).sort();
  assert.deepEqual(mgr, ['leave-balances', 'leave-individual', 'probation-due', 'whos-on-leave']);
  assert.deepEqual(c.REPORT_IDS.filter((id) => c.REPORT_CATALOGUE[id].roles.includes('EMP')), ['leave-individual']);
  assert.equal(c.REPORT_CATALOGUE['sick-hospitalisation'].sensitive, 'always');
  assert.equal(c.REPORT_CATALOGUE['employee-master'].sensitive, 'when_sensitive_columns');
  assert.equal(c.PAYROLL_INPUT_CARD.sensitive, 'always');
});

test('contract: employee-master fields — default columns exist, every sensitive group is flagged, keys unique', () => {
  const keys = c.EMPLOYEE_MASTER_FIELDS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of c.EMPLOYEE_MASTER_DEFAULT_COLUMNS) assert.ok(keys.includes(k), k);
  assert.ok(c.EMPLOYEE_MASTER_DEFAULT_COLUMNS.every((k) => !c.EMPLOYEE_MASTER_FIELDS.find((f) => f.key === k).sensitive), 'default columns are non-sensitive');
  const sens = (k) => c.EMPLOYEE_MASTER_FIELDS.find((f) => f.key === k).sensitive;
  assert.equal(sens('mykad'), 'mykad'); assert.equal(sens('religion'), 'religion'); assert.equal(sens('isOku'), 'oku');
  assert.equal(sens('bankAccountNo'), 'bank'); assert.equal(sens('epfNo'), 'statutory'); assert.equal(sens('spouseName'), 'family');
  const p = c.employeeMasterParamsSchema.parse({ columns: 'employeeNo,mykad', statuses: ['confirmed'] });
  assert.deepEqual(p.columns, ['employeeNo', 'mykad']);
});

test('contract: payroll-input pack has no claims sheet (D16); filters validate', () => {
  assert.ok(!c.PAYROLL_INPUT_SHEETS.some((s) => s.includes('claim')));
  assert.equal(c.PAYROLL_INPUT_SHEETS.length, 7);
  assert.match(c.PAYROLL_INPUT_NO_CLAIMS_NOTE, /No claims sheet/);
  assert.equal(c.exportPayrollInputSchema.safeParse({ month: '2026-13', format: 'xlsx' }).success, false);
  assert.equal(c.exportPayrollInputSchema.safeParse({ month: '2026-11', format: 'pdf' }).success, false);
  assert.equal(c.probationDueParamsSchema.safeParse({ withinDays: 45 }).success, false);
  assert.equal(c.probationDueParamsSchema.parse({ withinDays: '14' }).withinDays, 14);
  assert.equal(c.exportReportSchema.safeParse({ reportId: 'nope', format: 'csv' }).success, false);
});
