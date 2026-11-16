// Unit tests — W2-002 contract schemas (src/server/contracts/{common,org,users}.ts). Synthetic values only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// The contracts use extensionless relative imports (bundler resolution); map them to .ts for Node.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (e) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw e;
    }
  },
});

const org = await import('../../src/server/contracts/org.ts');
const users = await import('../../src/server/contracts/users.ts');
const csv = await import('../../src/server/lib/csv.ts');

const addr = { line1: 'Level 1, Example Tower', postcode: '50000', city: 'Kuala Lumpur', state: 'KUL' };

test('codes are trimmed, upper-cased and restricted', () => {
  const ok = org.departmentInputSchema.parse({ code: ' dev ', name: 'Development' });
  assert.equal(ok.code, 'DEV');
  assert.equal(ok.isActive, true);
  assert.equal(ok.parentId, null);
  assert.equal(org.departmentInputSchema.safeParse({ code: 'TOO-LONG-CODE', name: 'x' }).success, false);
  assert.equal(org.departmentInputSchema.safeParse({ code: 'A B', name: 'x' }).success, false);
  assert.equal(org.departmentInputSchema.safeParse({ code: 'OK', name: '' }).success, false);
  assert.equal(org.departmentInputSchema.parse({ code: 'OK', name: 'x', parentId: '' }).parentId, null);
});

test('company registration validates SSM number and address blocks', () => {
  const base = { legalName: 'Example Sdn Bhd', ssmNoNew: '202601000001', registeredAddress: addr, businessAddress: addr };
  const ok = org.saveCompanyRegistrationSchema.parse(base);
  assert.equal(ok.registeredAddress.country, 'Malaysia');
  assert.equal(ok.ssmNoOld, null);
  assert.equal(org.saveCompanyRegistrationSchema.safeParse({ ...base, ssmNoNew: '12345' }).success, false);
  const badPost = org.saveCompanyRegistrationSchema.safeParse({ ...base, businessAddress: { ...addr, postcode: '5000' } });
  assert.equal(badPost.success, false);
  assert.deepEqual(badPost.error.issues[0].path, ['businessAddress', 'postcode']);
  assert.equal(org.saveCompanyRegistrationSchema.safeParse({ ...base, registeredAddress: { ...addr, state: 'XX' } }).success, false);
});

test('statutory numbers: formats and HRDF levy rule', () => {
  const ok = org.saveCompanyStatutorySchema.parse({ epfEmployerNo: '123456789', lhdnENo: 'e1234567890', hrdfRegistered: 'false', hrdfLevyRatePct: '' });
  assert.equal(ok.lhdnENo, 'E1234567890');
  assert.equal(ok.hrdfLevyRatePct, null);
  assert.equal(org.saveCompanyStatutorySchema.safeParse({ epfEmployerNo: '1234567890', hrdfRegistered: false }).success, false);
  assert.equal(org.saveCompanyStatutorySchema.safeParse({ lhdnENo: 'X123', hrdfRegistered: false }).success, false);
  assert.equal(org.saveCompanyStatutorySchema.safeParse({ hrdfRegistered: true }).success, false);
  assert.equal(org.saveCompanyStatutorySchema.parse({ hrdfRegistered: true, hrdfLevyRatePct: '0.5' }).hrdfLevyRatePct, 0.5);
  assert.equal(org.saveCompanyStatutorySchema.safeParse({ hrdfRegistered: false, hrdfLevyRatePct: 1 }).success, false);
});

test('paying account number: digits only, blank keeps the stored number', () => {
  assert.equal(org.savePayingAccountSchema.parse({ accountName: 'Example', accountNo: '123-4567 890' }).accountNo, '1234567890');
  assert.equal(org.savePayingAccountSchema.parse({ accountName: 'Example', accountNo: '' }).accountNo, '');
  assert.equal(org.savePayingAccountSchema.safeParse({ accountName: 'Example', accountNo: '12AB' }).success, false);
});

test('contact website must be http(s)', () => {
  assert.equal(org.updateCompanyContactSchema.safeParse({ website: 'javascript:alert(1)', version: 1 }).success, false);
  assert.equal(org.updateCompanyContactSchema.parse({ website: 'https://example.invalid', email: 'HR@Example.Invalid', version: '2' }).email, 'hr@example.invalid');
});

test('zakat registrations: unique body per company', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(org.saveZakatRegistrationsSchema.safeParse({ rows: [{ zakatBodyId: id, employerRef: 'A' }, { zakatBodyId: id, employerRef: 'B' }] }).success, false);
});

