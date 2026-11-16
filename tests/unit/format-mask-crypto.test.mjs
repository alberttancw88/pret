// Unit tests — identifier masking (FR-G-11) and field encryption core (ADR-0003).
// Synthetic values only (MyKad-shaped test numbers, not real people).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { formatNric, formatPhone, maskBankAccount, maskNric, parsePhone } from '../../src/lib/format/mask.ts';
import {
  blindIndex, decryptField, deriveBlindIndexKey, encryptField, keyIdOf, last4, normaliseIdentifier, parseKey, reencryptField,
} from '../../src/server/crypto/field-crypto.ts';

test('masking', () => {
  assert.equal(maskNric('5678'), '******-**-5678');
  assert.equal(formatNric('000101015678'), '000101-01-5678');
  assert.equal(maskBankAccount('1234'), '••••••1234');
  assert.equal(maskNric(null), '');
});

test('phone formatting and parsing (E.164)', () => {
  assert.equal(parsePhone('012-345 6789'), '+60123456789');
  assert.equal(parsePhone('+60 11-1234 5678'), '+601112345678');
  assert.equal(parsePhone('abc'), null);
  assert.equal(formatPhone('+60123456789'), '+60 12-345 6789');
  assert.equal(formatPhone('+601112345678'), '+60 11-1234 5678');
});

function ring(current = 1) {
  const k1 = randomBytes(32), k2 = randomBytes(32);
  return { currentKeyId: current, keys: new Map([[1, k1], [2, k2]]), blindIndexKey: deriveBlindIndexKey(k1) };
}
const ref = { table: 'employee_personal', column: 'nric_enc', rowId: '11111111-1111-4111-8111-111111111111' };

test('AES-256-GCM round trip with key id, random nonce', () => {
  const r = ring();
  const a = encryptField(r, '000101015678', ref);
  const b = encryptField(r, '000101015678', ref);
  assert.notDeepEqual(a, b);                         // random nonce
  assert.equal(keyIdOf(a), 1);
  assert.equal(decryptField(r, a, ref), '000101015678');
  assert.ok(!a.toString('latin1').includes('000101015678'));
});

test('ciphertext is bound to table/column/row (AAD) and tamper-evident', () => {
  const r = ring();
  const blob = encryptField(r, '000101015678', ref);
  assert.throws(() => decryptField(r, blob, { ...ref, rowId: '22222222-2222-4222-8222-222222222222' }));
  assert.throws(() => decryptField(r, blob, { ...ref, column: 'bank_account_no_enc' }));
  const tampered = Buffer.from(blob);
  tampered[tampered.length - 20] ^= 0x01;
  assert.throws(() => decryptField(r, tampered, ref));
});

test('key rotation re-encrypts under the current key', () => {
  const r = ring(1);
  const old = encryptField(r, 'ABC123', ref);
  const r2 = { ...r, currentKeyId: 2 };
  const rotated = reencryptField(r2, old, ref);
  assert.equal(keyIdOf(rotated), 2);
  assert.equal(decryptField(r2, rotated, ref), 'ABC123');
  assert.equal(decryptField(r2, old, ref), 'ABC123');   // old ciphertext still readable while V1 is present
});

test('blind index: deterministic, normalised, purpose-scoped', () => {
  const r = ring();
  assert.deepEqual(blindIndex(r, 'nric', '000101-01-5678'), blindIndex(r, 'nric', '000101015678'));
  assert.notDeepEqual(blindIndex(r, 'nric', '000101015678'), blindIndex(r, 'bank', '000101015678'));
  assert.equal(normaliseIdentifier(' 12-34 ab '), '1234AB');
  assert.equal(last4('000101-01-5678'), '5678');
});

test('parseKey accepts 32-byte base64 or hex only', () => {
  assert.equal(parseKey(randomBytes(32).toString('base64'), 'K').length, 32);
  assert.equal(parseKey(randomBytes(32).toString('hex'), 'K').length, 32);
  assert.throws(() => parseKey('c2hvcnQ=', 'K'));
});
