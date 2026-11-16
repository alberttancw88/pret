import 'server-only';
import { z } from 'zod';
import { getUserContext, requireUser, type CurrentUser, type Role } from '../auth/current-user';
import { sql, toPretError, type Tx, type UserTxContext } from '../db';
import type { ActionFail } from '../contracts/common';

// Shared plumbing for W2-002 queries and Server Actions (not a 'use server' module).

export type Input = FormData | Record<string, unknown> | undefined | null;

export function toObject(input: Input): Record<string, unknown> {
  if (!input) return {};
  if (typeof FormData !== 'undefined' && input instanceof FormData) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of input.entries()) {
      if (k in out) out[k] = ([] as unknown[]).concat(out[k], v);
      else out[k] = v;
    }
    return out;
  }
  return input as Record<string, unknown>;
}

export function fail(error: string, fieldErrors?: Record<string, string>): ActionFail {
  return fieldErrors && Object.keys(fieldErrors).length > 0 ? { ok: false, error, fieldErrors } : { ok: false, error };
}

/** zod issues → fieldErrors keyed by the dotted path ('registeredAddress.postcode', 'rows.0.name'). */
export function invalid(err: z.ZodError): ActionFail {
  const fieldErrors: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.length ? issue.path.map(String).join('.') : 'form';
    fieldErrors[key] ??= issue.message;
  }
  return fail('Please correct the highlighted fields.', fieldErrors);
}

export const NO_ACCESS = 'Not found or no access.';
export const UNEXPECTED = 'Something went wrong. Please try again.';

/** Friendly messages for PRET-* codes raised by guards/functions; field = which input to highlight. */
const CODE_MESSAGES: Record<string, { message?: string; field?: string }> = {
  'PRET-ACC-401': { message: 'Your session has ended. Please sign in again.' },
  'PRET-ACC-403': { message: NO_ACCESS },
  'PRET-ACC-404': { message: NO_ACCESS },
  'PRET-SELF-001': { message: "You can't change your own access, status or roles." },
  'PRET-ADM-LAST-SA': { message: 'At least one active Super Admin must remain.' },
  'PRET-ROLE-EXTERNAL': { message: 'External administrators can hold the Admin role only.', field: 'roles' },
  'PRET-ROLE-INACTIVE-USER': { message: "Roles can't be given to a disabled or expired user.", field: 'roles' },
  'PRET-ROLE-REVOKE-ONLY': { message: 'Roles can only be granted or revoked.' },
  'PRET-USR-EMAIL-LOCKED': { field: 'loginEmail' },
  'PRET-USR-STATUS': { message: "This status change isn't allowed." },
  'PRET-USR-SYSTEM-FIELD': { message: NO_ACCESS },
  'PRET-USR-UNLOCK-ONLY': { message: NO_ACCESS },
  'PRET-INV-STATE': { message: 'This user is not waiting for an invitation.' },
  'PRET-ORG-CYCLE': { field: 'parentId' },
  'PRET-ORG-PARENT-INACTIVE': { field: 'parentId' },
  'PRET-ORG-HEAD-W2003': { field: 'headEmployeeId' },
  'PRET-ORG-SA-ONLY': { message: 'Only a Super Admin can change this.' },
  'PRET-WP-BACKDATE': { field: 'version.effectiveFrom' },
  'PRET-WP-VERSION-LOCKED': { field: 'version.effectiveFrom' },
  'PRET-PH-YEAR-CHANGE': { field: 'holidayDate' },
  'PRET-PH-COMPULSORY': { message: undefined },
  'PRET-NOTICE-FILE': { field: 'fileId' },
  'PRET-FILE-TYPE': { message: "The file's content doesn't match its type. Upload a PNG, JPEG or PDF as stated.", field: 'fileId' },
  'PRET-FILE-SIZE': { message: 'The file must be 10 MB or smaller.', field: 'fileId' },
  'PRET-FILE-MISSING': { message: 'The upload did not finish. Please upload the file again.', field: 'fileId' },
  'PRET-FILE-EXPIRED': { message: 'The upload took too long. Please upload the file again.', field: 'fileId' },
  'PRET-FILE-STATE': { message: 'This file has already been confirmed.', field: 'fileId' },
  'PRET-FILE-UPLOAD-URL': { message: "Couldn't prepare the upload. Please try again." },
  'PRET-CONFIG': { message: 'This feature is not configured on the server yet. Please contact the Super Admin.' },
  'PRET-DUPLICATE': { message: 'This record already exists.' },
  'PRET-RETRY': { message: 'Please try again.' },
};

