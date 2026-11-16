// Field encryption core (ADR-0003, system-design §11) — pure, no env access, unit-tested.
// AES-256-GCM, 96-bit random nonce, associated data = "table:column:rowId" (a ciphertext
// cannot be moved to another row or column). Stored layout (bytea):
//   [0x01 format][key_id: uint16 BE][nonce: 12][ciphertext: n][tag: 16]
// Blind index: HMAC-SHA-256 over the normalised value with a separate key.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

const FORMAT = 0x01;
const NONCE_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = 1 + 2 + NONCE_LEN;

export interface FieldKeyring {
  /** key_id used for new encryptions */
  currentKeyId: number;
  /** key_id → 32-byte key */
  keys: Map<number, Buffer>;
  /** 32-byte HMAC key for blind indexes (never rotated with the encryption key) */
  blindIndexKey: Buffer;
}

export interface FieldRef {
  table: string;
  column: string;
  rowId: string;
}

function aad(ref: FieldRef): Buffer {
  if (!ref.table || !ref.column || !ref.rowId) throw new Error('PRET-CRYPTO-AAD: table, column and rowId are required');
  return Buffer.from(`${ref.table}:${ref.column}:${ref.rowId}`, 'utf8');
}

export function parseKey(raw: string, name: string): Buffer {
  const trimmed = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  if (key.length !== 32) throw new Error(`PRET configuration error: ${name} must be 32 bytes (base64 or hex)`);
  return key;
}

/** Separate blind-index key derived from a master key when no dedicated key is configured. */
export function deriveBlindIndexKey(masterKey: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.from('pret'), Buffer.from('pret-blind-index-v1'), 32));
}

export function encryptField(keyring: FieldKeyring, plaintext: string, ref: FieldRef): Buffer {
  const key = keyring.keys.get(keyring.currentKeyId);
  if (!key) throw new Error('PRET-CRYPTO-KEY: current key missing');
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_LEN });
  cipher.setAAD(aad(ref));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const header = Buffer.alloc(3);
  header.writeUInt8(FORMAT, 0);
  header.writeUInt16BE(keyring.currentKeyId, 1);
  return Buffer.concat([header, nonce, ct, cipher.getAuthTag()]);
}

export function keyIdOf(blob: Buffer): number {
  if (blob.length < HEADER_LEN + TAG_LEN || blob.readUInt8(0) !== FORMAT) throw new Error('PRET-CRYPTO-FORMAT');
  return blob.readUInt16BE(1);
}

export function decryptField(keyring: FieldKeyring, blob: Buffer, ref: FieldRef): string {
  const keyId = keyIdOf(blob);
  const key = keyring.keys.get(keyId);
  if (!key) throw new Error(`PRET-CRYPTO-KEY: key ${keyId} not available`);
  const nonce = blob.subarray(3, HEADER_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ct = blob.subarray(HEADER_LEN, blob.length - TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_LEN });
  decipher.setAAD(aad(ref));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Re-encrypt under the current key (rotation job). */
export function reencryptField(keyring: FieldKeyring, blob: Buffer, ref: FieldRef): Buffer {
  if (keyIdOf(blob) === keyring.currentKeyId) return blob;
  return encryptField(keyring, decryptField(keyring, blob, ref), ref);
}

/** Identifiers are compared without spaces/dashes and case-insensitively (MyKad, account numbers). */
export function normaliseIdentifier(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

/** HMAC blind index, scoped by purpose so equal values in different columns do not correlate. */
export function blindIndex(keyring: FieldKeyring, purpose: string, value: string): Buffer {
  return createHmac('sha256', keyring.blindIndexKey).update(`${purpose}:${normaliseIdentifier(value)}`, 'utf8').digest();
}

export function blindIndexEquals(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Last 4 characters for masked display (`*_last4`). */
export function last4(value: string): string {
  const n = normaliseIdentifier(value);
  return n.slice(-4);
}
