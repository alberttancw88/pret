import 'server-only';
import {
  blindIndex,
  decryptField,
  deriveBlindIndexKey,
  encryptField,
  last4,
  parseKey,
  reencryptField,
  type FieldKeyring,
  type FieldRef,
} from './field-crypto';

// Keys come from the environment (Vercel encrypted env; never the database — ADR-0003):
//   PRET_FIELD_KEY_V1, PRET_FIELD_KEY_V2, …   32-byte keys (base64 or hex)
//   PRET_FIELD_KEY_CURRENT                     key id for new encryptions (default: highest present)
//   PRET_BLIND_INDEX_KEY                       optional dedicated HMAC key; otherwise derived (HKDF) from V1

let keyring: FieldKeyring | undefined;

function loadKeyring(): FieldKeyring {
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(process.env)) {
    const m = name.match(/^PRET_FIELD_KEY_V(\d{1,4})$/);
    if (m && value && value.trim() !== '') keys.set(Number(m[1]), parseKey(value, name));
  }
  if (keys.size === 0) throw new Error('PRET configuration error: PRET_FIELD_KEY_V1 is not set');
  const current = process.env.PRET_FIELD_KEY_CURRENT ? Number(process.env.PRET_FIELD_KEY_CURRENT) : Math.max(...keys.keys());
  if (!keys.has(current)) throw new Error('PRET configuration error: PRET_FIELD_KEY_CURRENT names a missing key');
  const v1 = keys.get(1) ?? keys.get(current)!;
  const bik = process.env.PRET_BLIND_INDEX_KEY;
  return {
    currentKeyId: current,
    keys,
    blindIndexKey: bik && bik.trim() !== '' ? parseKey(bik, 'PRET_BLIND_INDEX_KEY') : deriveBlindIndexKey(v1),
  };
}

function ring(): FieldKeyring {
  keyring ??= loadKeyring();
  return keyring;
}

export type { FieldRef };

/** Encrypt a sensitive identifier; returns `{ enc, last4, bidx }` for the `_enc/_last4/_bidx` columns. */
export function protectIdentifier(value: string, ref: FieldRef, bidxPurpose: string) {
  return {
    enc: encryptField(ring(), value, ref),
    last4: last4(value),
    bidx: blindIndex(ring(), bidxPurpose, value),
  };
}

export const fieldCrypto = {
  encrypt: (value: string, ref: FieldRef) => encryptField(ring(), value, ref),
  /** Decrypt only after the caller has written the access-log row (logged reveal — FR-G-11). */
  decrypt: (blob: Buffer, ref: FieldRef) => decryptField(ring(), blob, ref),
  reencrypt: (blob: Buffer, ref: FieldRef) => reencryptField(ring(), blob, ref),
  blindIndex: (purpose: string, value: string) => blindIndex(ring(), purpose, value),
};
