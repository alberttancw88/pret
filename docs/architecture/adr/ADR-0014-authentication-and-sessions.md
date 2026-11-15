# ADR-0014 — Authentication and sessions: Supabase Auth, own 72-hour invites, MFA for privileged roles, role-based idle timeout

**Status:** Proposed · **Date:** 15/11/2026 · **Refs:** R3, Q31, F-PRT-01, F-ADM-02/05/07/13/14, BR-ADM-06/07, EC-ADM-05, FR-EMP-02, §8.4

## Context
Email + password sign-in (R3); invite links valid 72 h; lockout after 5 failures for
30 min; MFA mandatory for ADM/SA; idle timeout 15 min for ADM/SA and 30 min for others;
disabling a user ends sessions within 5 min; no "remember me" for privileged roles.

## Options
1. Supabase Auth defaults only — built-in invite/OTP links cannot be valid for 72 h; no per-account lockout or per-role idle timeout.
2. **Supabase Auth + PRET controls**: own hashed invite tokens (72 h) that create the Auth user on acceptance; sign-in via a Server Action enforcing lockout and recording `login_events`; CAPTCHA on Auth endpoints (Auth-server lockout hook if the plan provides it — Q-ARCH-07); TOTP MFA with `aal2` required by the database for privileged rights; short JWT (10 min) + rotating refresh tokens; `app_sessions.last_seen_at` for role-based idle timeout; disable = live check + refresh-token revocation.
3. External identity provider (Microsoft 365 / Google SSO) — R3 lists it only as a later option.

## Decision
Option 2. Sign-ups disabled (invite-only); password ≥ 12 chars with leaked-password
protection; reset links valid 1 h; generic errors; N-50/N-51/N-52/N-53 notifications.
SSO can be added later without changing authorisation (roles are not in the token).

## Consequences
- (+) Meets every PRD rule with standard Supabase features plus small PRET tables.
- (−) Lockout outside PRET's form relies on CAPTCHA unless the plan offers the password-verification hook (Q-ARCH-07).
