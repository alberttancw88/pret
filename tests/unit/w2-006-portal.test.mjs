// Unit tests — W2-006 portal: contract helpers (notification categories, preference groups, password rule, list params)
// and the "Download my data" builders (src/server/lib/my-data-export.ts). Synthetic data only.
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
const c = await import('../../src/server/contracts/portal.ts');
const x = await import('../../src/server/lib/my-data-export.ts');

test('notification categories follow the PRD §12.2 ranges', () => {
  assert.equal(c.notificationCategory('N-01'), 'leave');
  assert.equal(c.notificationCategory('N-18'), 'leave');
  assert.equal(c.notificationCategory('N-20'), 'claims');
  assert.equal(c.notificationCategory('N-59'), 'claims');
  assert.equal(c.notificationCategory('N-60'), 'claims');
  assert.equal(c.notificationCategory('N-32'), 'payroll');
  assert.equal(c.notificationCategory('N-41'), 'profile');
  assert.equal(c.notificationCategory('N-55'), 'system');
  assert.equal(c.notificationCategory('garbage'), 'system');
});

test('mandatory email codes = the database list (app.notification_email_mandatory, role matrix P8)', () => {
  assert.deepEqual(c.MANDATORY_EMAIL_EVENT_CODES,
    ['N-01', 'N-05', 'N-11', 'N-14', 'N-15', 'N-16', 'N-20', 'N-26', 'N-41', 'N-43', 'N-52', 'N-53', 'N-54', 'N-57']);
  const keys = c.NOTIFICATION_PREFERENCE_GROUPS.map((g) => g.key);
  assert.equal(new Set(keys).size, keys.length, 'group keys are unique');
  const codes = c.NOTIFICATION_PREFERENCE_GROUPS.flatMap((g) => g.eventCodes);
  assert.equal(new Set(codes).size, codes.length, 'an event code belongs to one group only');
  for (const g of c.NOTIFICATION_PREFERENCE_GROUPS) for (const code of g.eventCodes) assert.equal(c.notificationCategory(code), g.category, `${code} in ${g.key}`);
});

test('change password: 12-character rule, confirmation, different from current', () => {
  const ok = c.changePasswordSchema.safeParse({ currentPassword: 'Old-Passw0rd!x', newPassword: 'New-Passw0rd!xy', confirmPassword: 'New-Passw0rd!xy' });
  assert.equal(ok.success, true);
  const short = c.changePasswordSchema.safeParse({ currentPassword: 'a', newPassword: 'Sh0rt!pass', confirmPassword: 'Sh0rt!pass' });
  assert.equal(short.success, false);
  assert.equal(short.error.issues[0].path[0], 'newPassword');
  const mismatch = c.changePasswordSchema.safeParse({ currentPassword: 'a', newPassword: 'New-Passw0rd!xy', confirmPassword: 'New-Passw0rd!xz' });
  assert.equal(mismatch.success, false);
  assert.equal(mismatch.error.issues[0].path[0], 'confirmPassword');
  const same = c.changePasswordSchema.safeParse({ currentPassword: 'New-Passw0rd!xy', newPassword: 'New-Passw0rd!xy', confirmPassword: 'New-Passw0rd!xy' });
  assert.equal(same.success, false);
  assert.equal(same.error.issues[0].path[0], 'newPassword');
  const noSymbol = c.changePasswordSchema.safeParse({ currentPassword: 'a', newPassword: 'NewPassw0rdxyz', confirmPassword: 'NewPassw0rdxyz' });
  assert.equal(noSymbol.success, false);
});

test('notification list params: newest first, filters parsed, bad dates ignored', () => {
  const p = c.notificationListParamsSchema.parse({ categories: 'leave,claims', read: 'unread', dateFrom: 'x' });
  assert.equal(p.dir, 'desc');
  assert.deepEqual(p.categories, ['leave', 'claims']);
  assert.equal(p.read, 'unread');
  assert.equal(p.dateFrom, undefined);
  assert.equal(p.pageSize, 25);
  assert.equal(c.markNotificationSchema.parse({ id: '00000000-0000-4000-8000-000000000001', read: 'false' }).read, false);
  assert.equal(c.markNotificationSchema.parse({ id: '00000000-0000-4000-8000-000000000001' }).read, true);
});

test('holiday params: year optional, types multi', () => {
  const p = c.myHolidaysParamsSchema.parse({ year: '2027', types: 'national,replacement' });
  assert.equal(p.year, 2027);
  assert.deepEqual(p.types, ['national', 'replacement']);
  assert.equal(c.myHolidaysParamsSchema.parse({ year: 'abc' }).year, undefined);
});

