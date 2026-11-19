# PRET — Delivery Board

The Delivery Lead's work board. One row per work item. Statuses:
`backlog → in-progress → gate-1 → gate-2 → building → gate-3 → done` (blocked as needed).
Gates are approved by **Albert**.

## Active — Wave 1 (Requirements & Architecture)

| ID | Work item | Owner (agent) | Status | Gate | Notes |
|----|-----------|---------------|--------|------|-------|
| W1-000 | Project governance skeleton (CLAUDE.md, operating model, agents, decisions, board) | Delivery Lead | done | — | Adopted from Direct Order, adapted for single-company + PDPA. |
| W1-001 | Phase-1 BRD + PRD (field-level) | product-analyst | done | GATE 1 ✅ | ✅ `docs/product/BRD.md`, `PRD.md` — 241 active functions after the D11–D16 amendment (R1.0 183, R1.1 payroll 49, later 6, won't 3), M1–M10, access matrix, open questions with defaults. **GATE 1 approved by Albert 2026-11-15** with D11–D16 and remaining open-question defaults; amendment applied. Delivery Lead removed two unsourced office-location details. |
| W1-002 | Phase-1 user stories + acceptance criteria | product-analyst | done | GATE 1 ✅ | ✅ `docs/product/user-stories.md` — 242 active stories after amendment (R1.0 194, R1.1 48), Given/When/Then, every function traced. **GATE 1 approved 2026-11-15.** |
| W1-003 | Architecture baseline, data model, RLS + ADRs | solution-architect | done | GATE 2 ✅ | ✅ `docs/architecture/`: system design, data model (141 tables), RLS for every table, non-functional, ADR-0001–0016; Q-ARCH-01–13 with defaults. Server-only data access (departs from Direct Order — flagged to Albert). |
| W1-004 | UX — screen inventory, IA, field-level wireframes, interaction notes | ux-designer | done | GATE 2 ✅ | ✅ 12 files in `docs/design/ux/`: 165 screens (R1.0 140, R1.1 25), 45 phone-first; 6 spec gaps + UXQ-01–14 with defaults. |
| W1-005 | UI — MUI design system, component specs, dashboard visuals | ui-designer | done | GATE 2 ✅ | ✅ `docs/design/ui/` design-system, components, dashboard-visuals. Buttons use `#5A5FF2` (brand `#666CFF` fails AA at 4.07:1 — verified by Delivery Lead); full chip mapping; 5 open UI questions. |

## Active — Wave 2 (Build R1.0)

Build lanes per operating model §5: Backend/Supabase engineer (`supabase/`, `src/server/`),
Frontend engineer (`src/`). Each item is built against the GATE-2 design and tested before GATE 3.

| ID | Work item | Owner (agent) | Status | Gate | Notes |
|----|-----------|---------------|--------|------|-------|
| W2-000 | Environments: Supabase dev project (Singapore), Vercel project, repo scaffold | Delivery Lead | done | — | ✅ Supabase `pret-dev` (ref `uylqqcuozlunyyytghgi`, ap-southeast-1, org "Interact Direct Order", free plan, $0) created 15/11/2026. Next.js scaffold builds; libraries installed; `.env.local` written (DB connection string pending from Albert). Vercel on Hobby (D26), project `pret` → `pret-zeta.vercel.app`, set up by Albert from GitHub `main`. Production Supabase project on the free tier (D27) at Wave 4. |
| W2-001 | Foundation: Next.js + MUI theme + left-nav shell, auth (invites, MFA for ADM/SA, lockout, idle timeout), roles, audit/access log, core schema + RLS, notifications outbox, file storage | backend + frontend | built (v0.2.1) | GATE 3 | ADR-0001/2/3/7/8/10/14. Everything else builds on it. |
| W2-002 | Organisation & company setup (M5) + users/roles admin (M6) | backend + frontend | built (v0.2.2) | GATE 3 | Brief `docs/build/W2-002-brief.md`; reports `docs/build/W2-002-{backend,frontend}-report.md`. Deferred to W2-003: dept head, reporting lines (F-ORG-11), employee-user invite, F-ADM-06; privacy A12–A14 after W2-003; notifications → W2-007. |
| W2-003 | Employee master (M1): records, job history, change requests, documents | backend + frontend | backlog | GATE 3 | Sensitive-data split + encryption (ADR-0003). Albert's employee row must use reserved id `9521b207-…2dfc` (see log 16/11). |
| W2-004 | Leave (M2): types, entitlements, ledger, apply/approve, calendar, roll-over | backend + frontend | backlog | GATE 3 | ADR-0004/0005; statutory seeds (D13). |
| W2-005 | Claims (M3): categories/limits, submit/approve, month-end HLB batch, AutoCount .xlsx | backend + frontend | backlog | GATE 3 | D12, D15, D16, D23. |
| W2-006 | Portal & approvals (M4) incl. phone layouts | frontend | backlog | GATE 3 | |
| W2-007 | Reports & exports (M7), notifications (M8) | backend + frontend | backlog | GATE 3 | |
| W2-008 | Kakitangan migration import (M9) | backend | backlog | GATE 3 | Needs anonymised sample exports from Albert (Q1). |

## Backlog — later waves
- Wave 3: QA + Security → GATE 3 for R1.0.
- Wave 4: Release pipeline, production environment, Kakitangan data migration, user guides, R1.0 go-live.
- R1.1 payroll: build → parallel run vs Kakitangan → GATE 3 → cut-over. Needs a second Super Admin (D22) and the inputs in PRD Q37/Q41/Q42/Q44.

## Log
- 2026-11-16 — Albert asked for PRET to run on Vercel, not localhost. Delivery Lead prepared `private/vercel-env.txt` (git-ignored; 6 vars, CA cert as base64 in `DATABASE_CA_CERT` — supported by `pool.ts`). Albert creates/links the Vercel project himself (as Direct Order Q-BRD-C), imports `alberttancw88/pret`, pastes the env file, then adds the Vercel URL to Supabase Auth URL config. Dev deploy uses pret-dev with synthetic data only; production Supabase project (Pro) stays at Wave 4 (D20).
- 2026-11-17 — Albert decided **Vercel Hobby for PRET, including the live version** (D26, supersedes Vercel Pro in D20; Supabase Pro for production unchanged). Albert asked to commit and push v0.2.3 so Vercel can build the MFA fix.
- 2026-11-19 — Albert: **free tiers only** for Supabase and Vercel (D27, supersedes Pro in D20/D25). PRET's own backup job (D20) is now mandatory before go-live.
- 2026-11-19 — `pret-zeta.vercel.app` returns DEPLOYMENT_NOT_FOUND. Delivery Lead checked Vercel (read-only): project `pret` (team "Interact", Hobby) is connected to the **wrong repo** (`alberttancw88/direct-order`), has **no environment variables** and **no deployments**. Albert to reconnect `alberttancw88/pret`, paste `private/vercel-env.txt`, and deploy `main`.
- 2026-11-19 — With Albert's OK, Delivery Lead gave the Vercel GitHub app access to `pret` (kept `direct-order`) after Albert's GitHub email check, and connected `alberttancw88/pret` to Vercel project `pret` (Next.js preset confirmed). Albert's first env import landed in the **direct-order** Vercel project (5 PRET vars as Config; Direct Order's own 12 untouched, no redeploy). With Albert's OK the Delivery Lead deleted those 5; direct-order back to its original 12. No secret left Albert's own Vercel account, so no key rotation needed.
- 2026-11-19 — Albert imported the 6 vars into Vercel `pret`. Delivery Lead deployed `main` (2b64647, v0.2.3) to Production: **https://pret-zeta.vercel.app live** (sin1, ~80 s build). Checked: `/login` 200, protected routes redirect to sign-in, `/dev/components` 404 in production, HSTS on. For GATE 3: no CSP / X-Frame-Options / X-Content-Type-Options / Referrer-Policy headers yet. Pending: Albert's first sign-in on the live site, 600 s session check.
- 2026-11-19 — With Albert's OK, Delivery Lead set pret-dev Auth URL config: Site URL `https://pret-zeta.vercel.app`; redirect URLs now 4 (localhost + live `/reset-password`, `/accept-invite`). Verified after reload. PRET builds email links from the request host, so no code change.
- 2026-11-19 — Live sign-in reached the MFA step (password + DB work on Vercel); 2 wrong codes (Albert tried Vercel's). Albert says he has no PRET authenticator entry, so at his request the Delivery Lead reset his MFA on pret-dev by SQL, mirroring `resetUserMfa` (factor deleted, `mfa_enrolled` false, 2 open sessions ended). Not written to `audit.audit_log` (no user context for SQL); recorded here instead. Albert re-enrols on the live site.
- 2026-11-19 — **First live sign-in done:** Albert enrolled a new PRET authenticator and reached the dashboard on https://pret-zeta.vercel.app (factor verified, `mfa_enrolled` true, success logins recorded). Vercel → Supabase pooler with verified TLS works in production. Still open: 600 s session check.
- 2026-11-19 — Albert confirmed PRET's idle timeout on the live site ("Still there?" warning with countdown, F-ADM-14; 15 min for SA). Delivery Lead checked pret-dev Auth → Sessions (read-only): **access-token expiry is 3600 s, not the 600 s in ADR-0014 / dev-setup step 6**; refresh-token reuse detection on. Supabase's own inactivity timeout (the 30-min backstop in system-design §session lifetime) is **Pro-only**, so under D27 PRET's own idle timeout is the only one.
- 2026-11-19 — Albert: keep the 1-hour access token (D28, departs from ADR-0014's 10 min). Dev-setup step 6 closed. Security engineer to note it at GATE 3.
- 2026-11-16 — Albert signed in to pret-dev and enrolled TOTP (1 verified factor, aal2 session, `mfa_enrolled` set). Finding for GATE 3 security/QA: the password-reset link signs the user in (recovery PKCE) with no `success` row in `app.login_events` — login history shows only failures; decide whether reset should end with a normal sign-in or record the event. Auth settings verified: sign-ups off, TOTP on; access-token expiry (600 s) not yet verified.
- 2026-11-16 — First browser sign-in by Albert (after a password reset). Bug found and fixed by Delivery Lead: `/` sent un-enrolled ADM/SA to `/mfa` in verify mode (no QR code); `/mfa` now picks enrol whenever the account has no verified factor (`hasEnrolledFactor` exported). For GATE 3 QA: add a test for this path.
- 2026-11-16 — W2-002 built. Backend: 6 migrations on pret-dev (18 tables, RLS forced), contract in `src/server/contracts/`, SQL tests 91/91 + foundation 86/86. Frontend: 18 routes (O1–O11, A5–A11). Delivery Lead re-ran tsc, next build, unit 40/40, both SQL suites, secrets/PII scan (clean); Albert's SA row intact. Added `RESEND_API_KEY`/`PRET_EMAIL_FROM` to `.env.example`. Follow-ups: all-users privacy-notice route `/privacy-notice` (S-GL-09) not built; GL-list import and holiday import wait on M9; browser test pending Albert's setup.
- 2026-11-16 — W2-002 dispatched to backend and frontend engineers (general-purpose agents, lanes per §5) with a shared brief; backend writes the contract (`src/server/contracts/`) first to avoid the W2-001 signature mismatch.
- 2026-11-16 — Albert created his pret-dev login; Delivery Lead ran `private.bootstrap_super_admin` → Albert is the first **Super Admin** (active, MFA enrolment due at first sign-in). No employee table yet, so a reserved `employee_id` `9521b207-9f92-4dbf-a2f7-ba0fd2832dfc` was assigned — **W2-003 must create Albert's employee record with this id before adding the FK**. Pushed `main` + tags v0.2.0, v0.2.1 to origin (Albert approved).
- 2026-11-16 — Albert supplied the database CA cert (Supabase Root 2021 CA, valid to 2031) → `private/supabase-ca.crt` (git-ignored), `DATABASE_CA_CERT_FILE` set; verified-TLS connection to pret-dev tested OK. Albert supplied the Interact logo (transparent, 2000 px) → `public/brand/interact-logo.png` (960 px) and `interact-mark.png` re-cut at high resolution; tsc + build clean. SVG versions still optional (D24).
- 2026-11-16 — W2-001 Foundation built (backend + frontend): tsc, next build (10 routes + middleware) and unit tests clean (Delivery Lead re-ran). Not yet exercised in a browser — needs Albert's pret-dev setup (guide) and first Super Admin. Known gaps: idle-timeout in-place re-sign-in that keeps unsaved form data; DataGrid (plain Table used); `sharp` for image re-encoding.
- 2026-11-16 — W2-001 backend delivered: 9 migrations on pret-dev (22 tables, RLS forced on all, 45 policies, 7 private buckets), role-matrix SQL 86/86, DB end-to-end 16/16, unit 22/22; Delivery Lead re-ran tsc, build and unit tests (clean) and a secrets scan (clean). Albert setup steps in `docs/guides/dev-setup-pret-dev.md`. Frontend finishing middleware, /reset-password, idle timeout, shared formatting.
- 2026-11-16 — W2-001 frontend half delivered (theme, AppShell, StatusChip ×15, ListPage, auth screens, /dev/components). Waiting on backend `src/server` for full build. Action signatures (object args, `completePasswordReset`, MFA enrol redirect, 12-char password rule) relayed to backend. Follow-ups: switch to `@/lib/format`; DataGrid not installed (plain Table).
- 2026-11-16 — W2-001 backend and frontend agents stopped at the usage limit mid-task; resumed from saved state after reset.
- 2026-11-15 — W2-001 Foundation dispatched to backend and frontend engineers (general-purpose agents under operating-model §5 lanes; no dedicated agent files). Email provider = Resend (D21, as Direct Order).
- 2026-11-15 — Albert chose the existing Supabase org. Delivery Lead created dev project `pret-dev` in Singapore (free plan, $0/month confirmed).
- 2026-11-15 — **GATE 2 approved by Albert** with all defaults (D18–D24). Gate 2 baseline committed as v0.2.0. Outstanding inputs: second Super Admin name, logo SVGs.
- 2026-11-15 — W1-003 architecture delivered → gate-2. Delivery Lead compiled `docs/gate-2-review.md` (8 decisions for Albert, the rest on defaults) and sent it for GATE 2.
- 2026-11-15 — W1-005 UI delivered → gate-2. Contrast ratios spot-checked by Delivery Lead. Waiting on W1-003 architecture.
- 2026-11-15 — W1-004 UX delivered → gate-2. Delivery Lead updated `reference-interact-ui.md` to D11 roles / D12 claim statuses (UXQ-09). W1-005 dispatched to ui-designer.
- 2026-11-15 — D11–D16 amendment delivered by product-analyst (6 functions removed, 2 added; 6 stories removed, 3 added; traceability re-checked). System renamed **PRET** (D17). GATE 1 baseline committed as v0.1.0.
- 2026-11-15 — **GATE 1 approved by Albert** (spec + D11–D16; all other open questions on their proposed defaults). Gate 2 items W1-003/004/005 queued behind the amendment pass.
- 2026-11-15 — Albert: bank details maintained by SA or Admin (D15); all payments direct via HLB, no Kakitangan claims handover (D16). Relayed to product-analyst mid-amendment.
- 2026-11-15 — Albert answered Q3 (four roles), Q4 (single-level claim approval, month-end disbursement, new statuses), Q7 (statutory entitlements), Q30 (PDPA extras not required) → `01-decisions.md` D11–D14. Product-analyst amending PRD, stories, BRD (agent type not registered in this session; dispatched as general-purpose under `.claude/agents/product-analyst.md`).
- 2026-11-15 — W1-001/002 delivered by product-analyst → staged at GATE 1.
- 2026-11-15 — Kakitangan studied read-only → `docs/reference/kakitangan-study.md`; sent to product-analyst.
- 2026-11-15 — Albert moved **payroll into Phase 1** (two releases: R1.0 HR/leave/claims, R1.1 payroll after parallel run). HLB = manual, no interface. AutoCount Cloud = .xlsx export only, no integration (D5, D6, D10). Product-analyst re-briefed.
- 2026-11-15 — Project started. Albert set Phase-1/Phase-2 scope, stack and governance (`01-decisions.md` D1–D9). Board created; W1-001/002 dispatched to product-analyst.