test('working pattern versions need a rest day and one-decimal hours', () => {
  const v = { effectiveFrom: '2027-01-01', mon: 'full', tue: 'full', wed: 'full', thu: 'full', fri: 'full', sat: 'off', sun: 'rest', hoursPerFullDay: '8', monthDayBasis: 'fixed_26' };
  assert.equal(org.patternVersionInputSchema.parse(v).hoursPerFullDay, 8);
  const noRest = org.patternVersionInputSchema.safeParse({ ...v, sun: 'off' });
  assert.equal(noRest.success, false);
  assert.match(noRest.error.issues[0].message, /rest day/);
  assert.equal(org.patternVersionInputSchema.safeParse({ ...v, hoursPerFullDay: 7.25 }).success, false);
  assert.equal(org.patternVersionInputSchema.safeParse({ ...v, effectiveFrom: '2027-02-30' }).success, false);
  assert.equal(org.createWorkingPatternSchema.safeParse({ name: 'x'.repeat(61), version: v }).success, false);
});

test('holidays: date within year, at least one state, no manual replacement type', () => {
  const h = { year: 2027, holidayDate: '2027-08-31', name: 'Synthetic', holidayType: 'national', states: ['SGR'] };
  const ok = org.createHolidaySchema.parse(h);
  assert.equal(ok.isObserved, true);
  assert.equal(ok.compulsory, null);
  assert.equal(org.createHolidaySchema.safeParse({ ...h, holidayDate: '2028-01-01' }).success, false);
  assert.equal(org.createHolidaySchema.safeParse({ ...h, states: [] }).success, false);
  assert.equal(org.createHolidaySchema.safeParse({ ...h, holidayType: 'replacement' }).success, false);
  assert.equal(org.createHolidaySchema.safeParse({ ...h, compulsory: 'not_a_value' }).success, false);
});

test('holiday list params accept URL-style values', () => {
  const p = org.holidayListParamsSchema.parse({ year: '2027', states: 'SGR,KUL', types: ['national'], page: '2' });
  assert.deepEqual(p.states, ['SGR', 'KUL']);
  assert.equal(p.page, 2);
  assert.equal(p.pageSize, 25);
  assert.equal(org.holidayListParamsSchema.safeParse({ year: '1999' }).success, false);
});

test('system settings: EA notice floors, timeout ordering and retention minimums', () => {
  assert.equal(org.saveProbationNoticeSettingsSchema.safeParse({ defaultProbationMonths: 3, maxProbationMonths: 12, noticeWeeksLt2: 2, noticeWeeks2to5: 6, noticeWeeksGe5: 8, inviteLeadDays: 3 }).success, false);
  assert.equal(org.saveProbationNoticeSettingsSchema.safeParse({ defaultProbationMonths: 6, maxProbationMonths: 3, noticeWeeksLt2: 4, noticeWeeks2to5: 6, noticeWeeksGe5: 8, inviteLeadDays: 3 }).success, false);
  const sec = { allowedEmailDomains: ['Example.com'], idleTimeoutMinEmployee: 30, idleTimeoutMinPrivileged: 15, lockoutThreshold: 5, lockoutMinutes: 30, mfaRequiredPrivileged: 'true', inviteLinkHours: 72 };
  assert.deepEqual(org.saveSignInSecuritySettingsSchema.parse(sec).allowedEmailDomains, ['example.com']);
  assert.equal(org.saveSignInSecuritySettingsSchema.safeParse({ ...sec, idleTimeoutMinPrivileged: 45 }).success, false);
  assert.equal(org.saveSignInSecuritySettingsSchema.safeParse({ ...sec, allowedEmailDomains: ['not a domain'] }).success, false);
  assert.equal(org.saveRetentionSettingsSchema.safeParse({ retentionYearsHr: 6, retentionYearsPayroll: 7, retentionYearsAudit: 7, retentionDaysImportFiles: 30 }).success, false);
  assert.equal(org.saveApprovalSettingsSchema.safeParse({ reminderAfterWorkingDays: 5, escalateAfterWorkingDays: 5, saBatchApprovalRequired: false }).success, false);
});

test('company asset uploads: PNG/JPEG only (no SVG), ≤ 10 MB', () => {
  assert.equal(org.requestCompanyAssetUploadSchema.safeParse({ kind: 'logo', fileName: 'logo.svg', mimeType: 'image/svg+xml', sizeBytes: 100 }).success, false);
  assert.equal(org.requestCompanyAssetUploadSchema.safeParse({ kind: 'logo', fileName: 'logo.png', mimeType: 'image/png', sizeBytes: 11 * 1024 * 1024 }).success, false);
  assert.equal(org.requestCompanyAssetUploadSchema.safeParse({ kind: 'signature', fileName: 's.png', mimeType: 'image/png', sizeBytes: 100 }).success, true);
});

