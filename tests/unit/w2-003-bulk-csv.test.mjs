// Unit tests — W2-003 E14 bulk update CSV parsing (src/server/lib/bulk-update-csv.ts) and contract schemas. Synthetic values only.
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
const b = await import('../../src/server/lib/bulk-update-csv.ts');
const c = await import('../../src/server/contracts/employees.ts');

test('RFC 4180: BOM, CRLF, quotes, embedded commas / newlines / quotes', () => {
  const rows = b.parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n\r\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'he said "hi"', 'line1\nline2']]);
});

test('unclosed quote is reported, not thrown', () => {
  const r = b.parseBulkUpdateCsv('Employee no.,Department (code)\r\n"SMP-01,DEV', ['department']);
  assert.equal(r.rows.length, 0);
  assert.match(r.errors[0].message, /not a valid CSV/);
});

test('headers are case/space-insensitive and values are mapped per field', () => {
  const csv = 'employee  NO.,Reporting manager (employee no.),Department (code),Extra\nsmp-03,SMP-02,dev,ignored\n';
  const r = b.parseBulkUpdateCsv(csv, ['manager', 'department']);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows, [{ rowNo: 1, employeeNo: 'SMP-03', values: { manager: 'SMP-02', department: 'dev' } }]);
  assert.match(r.warnings[0], /Ignored columns: Extra/);
});

test('missing columns, blank and duplicate employee numbers are errors', () => {
  assert.match(b.parseBulkUpdateCsv('Employee no.\nSMP-01\n', ['grade']).errors[0].message, /Grade \(code\)/);
  assert.match(b.parseBulkUpdateCsv('Grade (code)\nG1\n', ['grade']).errors[0].message, /Employee no\./);
  const r = b.parseBulkUpdateCsv('Employee no.,Grade (code)\nSMP-01,G1\n,G2\nsmp-01,G3\n', ['grade']);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.errors.map((e) => e.rowNo), [2, 3]);
});

test('formula-protection prefix from our own exports is undone; groups split on ;', () => {
  assert.equal(b.unprotectCell("'=SUM(1)"), '=SUM(1)');
  assert.equal(b.unprotectCell("O'Neil"), "O'Neil");
  assert.deepEqual(b.splitGroups(' Group A ; Group B;;Group A '), ['Group A', 'Group B']);
});

test('createEmployee: MyKad normalised, mobile E.164, overrides required, manager or top-of-org', () => {
  const base = {
    identity: { mykad: '900101-14-5678', fullName: 'Sample  Employee', dateOfBirth: '1990-01-01', gender: 'female', maritalStatus: 'single' },
    contact: { workEmail: 'Sample@Example.com', personalEmail: 'home@example.com', mobilePhone: '012-345 6789',
      residentialAddress: { line1: '1 Jalan Contoh', postcode: '40000', city: 'Shah Alam', state: 'SGR' } },
    emergencyContacts: [{ priority: 1, name: 'Sample Contact', relationship: 'parent', mobilePhone: '+60123456789' }],
    employment: { joinDate: '2026-12-01', probationMonths: 3, departmentId: crypto.randomUUID(), positionId: crypto.randomUUID(),
      gradeId: crypto.randomUUID(), managerId: crypto.randomUUID(), workLocationId: crypto.randomUUID(), workingPatternId: crypto.randomUUID() },
  };
  const ok = c.createEmployeeSchema.parse(base);
  assert.equal(ok.identity.mykad, '900101145678');
  assert.equal(ok.identity.fullName, 'Sample Employee');
  assert.equal(ok.contact.mobilePhone, '+60123456789');
  assert.equal(ok.contact.workEmail, 'sample@example.com');
  assert.equal(ok.invite.mode, 'scheduled');
  const dob = c.createEmployeeSchema.safeParse({ ...base, identity: { ...base.identity, dateOfBirth: '1990-01-02' } });
  assert.equal(dob.success, false);
  assert.ok(dob.error.issues.some((i) => i.path.join('.') === 'identity.dobOverrideConfirmed'));
  const noMgr = c.createEmployeeSchema.safeParse({ ...base, employment: { ...base.employment, managerId: '' } });
  assert.ok(noMgr.error.issues.some((i) => i.path.join('.') === 'employment.managerId'));
  const bad = c.createEmployeeSchema.safeParse({ ...base, identity: { ...base.identity, mykad: '991332145678' } });
  assert.ok(bad.error.issues.some((i) => i.message === 'Invalid MyKad date.'));
  const sameEmail = c.createEmployeeSchema.safeParse({ ...base, contact: { ...base.contact, personalEmail: 'sample@example.com' } });
  assert.ok(sameEmail.error.issues.some((i) => i.path.join('.') === 'contact.personalEmail'));
});

test('bank details: bank transfer needs bank, type, account no., holder and proof; digits 6–20', () => {
  const r = c.bankDetailsSchema.safeParse({ paymentMethod: 'bank_transfer' });
  assert.deepEqual(r.error.issues.map((i) => i.path[0]).sort(), ['accountHolderName', 'accountNo', 'accountType', 'bankId', 'proofFileId']);
  assert.equal(c.bankDetailsSchema.safeParse({ paymentMethod: 'cash' }).success, true);
  assert.equal(c.accountNoSchema().safeParse('12345').success, false);
  assert.equal(c.accountNoSchema().parse('1234-5678 90'), '1234567890');
});

test('change requests: proof required for bank / MyKad; reject needs remarks; one statutory example', () => {
  const bank = c.submitChangeRequestSchema.safeParse({ category: 'bank_details', effectiveDate: '2026-11-19', paymentMethod: 'bank_transfer',
    bankId: crypto.randomUUID(), accountType: 'savings', accountNo: '1234567890', accountHolderName: 'Sample Employee' });
  assert.ok(bank.error.issues.some((i) => i.path[0] === 'fileIds'));
  assert.equal(c.submitChangeRequestSchema.safeParse({ category: 'religion', effectiveDate: '2026-11-19', religion: 'none' }).success, true);
  assert.equal(c.decideChangeRequestSchema.safeParse({ id: crypto.randomUUID(), decision: 'reject', version: 1 }).success, false);
  assert.equal(c.decideChangeRequestSchema.safeParse({ id: crypto.randomUUID(), decision: 'approve', version: 1 }).success, true);
  const tax = c.optionalTaxNoSchema.parse(' ig 1234567 ');
  assert.equal(tax, 'IG1234567');
  assert.equal(c.optionalTaxNoSchema.safeParse('XX12').success, false);
});

test('emergency contacts: 1–3, unique priority, one next of kin; HR-only document categories', () => {
  const k = (p, nok = false) => ({ priority: p, name: 'Sample', relationship: 'friend', mobilePhone: '+60123456789', isNextOfKin: nok });
  assert.equal(c.emergencyContactsSchema.safeParse([]).success, false);
  assert.equal(c.emergencyContactsSchema.safeParse([k(1), k(1)]).success, false);
  assert.equal(c.emergencyContactsSchema.safeParse([k(1, true), k(2, true)]).success, false);
  assert.equal(c.emergencyContactsSchema.safeParse([k(1, true), k(2)]).success, true);
  const doc = c.createDocumentSchema.safeParse({ employeeId: crypto.randomUUID(), fileId: crypto.randomUUID(), category: 'mykad_copy', title: 'x', visibleToEmployee: true });
  assert.ok(doc.error.issues.some((i) => i.path[0] === 'visibleToEmployee'));
  assert.equal(c.lengthOfServiceText({ years: 4, months: 1, days: 14 }), '4 years 1 month 14 days');
});
