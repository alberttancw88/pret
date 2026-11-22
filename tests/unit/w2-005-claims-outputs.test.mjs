// Unit tests — W2-005 output builders (src/server/lib/claims-outputs.ts): HLB payment list, D23 cheque/cash section,
// totals check, AutoCount postings column map (Q37 layout isolated), zip entry names.
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
const o = await import('../../src/server/lib/claims-outputs.ts');

const payee = (over) => ({ employeeId: 'e1', employeeNo: 'SMP-01', fullName: 'Sample One', workEmail: 's1@example.invalid', claimNos: ['CL-2027-00001'],
  amount: '100.10', paymentMethod: 'bank_transfer', bankName: 'Sample Bank', bankCode: 'SMPB', bic: 'SMPBMYKL', accountNo: '1234567890', accountLast4: '7890',
  accountHolderName: 'SAMPLE ONE', bankComplete: true, ...over });
const batch = { batchNo: 'PB-2027-011', disbursementMonth: '2027-11-01', total: '301.00' };

test('payment list: one line per employee, reference / description, D23 cheque-cash section excluded, totals reconcile to the sen', () => {
  const l = o.buildPaymentList([
    payee({}),
    payee({ employeeId: 'e2', employeeNo: 'SMP-02', fullName: 'Sample Two', amount: '200.25', paymentMethod: 'cheque', accountNo: null, bankComplete: false }),
    payee({ employeeId: 'e3', employeeNo: 'SMP-03', fullName: 'Sample Three', amount: '0.65', accountHolderName: 'S THREE', accountNo: '000111', accountLast4: '0111' }),
  ], batch);
  assert.equal(l.rows.length, 2);
  assert.equal(l.rows[0].paymentReference, 'CLAIM PB-2027-011');
  assert.equal(l.rows[0].paymentDescription, 'Claims reimbursement Nov 2027');
  assert.equal(l.rows[0].accountNo, '1234567890');
  assert.equal(l.rows[1].beneficiaryName, 'S THREE');
  assert.equal(l.chequeCash.length, 1); assert.equal(l.chequeCash[0].method, 'cheque');
  assert.deepEqual(l.totals, { hlb: '100.75', chequeCash: '200.25', batch: '301.00', matches: true });
});
test('payment list: totals mismatch and incomplete bank details are flagged (blocking)', () => {
  const bad = o.buildPaymentList([payee({ amount: '100.10' })], { ...batch, total: '100.11' });
  assert.equal(bad.totals.matches, false);
  const inc = o.buildPaymentList([payee({ bankComplete: false })], { ...batch, total: '100.10' });
  assert.equal(inc.incomplete.length, 1); assert.equal(inc.totals.matches, false); assert.equal(inc.rows.length, 0);
  const none = o.buildPaymentList([payee({ paymentMethod: null, bankComplete: false })], { ...batch, total: '100.10' });
  assert.equal(none.chequeCash.length, 1, 'no bank record → cheque/cash section (D23)');
});
test('payment list masked for the on-screen report (account numbers never shown in full on screen)', () => {
  const l = o.buildPaymentList([payee({ accountNo: null })], { ...batch, total: '100.10' }, { masked: true });
  assert.equal(l.rows[0].accountNo, '••••7890');
  assert.equal(l.totals.matches, true);
});
test('HLB column map — headers in the PRD §7.9 order', () => {
  assert.deepEqual(o.HLB_PAYMENT_LIST_LAYOUT.columns.map((c) => c.header), ['No.', 'Employee no.', 'Beneficiary name (account holder)', 'Bank', 'Bank code / BIC',
    'Account no.', 'Amount (RM)', 'Payment reference', 'Payment description', 'Beneficiary email', 'Claim nos.']);
  const l = o.buildPaymentList([payee({})], { ...batch, total: '100.10' });
  const t = o.tableOf(o.HLB_PAYMENT_LIST_LAYOUT, l.rows);
  assert.deepEqual(t.values[0], [1, 'SMP-01', 'SAMPLE ONE', 'Sample Bank', 'SMPBMYKL', '1234567890', '100.10', 'CLAIM PB-2027-011', 'Claims reimbursement Nov 2027', 's1@example.invalid', 'CL-2027-00001']);
  assert.equal(o.columnTotal(o.HLB_PAYMENT_LIST_LAYOUT, l.rows, 'amount'), '100.10');
});
test('AutoCount postings: one row per line, document date by setting, GL from the approval snapshot, totals exact', () => {
  const lines = [
    { claimNo: 'CL-2027-00001', lineNo: 1, employeeNo: 'SMP-01', employeeName: 'Sample One', approvedOn: '2027-11-03', disbursedOn: '2027-11-30', categoryName: 'Office Expenses',
      description: 'Printer paper TEST', glAccount: '6101-00', amountExclSst: '18.87', sst: '1.13', amountInclSst: '20.00', department: 'Development', costCentre: 'CC-DEV', batchNo: 'PB-2027-011' },
    { claimNo: 'CL-2027-00001', lineNo: 2, employeeNo: 'SMP-01', employeeName: 'Sample One', approvedOn: '2027-11-03', disbursedOn: null, categoryName: 'Employee Transport',
      description: null, glAccount: null, amountExclSst: '21.25', sst: '0.00', amountInclSst: '21.25', department: 'Development', costCentre: null, batchNo: null },
  ];
  const a = o.buildPostingRows(lines, { basis: 'approval', creditAccount: '2201-00' });
  assert.deepEqual(a.missingGl, ['Employee Transport']);
  assert.equal(a.rows[0].documentDate, '2027-11-03');
  assert.equal(a.rows[0].descriptionText, 'Office Expenses — Printer paper TEST');
  assert.equal(o.buildPostingRows(lines, { basis: 'disbursed', creditAccount: null }).rows[0].documentDate, '2027-11-30');
  assert.equal(o.buildPostingRows(lines, { basis: 'disbursed', creditAccount: null }).rows[1].documentDate, '2027-11-03', 'falls back to approval date');
  const t = o.tableOf(o.AUTOCOUNT_CLAIMS_LAYOUT, a.rows, { dateAsText: true });
  assert.deepEqual(t.headers, ['Document date', 'Document no.', 'Employee no.', 'Employee name', 'GL account', 'Description', 'Amount excl. SST', 'SST',
    'Amount incl. SST', 'Department / cost centre', 'Credit account', 'Batch no.']);
  assert.equal(t.values[0][0], '03/11/2027');
  assert.equal(t.values[1][9], 'Development', 'department when no cost centre');
  assert.equal(o.columnTotal(o.AUTOCOUNT_CLAIMS_LAYOUT, a.rows, 'amountInclSst'), '41.25');
  assert.equal(o.columnTotal(o.AUTOCOUNT_CLAIMS_LAYOUT, a.rows, 'sst'), '1.13');
  assert.equal(o.AUTOCOUNT_CLAIMS_LAYOUT.code, 'autocount_claims_postings');
});
test('money sums are exact (0.1 + 0.2 = 0.30) and month labels', () => {
  assert.equal(o.sumMoney(['0.10', '0.20']), '0.30');
  assert.equal(o.sumMoney(Array(1000).fill('0.01')), '10.00');
  assert.equal(o.monthLabel('2027-11-01'), 'Nov 2027');
  assert.equal(o.monthLabel('2028-01-01', true), 'January 2028');
  assert.equal(o.maskAccount('1234'), '••••1234');
});
test('zip entry names <claim no.>-<line>-<n>.<ext> (FR-CLM-10)', () => {
  assert.equal(o.bundleEntryName('CL-2027-00001', 2, 1, 'IMG_0001.HEIC', 'image/heic'), 'CL-2027-00001-2-1.heic');
  assert.equal(o.bundleEntryName('CL-2027-00001', 1, 3, 'scan', 'application/pdf'), 'CL-2027-00001-1-3.pdf');
});
