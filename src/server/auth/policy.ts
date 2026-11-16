import { z } from 'zod';

// Validation shared by the auth Server Actions (BR-ADM-07). Mirrors the UI's PasswordPolicy.

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 72; // bcrypt input limit used by Supabase Auth

export const passwordSchema = z
  .string({ error: 'Enter a password.' })
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`)
  .regex(/[A-Z]/, 'Include an upper-case letter.')
  .regex(/[a-z]/, 'Include a lower-case letter.')
  .regex(/[0-9]/, 'Include a number.')
  .regex(/[^A-Za-z0-9]/, 'Include a symbol.');

export const emailSchema = z
  .string({ error: 'Enter your email address.' })
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.').max(254, 'Enter a valid email address.'));

export const totpCodeSchema = z
  .string({ error: 'Enter the 6-digit code from your authenticator app.' })
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.');

export const uuidSchema = z.uuid('Invalid reference.');

/** Invite tokens: 32 random bytes, base64url (43 chars). */
export const inviteTokenSchema = z
  .string({ error: 'This invitation link is invalid or has expired.' })
  .trim()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'This invitation link is invalid or has expired.');
