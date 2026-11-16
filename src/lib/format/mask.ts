// Identifier display (FR-G-11, non-functional §1). Self-contained for the Node test runner.

/** Masked MyKad: "******-**-5678" (from the stored last 4). */
export function maskNric(last4: string | null | undefined): string {
  if (!last4) return '';
  return `******-**-${last4.slice(-4)}`;
}

/** Revealed / own MyKad: 12 digits → "900101-14-5678". Returns the input unchanged if not 12 digits. */
export function formatNric(value: string | null | undefined): string {
  if (!value) return '';
  const d = value.replace(/\D/g, '');
  return d.length === 12 ? `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}` : value;
}

/** Masked bank account: "••••••1234". */
export function maskBankAccount(last4: string | null | undefined): string {
  if (!last4) return '';
  return `••••••${last4.slice(-4)}`;
}

/** E.164 Malaysian number → "+60 12-345 6789" / "+60 11-1234 5678" / "+60 3-1234 5678". */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+60(\d+)$/.exec(e164.replace(/[\s-]/g, ''));
  if (!m) return e164;
  const n = m[1];
  if (n.startsWith('1')) {
    const prefix = n.slice(0, 2);
    const rest = n.slice(2);
    if (rest.length === 7) return `+60 ${prefix}-${rest.slice(0, 3)} ${rest.slice(3)}`;
    if (rest.length === 8) return `+60 ${prefix}-${rest.slice(0, 4)} ${rest.slice(4)}`;
  } else if (n.startsWith('3') && n.length === 9) {
    return `+60 3-${n.slice(1, 5)} ${n.slice(5)}`;
  }
  return `+60 ${n}`;
}

/** Normalises user input to E.164 (+60…) or null (BR-EMP-08). Accepts 012-345 6789, 60123456789, +60 12… */
export function parsePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = input.replace(/[\s()-]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (!/^\d+$/.test(d)) return null;
  if (d.startsWith('60')) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  const e164 = `+60${d}`;
  return /^\+60[0-9]{8,10}$/.test(e164) ? e164 : null;
}
