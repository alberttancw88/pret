// MyKad (NRIC) validation and derivation — BR-EMP-01 to BR-EMP-05, F-EMP-05 (W2-003).
// Pure functions only (no server code): safe to import in client components for on-blur
// derivation, and used by the Server Actions and the unit tests (tests/unit/w2-003-mykad.test.mjs).

/** JPN place-of-birth codes (digits 7–8) — BR-EMP-03 (warning only, list to verify). */
const PLACE_CODE_RANGES: [number, number][] = [
  [1, 16], [21, 59], [60, 68], [71, 72], [74, 79], [82, 93], [98, 99],
];

export type MykadCheck = {
  /** true when the value is 12 digits and digits 1–6 are a valid past date */
  ok: boolean;
  /** 12 digits without dashes ('' when not 12 digits) */
  digits: string;
  /** field message when !ok: 'MyKad must be 12 digits.' / 'Invalid MyKad date.' / 'Date of birth cannot be in the future.' */
  error: string | null;
  /** derived date of birth 'yyyy-mm-dd' (BR-EMP-02) */
  dateOfBirth: string | null;
  /** derived gender (BR-EMP-04): last digit odd = male, even = female */
  gender: 'male' | 'female' | null;
  /** non-blocking warnings (e.g. unknown place-of-birth code) */
  warnings: string[];
};

/** Strips spaces and dashes (input accepts `900101-14-5678` or `900101145678`). */
export function normaliseMykad(value: string | null | undefined): string {
  return (value ?? '').replace(/[\s-]/g, '');
}

/** `YYMMDD-PB-###G` display (BR-EMP-01). Returns the input unchanged when not 12 digits. */
export function formatMykad(value: string | null | undefined): string {
  const d = normaliseMykad(value);
  return /^\d{12}$/.test(d) ? `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}` : (value ?? '');
}

/** Masked display from the stored last 4 digits (FR-G-11): `******-**-5678`. */
export function maskMykad(last4: string | null | undefined): string | null {
  return last4 ? `******-**-${last4}` : null;
}

/** Masked bank / ASNB account display (FR-G-11): `••••••1234`. */
export function maskAccount(last4: string | null | undefined): string | null {
  return last4 ? `••••••${last4}` : null;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isoToday(today: Date): { y: number; iso: string } {
  // Malaysia time (UTC+8, no DST) so the date matches app.today_myt().
  const myt = new Date(today.getTime() + 8 * 3600 * 1000);
  const y = myt.getUTCFullYear();
  return { y, iso: `${y}-${pad(myt.getUTCMonth() + 1)}-${pad(myt.getUTCDate())}` };
}

/**
 * Derives the date of birth from digits 1–6 (BR-EMP-02). Century: if YY > the current
 * 2-digit year → 19YY, else 20YY. Returns null when YYMMDD is not a calendar date.
 */
export function deriveMykadDob(digits: string, today: Date = new Date()): string | null {
  if (!/^\d{6}/.test(digits)) return null;
  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  const curYY = isoToday(today).y % 100;
  const year = yy > curYY ? 1900 + yy : 2000 + yy;
  const dt = new Date(Date.UTC(year, mm - 1, dd));
  if (mm < 1 || mm > 12 || dt.getUTCFullYear() !== year || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null;
  return `${year}-${pad(mm)}-${pad(dd)}`;
}

export function deriveMykadGender(digits: string): 'male' | 'female' | null {
  if (!/^\d{12}$/.test(digits)) return null;
  return Number(digits.charAt(11)) % 2 === 1 ? 'male' : 'female';
}

export function isKnownPlaceCode(digits: string): boolean {
  const pb = Number(digits.slice(6, 8));
  return PLACE_CODE_RANGES.some(([a, b]) => pb >= a && pb <= b);
}

/** Full check used on blur (UI) and on save (server). */
export function checkMykad(value: string | null | undefined, today: Date = new Date()): MykadCheck {
  const digits = normaliseMykad(value);
  const empty: MykadCheck = { ok: false, digits: '', error: 'MyKad must be 12 digits.', dateOfBirth: null, gender: null, warnings: [] };
  if (!/^\d{12}$/.test(digits)) return empty;
  const dob = deriveMykadDob(digits, today);
  if (!dob) return { ...empty, digits, error: 'Invalid MyKad date.' };
  if (dob > isoToday(today).iso) return { ...empty, digits, error: 'Date of birth cannot be in the future.' };
  const warnings: string[] = [];
  if (!isKnownPlaceCode(digits)) warnings.push(`Place-of-birth code ${digits.slice(6, 8)} is not in the JPN code list — please check.`);
  return { ok: true, digits, error: null, dateOfBirth: dob, gender: deriveMykadGender(digits), warnings };
}

/** Whole years between a date of birth and a date ('yyyy-mm-dd'). */
export function ageOn(dateOfBirth: string, onDate: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [y, m, d] = onDate.split('-').map(Number) as [number, number, number];
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

/** BR-EMP-06: < 15 at join date blocks, < 18 warns. */
export function joinAgeCheck(dateOfBirth: string, joinDate: string): { block: boolean; warn: boolean; age: number } {
  const age = ageOn(dateOfBirth, joinDate);
  return { block: age < 15, warn: age >= 15 && age < 18, age };
}