const CONSTRAINT_FIELDS: Record<string, { field: string; message: string }> = {
  ux_departments_code: { field: 'code', message: 'This code is already in use.' },
  ux_positions_code: { field: 'code', message: 'This code is already in use.' },
  ux_grades_code: { field: 'code', message: 'This code is already in use.' },
  ux_grades_rank: { field: 'rank', message: 'Another grade already has this rank.' },
  ux_cost_centres_code: { field: 'code', message: 'This code is already in use.' },
  ux_employee_groups_name: { field: 'name', message: 'This name is already in use.' },
  ux_working_patterns_name: { field: 'name', message: 'This name is already in use.' },
  ux_work_locations_name: { field: 'name', message: 'This name is already in use.' },
  ux_pattern_versions_effective: { field: 'version.effectiveFrom', message: 'A version with this effective date already exists.' },
  ux_company_zakat_body: { field: 'rows', message: 'Each zakat body can appear only once.' },
  app_users_login_email_key: { field: 'loginEmail', message: 'A user with this email already exists.' },
  chk_one_rest_day: { field: 'version.sun', message: 'At least one rest day per week is required (EA s59).' },
  chk_holiday_in_year: { field: 'holidayDate', message: 'The date must be within the selected year.' },
  chk_settings_ranges: { field: 'form', message: 'One of the values is outside the allowed range.' },
  chk_external_window: { field: 'accessEndDate', message: 'External administrators need an access end date and service provider.' },
  chk_window_order: { field: 'accessEndDate', message: 'Access end must be on or after access start.' },
};

function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (!t) return UNEXPECTED;
  const c = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(c) ? c : `${c}.`;
}

/** Maps any error thrown inside an action to an ActionFail (never leaks SQL). */
export function dbFail(err: unknown, fieldOverrides: Record<string, string> = {}): ActionFail {
  const e = err as { constraint?: string; code?: string; message?: string };
  if (e?.constraint && CONSTRAINT_FIELDS[e.constraint]) {
    const c = CONSTRAINT_FIELDS[e.constraint]!;
    const field = fieldOverrides[c.field] ?? c.field;
    return fail(c.message, { [field]: c.message });
  }
  if (e?.code === '23503') return fail('A selected reference no longer exists. Refresh and try again.');
  const p = toPretError(err);
  const known = CODE_MESSAGES[p.code];
  if (p.code === 'PRET-DB') {
    console.error('[pret] action error', e?.code ?? '', (e?.message ?? '').slice(0, 300));
    return fail(UNEXPECTED);
  }
  const message = known?.message ?? sentence(p.message && p.message !== p.code ? p.message : UNEXPECTED);
  const field = known?.field ? fieldOverrides[known.field] ?? known.field : undefined;
  return field ? fail(message, { [field]: message }) : fail(message);
}

export type Authorized = { user: CurrentUser; ctx: UserTxContext; accessToken: string };

/**
 * requireUser([...roles]) (redirects to /login, /mfa or renders Not Found) + the verified
 * transaction context. Call OUTSIDE try/catch so Next's redirect/notFound propagate.
 */
export async function authorize(roles: Role[]): Promise<Authorized> {
  await requireUser(roles);
  const c = await getUserContext();
  if (!c) throw new Error('PRET-ACC-401');
  return c;
}

/**
 * The standard Server Action shape: requireUser(roles) → zod-validate → fn (which opens its own
 * withUserTx) → ActionResult. Errors become ActionFail via dbFail (no SQL leaks).
 */
export async function runAction<S extends z.ZodTypeAny, R extends object>(
  roles: Role[],
  schema: S,
  input: Input,
  fn: (data: z.output<S>, a: Authorized) => Promise<R | ActionFail>,
  fieldOverrides?: Record<string, string>,
): Promise<{ ok: true } & R | ActionFail> {
  const a = await authorize(roles);
  const parsed = schema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  try {
    const r = await fn(parsed.data, a);
    if ((r as ActionFail).ok === false) return r as ActionFail;
    return { ok: true as const, ...(r as R) };
  } catch (e) {
    return dbFail(e, fieldOverrides);
  }
}

export function hasRole(user: CurrentUser, ...roles: Role[]): boolean {
  return roles.some((r) => user.roles.includes(r));
}

/** Display names for stamp columns (app.user_display_names re-checks the caller). */
export async function resolveNames(tx: Tx, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((v): v is string => typeof v === 'string'))];
  const map = new Map<string, string>();
  if (uniq.length === 0) return map;
  const r = await sql<{ id: string; display_name: string }>`
    select id, display_name from app.user_display_names(${uniq}::uuid[])`.execute(tx);
  for (const row of r.rows) map.set(row.id, row.display_name);
  return map;
}

export function iso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export function stamps(
  row: { created_at?: Date | string | null; created_by?: string | null; updated_at?: Date | string | null; updated_by?: string | null },
  names: Map<string, string>,
) {
  return {
    createdAt: iso(row.created_at),
    createdByName: row.created_by ? names.get(row.created_by) ?? null : row.created_at ? 'System' : null,
    updatedAt: iso(row.updated_at),
    updatedByName: row.updated_by ? names.get(row.updated_by) ?? null : row.updated_at ? 'System' : null,
  };
}

/** Escapes LIKE wildcards in a search term. */
export function likeTerm(q: string | undefined | null): string | null {
  if (!q) return null;
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}