test('invite: external administrator needs provider and an ordered access window', () => {
  const ext = { userType: 'external', loginEmail: ' Admin@Example.Invalid ', displayName: 'Synthetic Admin', serviceProvider: 'Example Outsourcing', accessStartDate: '2027-01-01', accessEndDate: '2027-12-31' };
  const ok = users.inviteUserSchema.parse(ext);
  assert.equal(ok.loginEmail, 'admin@example.invalid');
  assert.equal(users.inviteUserSchema.safeParse({ ...ext, serviceProvider: '' }).success, false);
  assert.equal(users.inviteUserSchema.safeParse({ ...ext, accessEndDate: '2026-12-31' }).success, false);
  const { accessEndDate, ...noEnd } = ext;
  assert.equal(users.inviteUserSchema.safeParse(noEnd).success, false);
  const emp = users.inviteUserSchema.safeParse({ userType: 'employee', employeeId: '11111111-1111-4111-8111-111111111111', accessStartDate: '2027-01-01', sendMode: 'schedule' });
  assert.equal(emp.success, false);
  assert.equal(users.inviteUserSchema.safeParse({ userType: 'other' }).success, false);
});

test('roles: only ADM / SA, de-duplicated', () => {
  const r = users.saveUserRolesSchema.parse({ userId: '11111111-1111-4111-8111-111111111111', roles: ['ADM', 'ADM'] });
  assert.deepEqual(r.roles, ['ADM']);
  assert.equal(users.saveUserRolesSchema.safeParse({ userId: '11111111-1111-4111-8111-111111111111', roles: ['MGR'] }).success, false);
  assert.equal(users.saveUserRolesSchema.safeParse({ userId: 'not-a-uuid', roles: [] }).success, false);
});

test('user admin inputs', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(users.disableUserSchema.safeParse({ userId: id, reason: '  ' }).success, false);
  assert.equal(users.updateAccessWindowSchema.parse({ userId: id, accessStartDate: '2027-01-01', accessEndDate: '' }).accessEndDate, null);
  assert.equal(users.updateAccessWindowSchema.safeParse({ userId: id, accessStartDate: '2027-02-01', accessEndDate: '2027-01-01' }).success, false);
  const lp = users.userListParamsSchema.parse({ status: 'active,locked', role: 'bogus', page: '3' });
  assert.deepEqual(lp.status, ['active', 'locked']);
  assert.equal(lp.role, undefined);
});

test('audit params: dates ordered, entry refs numeric', () => {
  assert.equal(users.auditListParamsSchema.safeParse({ from: '2027-01-10', to: '2027-01-01' }).success, false);
  const p = users.auditListParamsSchema.parse({ from: '2027-01-01', to: '2027-01-07', categories: 'health,bank', externalOnly: 'true' });
  assert.deepEqual(p.categories, ['health', 'bank']);
  assert.equal(p.externalOnly, true);
  assert.equal(p.dir, 'desc');
  assert.equal(users.auditEntryRefSchema.safeParse({ source: 'audit', id: '12; drop table x' }).success, false);
  assert.equal(users.revealAuditEntrySchema.safeParse({ source: 'access', id: '42', reason: '' }).success, false);
});

test('privacy notice needs body text or a PDF; month format', () => {
  assert.equal(users.publishPrivacyNoticeSchema.safeParse({ title: 'Notice', effectiveDate: '2027-01-01' }).success, false);
  assert.equal(users.publishPrivacyNoticeSchema.safeParse({ title: 'Notice', bodyText: 'Synthetic text', effectiveDate: '2027-01-01' }).success, true);
  assert.equal(users.publishPrivacyNoticeSchema.safeParse({ title: 'Notice', fileId: '11111111-1111-4111-8111-111111111111', effectiveDate: '2027-01-01' }).success, true);
  assert.equal(users.requestPrivacyNoticeUploadSchema.safeParse({ fileName: 'n.docx', mimeType: 'application/msword', sizeBytes: 10 }).success, false);
  assert.equal(users.monthSchema.safeParse('2027-13').success, false);
  assert.equal(users.monthSchema.safeParse('2027-11').success, true);
});

test('role permission matrix mirrors PRD §16 (40 rows, audit SA-only)', () => {
  assert.equal(users.ROLE_PERMISSION_MATRIX.length, 40);
  const auditRow = users.ROLE_PERMISSION_MATRIX.find((r) => r.group.startsWith('Audit & access logs'));
  assert.deepEqual([auditRow.EMP, auditRow.MGR, auditRow.ADM, auditRow.SA], ['✗', '✗', '✗', 'R X a']);
});

test('CSV: BOM, quoting, CRLF and formula-injection guard', () => {
  const s = csv.toCsv(['A', 'B'], [['=HYPERLINK("x")', 'a,b'], ['-5', true], [null, '+60 3']]);
  assert.ok(s.startsWith('﻿'));
  const lines = s.slice(1).split('\r\n');
  assert.equal(lines[0], 'A,B');
  assert.equal(lines[1], `"'=HYPERLINK(""x"")","a,b"`);
  assert.equal(lines[2], '-5,Yes');
  assert.equal(lines[3], ",'+60 3");
});
