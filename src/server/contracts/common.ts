// PRET shared contract types (W2-002). Types + zod only — NO database or server code, so
// client components may import from here (prefer `import type` for types).
//
// Conventions for every query / Server Action in src/server/{queries,actions}:
//   * Plain business dates are 'yyyy-mm-dd' strings; instants are ISO-8601 strings (UTC).
//     The UI formats them dd/mm/yyyy (src/lib/format) — never toLocaleString().
//   * Numeric(…) DB values (hours, rates) are strings, never JS floats.
//   * Every Server Action returns ActionResult (same shape as src/server/actions/auth.ts).
//   * Every list query returns Paged<Row>; every list has a matching `export…Csv` Server
//     Action returning CsvFile (the export is written to audit.access_log).
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
export type ActionOk<T extends object = object> = { ok: true } & T;
export type ActionFail = { ok: false; error: string; fieldErrors?: Record<string, string> };
export type ActionResult<T extends object = object> = ActionOk<T> | ActionFail;

export type Paged<T> = { rows: T[]; total: number; page: number; pageSize: number };

/** CSV download produced by an export Server Action (UTF-8 with BOM, CRLF, dd/mm/yyyy dates). */
export type CsvFile = { filename: string; contentType: 'text/csv'; content: string; rowCount: number };

/** Created/updated metadata shown on every form (FR-G-13). Names resolved server-side. */
export type Stamps = {
  createdAt: string | null;
  createdByName: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
};

/** Upload intent returned by request…Upload actions (browser PUTs the file to signedUrl). */
export type UploadIntent = { fileId: string; bucket: string; path: string; signedUrl: string; token: string };

// ---------------------------------------------------------------------------
// Malaysian states (13 states + 3 federal territories) — data-model §3 app.my_state
// ---------------------------------------------------------------------------
export const MY_STATES = [
  'JHR', 'KDH', 'KTN', 'MLK', 'NSN', 'PHG', 'PNG', 'PRK', 'PLS', 'SBH', 'SWK', 'SGR', 'TRG', 'KUL', 'LBN', 'PJY',
] as const;
export type MyState = (typeof MY_STATES)[number];
export const MY_STATE_LABELS: Record<MyState, string> = {
  JHR: 'Johor', KDH: 'Kedah', KTN: 'Kelantan', MLK: 'Melaka', NSN: 'Negeri Sembilan', PHG: 'Pahang',
  PNG: 'Pulau Pinang', PRK: 'Perak', PLS: 'Perlis', SBH: 'Sabah', SWK: 'Sarawak', SGR: 'Selangor',
  TRG: 'Terengganu', KUL: 'WP Kuala Lumpur', LBN: 'WP Labuan', PJY: 'WP Putrajaya',
};
export const myStateSchema = z.enum(MY_STATES, { error: 'Select a state.' });

// ---------------------------------------------------------------------------
// Reusable field schemas
// ---------------------------------------------------------------------------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function validPlainDate(v: string): boolean {
  if (!ISO_DATE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Plain date 'yyyy-mm-dd' (what the date picker sends). */
export const isoDateSchema = z
  .string({ error: 'Enter a date.' })
  .trim()
  .refine(validPlainDate, 'Enter a valid date (dd/mm/yyyy).');

export const uuidSchema = z.uuid('Invalid reference.');
/** Optional reference: '' / null / undefined → null. */
export const optionalUuidSchema = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.uuid('Invalid reference.').nullable(),
);

/** Optional text: trimmed; '' → null. */
export function optionalText(max: number, label = 'This field') {
  return z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v ?? null),
    z.string().max(max, `${label} must be at most ${max} characters.`).nullable(),
  );
}
/** Required text: trimmed, 1..max. */
export function requiredText(max: number, label = 'This field') {
  return z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be at most ${max} characters.`);
}

/** Master-data code (department, position, grade, cost centre): A–Z, 0–9, '-', '_'; stored upper-case. */
export function codeSchema(max = 10) {
  return z
    .string({ error: 'Code is required.' })
    .trim()
    .min(1, 'Code is required.')
    .max(max, `Code must be at most ${max} characters.`)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, - or _ only.')
    .transform((v) => v.toUpperCase());
}

export const booleanSchema = z.preprocess((v) => {
  if (v === 'true' || v === 'on' || v === '1' || v === 1) return true;
  if (v === 'false' || v === 'off' || v === '0' || v === 0 || v === '' || v === undefined || v === null) return false;
  return v;
}, z.boolean());

export const postcodeSchema = z.string({ error: 'Postcode is required.' }).trim().regex(/^[0-9]{5}$/, 'Postcode must be 5 digits.');

export const optionalEmailSchema = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toLowerCase()) : v ?? null),
  z.email('Enter a valid email address.').max(254).nullable(),
);

/** Address block (as employee B5–B10). */
export const addressSchema = z.object({
  line1: requiredText(150, 'Address line 1'),
  line2: optionalText(150, 'Address line 2'),
  line3: optionalText(150, 'Address line 3'),
  postcode: postcodeSchema,
  city: requiredText(80, 'City'),
  state: myStateSchema,
  country: z.preprocess((v) => (v === '' || v == null ? 'Malaysia' : v), requiredText(60, 'Country')),
});
export type AddressInput = z.input<typeof addressSchema>;
export type Address = z.output<typeof addressSchema>;

// ---------------------------------------------------------------------------
// List parameters (every ListPage: search, filters, pagination 25, sort)
// ---------------------------------------------------------------------------
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export const pageParamsSchema = z.object({
  q: z.preprocess((v) => (typeof v === 'string' ? v.trim() : undefined), z.string().max(100).optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
  dir: z.enum(['asc', 'desc']).default('asc'),
});

/** Active filter used on every master list. */
export const activeFilterSchema = z.enum(['all', 'active', 'inactive']).default('all');
export type ActiveFilter = z.output<typeof activeFilterSchema>;

/** Accepts a single value or an array (URL search params) and returns an array. */
export function multi<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? undefined : Array.isArray(v) ? v : String(v).split(',')),
    z.array(item).optional(),
  );
}
