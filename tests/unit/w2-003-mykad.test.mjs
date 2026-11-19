// Unit tests — W2-003 MyKad validation and derivation (src/server/contracts/mykad.ts, BR-EMP-01–06). Synthetic values only.
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
const m = await import('../../src/server/contracts/mykad.ts');
const today = new Date(Date.UTC(2026, 10, 19, 4, 0, 0)); // 19/11/2026 12:00 MYT

test('US-EMP-002: 900101145678 → 900101-14-5678, DOB 01/01/1990, Female', () => {
  const c = m.checkMykad('900101145678', today);
  assert.equal(c.ok, true);
  assert.equal(m.formatMykad(c.digits), '900101-14-5678');
  assert.equal(c.dateOfBirth, '1990-01-01');
  assert.equal(c.gender, 'female');
  assert.deepEqual(c.warnings, []);
});

test('input accepts dashes and spaces (BR-EMP-01)', () => {
  assert.equal(m.normaliseMykad(' 900101-14-5671 '), '900101145671');
  assert.equal(m.checkMykad('900101-14-5671', today).gender, 'male');
});

test('invalid calendar date → "Invalid MyKad date" (EC-EMP-01)', () => {
  assert.equal(m.checkMykad('991332145678', today).error, 'Invalid MyKad date.');
  assert.equal(m.checkMykad('990230145678', today).error, 'Invalid MyKad date.');   // 30 Feb
  assert.equal(m.checkMykad('000229145678', today).ok, true);                        // 29/02/2000 leap
});

test('wrong length / letters are rejected', () => {
  assert.equal(m.checkMykad('90010114567', today).error, 'MyKad must be 12 digits.');
  assert.equal(m.checkMykad('9001011456AB', today).ok, false);
  assert.equal(m.checkMykad('', today).ok, false);
});

test('century rule: YY > current 2-digit year → 19YY, else 20YY (BR-EMP-02)', () => {
  assert.equal(m.deriveMykadDob('270101', today), '1927-01-01');
  assert.equal(m.deriveMykadDob('260101', today), '2026-01-01');
  assert.equal(m.deriveMykadDob('050505', today), '2005-05-05');
});

test('a derived DOB in the future is refused', () => {
  assert.equal(m.checkMykad('261231145678', today).error, 'Date of birth cannot be in the future.');
});

test('unknown place-of-birth code is a warning only (BR-EMP-03)', () => {
  const c = m.checkMykad('900101175678', today);   // 17 not in the JPN list
  assert.equal(c.ok, true);
  assert.equal(c.warnings.length, 1);
  assert.equal(m.isKnownPlaceCode('900101145678'), true);
  assert.equal(m.isKnownPlaceCode('900101985678'), true);
  assert.equal(m.isKnownPlaceCode('900101735678'), false);
});

test('masks show only the last 4 (FR-G-11)', () => {
  assert.equal(m.maskMykad('5678'), '******-**-5678');
  assert.equal(m.maskAccount('1234'), '••••••1234');
  assert.equal(m.maskMykad(null), null);
});

test('age and join-age rule (BR-EMP-06)', () => {
  assert.equal(m.ageOn('1990-06-15', '2026-06-14'), 35);
  assert.equal(m.ageOn('1990-06-15', '2026-06-15'), 36);
  assert.deepEqual(m.joinAgeCheck('2012-01-01', '2026-11-01'), { block: true, warn: false, age: 14 });
  assert.deepEqual(m.joinAgeCheck('2010-01-01', '2026-11-01'), { block: false, warn: true, age: 16 });
  assert.equal(m.joinAgeCheck('1990-01-01', '2026-11-01').warn, false);
});
