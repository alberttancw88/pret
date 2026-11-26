// Readable message for a report query that failed on the server (never internal details).
import { ZodError } from 'zod';

export function reportErrorMessage(e: unknown): string {
  if (e instanceof ZodError) return e.issues[0]?.message ?? 'Check the filters and try again.';
  return 'This report could not be loaded. Check the filters and try again.';
}