// ---------------------------------------------------------------------------
// Download my data builders
// ---------------------------------------------------------------------------
const doc = () => ({
  format: 'PRET my-data export', formatVersion: 1, generatedAt: '2026-11-23T02:30:00.000Z', company: 'Example Company Sdn Bhd (TEST)',
  employee: { employee_no: 'SMP-01', full_name: 'Sample Employee One', gender: 'female', status: 'confirmed', join_date: '2020-01-02', department: 'Development' },
  personal: { nric: '900101-14-0001', date_of_birth: '1990-01-01', res_addr_line1: '1 Jalan Contoh', res_postcode: '50000', res_city: 'Kuala Lumpur', res_state: 'KUL', res_country: 'Malaysia', mailing_same_as_residential: true },
  sensitive: { religion: 'none', is_oku: false, oku_card_no: null },
  maritalHistory: [{ marital_status: 'single', effective_date: '2020-01-02' }],
  emergencyContacts: [{ priority: 1, name: 'Sample Contact', relationship: 'parent', mobile_phone: '+60120000001' }],
  spouses: [], children: [{ id: 'c1', full_name: 'Sample Child', nric: null, date_of_birth: '2015-05-05' }],
  statutory: { income_tax_no: 'SG00000000000', epf_no: '00000000', pay_zakat: false },
  bankAccounts: [{ id: 'b1', payment_method: 'bank_transfer', bank: 'Sample Bank', account_no: '9900000000001', effective_from: '2020-01-02' }],
  jobHistory: [{ effective_date: '2020-01-02', change_type: 'new_hire', department: 'Development' }],
  separations: [], priorEmployments: [], documents: [{ title: 'Offer letter (TEST)', category: 'offer_letter' }],
  changeRequests: [{ cr_no: 'CR-2026-00001', items: [{ field: 'Mobile' }, { field: 'Email' }] }],
  leave: { applications: [{ ref_no: 'LV-2026-00001', start_date: '2026-03-02', days: '1.0' }], ledger: [{ entry_type: 'entitlement', days: '14.0' }], replacementCredits: [], balances: null },
  claims: [{ claim_no: 'CL-2026-00001', total_amount: '21.25', lines: [{ line_no: 1, amount_incl_sst: '21.25' }, { line_no: 2, amount_incl_sst: '0.00' }] }],
  payslips: 'R1.1',
});

test('my-data file name: employee no. + dd-mm-yyyy, no personal names', () => {
  assert.equal(x.myDataFileName('SMP-01', '2026-11-23T02:30:00.000Z'), 'my-data-SMP-01-23-11-2026.zip');
  assert.equal(x.myDataFileName('SMP 01/../x', '2026-11-23T02:30:00.000Z'), 'my-data-SMP01x-23-11-2026.zip');
});

test('my-data record count covers every section incl. claim lines and CR items', () => {
  // employee 1 + personal 1 + sensitive 1 + statutory 1 + marital 1 + contacts 1 + children 1 + bank 1 + jobs 1 + documents 1
  // + CR 1 + CR items 2 + leave apps 1 + ledger 1 + claims 1 + lines 2 = 18
  assert.equal(x.myDataRecordCount(doc()), 18);
});

test('my-data JSON keeps the full identifiers (own data) and is valid JSON', () => {
  const j = JSON.parse(x.myDataJson(doc()));
  assert.equal(j.personal.nric, '900101-14-0001');
  assert.equal(j.bankAccounts[0].account_no, '9900000000001');
  assert.equal(j.formatVersion, 1);
});

test('my-data summary: dd/mm/yyyy dates, readable enums, every section present', () => {
  const s = x.buildMyDataSummary(doc());
  const h = Object.fromEntries(s.header);
  assert.equal(h['MyKad no.'], '900101-14-0001');
  assert.equal(h['Date of birth'], '01/01/1990');
  assert.equal(h['Gender'], 'Female');
  assert.equal(h['Mailing address'], 'Same as residential');
  assert.equal(h['Generated'].startsWith('23/11/2026 10:30'), true);
  const titles = s.sections.map((x2) => x2.title);
  for (const t of ['Emergency contacts', 'Spouses', 'Children', 'Bank and payment details', 'Job history', 'Leave applications', 'Claims', 'Claim lines']) {
    assert.ok(titles.includes(t), t);
  }
  const lines = s.sections.find((x2) => x2.title === 'Claim lines');
  assert.equal(lines.rows.length, 2);
  assert.equal(lines.rows[0].claim_no, 'CL-2026-00001');
  assert.ok(s.sections.every((x2) => x2.emptyText));
  assert.equal(x.display('2026-03-02'), '02/03/2026');
  assert.equal(x.display('bank_transfer', { enumLike: true }), 'Bank transfer');
  assert.equal(x.display(true), 'Yes');
});

test('my-data README tells the employee to keep the file private', () => {
  const r = x.myDataReadme(doc());
  assert.match(r, /Keep it private/);
  assert.match(r, /SMP-01/);
  assert.doesNotMatch(r, /900101/);
});
