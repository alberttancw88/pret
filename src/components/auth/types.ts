// Result shape of the auth Server Actions in `@/server/actions/auth` (Backend lane):
// `{ ok: true } | { ok: false, error, fieldErrors? }`. fieldErrors may be zod-style
// string[] per field or a single string; `fieldError` normalises both.
export type AuthActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string | string[] | undefined> };

export function fieldError(
  r: { ok: boolean; fieldErrors?: Record<string, string | string[] | undefined> } | null | undefined,
  field: string,
): string | undefined {
  const v = r && !r.ok ? r.fieldErrors?.[field] : undefined;
  return Array.isArray(v) ? v[0] : v;
}

/** Same-origin relative paths only (no open redirects). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  return next;
}

/** After a successful step, hand over to "/" which routes by role / MFA state. */
export function continueUrl(next: string | null | undefined): string {
  const n = safeNext(next);
  return n ? `/?next=${encodeURIComponent(n)}` : '/';
}
