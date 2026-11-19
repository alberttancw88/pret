# PRET — pret-dev setup steps for Albert

Steps the build agents cannot do (dashboard-only settings or secrets). Do them once for
`pret-dev` (ref `uylqqcuozlunyyytghgi`). Never paste secret values into chat, docs or commits —
only into `.env.local`.

## A. Values for `.env.local`
1. ✅ **Done 16/11/2026 (installed by Delivery Lead; verified connection tested).** **Database CA certificate** — Dashboard → `pret-dev` → **Project Settings → Database → SSL
   Configuration → Download certificate**. Save it as `private/supabase-ca.crt` inside the HRMS
   folder (the `private/` folder is git-ignored), then add to `.env.local`:
   `DATABASE_CA_CERT_FILE=private/supabase-ca.crt`
2. ✅ **Done 16/11/2026 (verified against Auth admin API).** **Secret API key** — **Project Settings → API Keys → Secret keys** → copy the `sb_secret_…`
   key into `.env.local` as `SUPABASE_SECRET_KEY=`. Server-only; used for accepting invitations.

## B. Data API off (ADR-0002, D18)
3. ✅ **Done 16/11/2026 (REST/GraphQL serve no data; verified).** **Project Settings → Data API** → turn the Data API **off** (or remove `public` and
   `graphql_public` from *Exposed schemas*). PRET's server talks to Postgres directly.

## C. Authentication settings (ADR-0014)
4. **Authentication → Sign In / Providers → Email:** *Allow new users to sign up* **off**
   (staff are invited). Minimum password length **12**, require lower, upper, digits and symbols.
5. **Authentication → Multi-Factor:** **TOTP (authenticator app) enabled.**
6. ✅ **Decided 19/11/2026 (D28): leave at the default 3600 seconds.** **Authentication → Sessions → Access Tokens:** access-token (JWT) expiry. *(Originally 600 seconds per ADR-0014.)*
7. **Authentication → URL Configuration:** Site URL `http://localhost:3000` for dev; add
   redirect URLs `http://localhost:3000/reset-password` and `http://localhost:3000/accept-invite`.
   Recovery link validity 1 hour if offered.
8. **Later / needs Pro or an email account (not blocking dev):** leaked-password protection
   (Pro plan feature), CAPTCHA on sign-in, custom SMTP through Resend (D21). The built-in
   Supabase email is rate-limited but fine for a few dev invites.

## D. First Super Admin
9. ✅ **Done 16/11/2026 — Albert is Super Admin.** **Authentication → Users → Add user → Create new user** with your work email (tick
   *Auto confirm*), then tell the Delivery Lead. The Delivery Lead runs
   `private.bootstrap_super_admin(…)` on pret-dev to make that login the first Super Admin.
   On first sign-in PRET will ask you to set up the authenticator app (MFA).
