# PRET — GATE 2 (Design) Review Pack

**Prepared by:** Delivery Lead · **Date:** 15/11/2026 · **For:** Albert (sole approver) · **Status: APPROVED 15/11/2026 with all defaults (D18–D24)**
**Covers:** W1-003 architecture · W1-004 UX · W1-005 UI · built on the GATE 1 spec (v0.1.0)

Approving GATE 2 accepts the design below and every question in §4 at its default,
except where you answer differently. Build (Wave 2) starts after approval.

---

## 1. What is ready

| Lane | Output | Size |
|------|--------|------|
| Architecture | `docs/architecture/` — system design, data model, access rules (RLS), non-functional, 16 ADRs | 141 tables (payroll tables designed now, created in R1.1), RLS on every table |
| UX | `docs/design/ux/` — screen inventory, navigation per role, field-level wireframes, interaction notes | 165 screens (R1.0 140, R1.1 25); 45 designed phone-first |
| UI | `docs/design/ui/` — MUI theme tokens, component specs, dashboard visuals | Every status has a colour; every colour pair passes accessibility (AA) |

## 2. Design choices worth your attention

1. **The browser never reads PRET data from Supabase directly** (ADR-0002). Supabase's
   public data API is switched off; only PRET's own server talks to the database, acting
   as the signed-in user so the access rules still apply. This is **different from Direct
   Order** (which lets the browser query Supabase) — chosen because PRET holds NRIC, bank,
   salary and medical data. Cost: slightly more server code.
2. **Sensitive data is split into separate tables by who may see it** (ADR-0003). Managers
   have no access path at all to NRIC, bank, family, statutory numbers or religion. NRIC
   and bank numbers are also **encrypted** with keys held outside the database.
3. **Admin and Super Admin must use two-factor sign-in (MFA)** — an authenticator app — including
   the outsourced administrator (ADR-0014). Employees and managers use email + password.
4. **Role changes take effect immediately** — disabling a user or an expired outsourced-admin
   access window cuts access on the next click (ADR-0001).
5. **No self-approval, enforced in the database**, not just hidden buttons (ADR-0004).
   Claims: first approver to decide wins (D12).
6. **Leave balances are an append-only ledger** — every credit and deduction is a row, so
   any balance can be explained and re-computed (ADR-0005). Overlapping leave is impossible.
7. **Money is stored exactly to the sen** (never floating-point) (ADR-0006).
8. **Colours:** buttons use indigo `#5A5FF2` instead of the brand `#666CFF`, because white
   text on `#666CFF` fails the accessibility minimum (4.07 vs 4.5 — Delivery Lead re-checked).
   `#666CFF` stays for brand accents. Light mode only, as Direct Order.
9. **Phones:** below 600 px the left menu becomes a drawer plus a bottom bar
   **Home · Leave · Claims · Approvals (managers) · More**.

## 3. Decisions only you can make

| # | Question | Proposed default |
|---|----------|------------------|
| G2-1 (Q-ARCH-06) | Supabase backs up the database but **not uploaded files** (MCs, receipts, documents). Approve a nightly encrypted copy of files to a second storage location in Singapore? | **Yes** — second location in Singapore; restore test before each go-live. Must be settled before the production project is created. |
| G2-2 (Q-ARCH-07) | **Supabase Pro plan** (paid) for daily backups, custom email sender and leaked-password protection. Vercel Pro also needed for scheduled jobs. | **Yes, Pro for both** (same as Direct Order if it is on Pro). Must be settled before production. |
| G2-3 (Q-ARCH-08) | Encryption keys: if every copy is lost, encrypted NRIC and bank numbers cannot be recovered. | **You hold an offline copy** in your password manager; keys rotated yearly. |
| G2-4 (Q-ARCH-09) | **Email provider** for notifications. | **Same provider as Direct Order**; emails never contain sensitive data. |
| G2-5 (Q-ARCH-05) | **Virus scanning of uploads.** A scanning service would send MCs and MyKad copies outside Singapore. | **No third-party scanning in R1.0**; files are type-checked and re-encoded instead. Revisit later. |
| G2-6 (Q39, UXQ-14) | **A second Super Admin.** Payroll runs need a different person to approve than to prepare; with only you, you cannot approve a run you prepared, and approvals stall when you are away. | **Add a second Super Admin before R1.1** (payroll). Until then the Admin always prepares runs and you approve. Who? |
| G2-7 (UXQ-06) | Employees paid by **cheque or cash** in a claims batch. | Shown in a separate "Pay by cheque/cash" section, left off the HLB list. If nobody is paid by cheque/cash, the option is hidden. |
| G2-8 (UI-3) | **Logo files:** please send `interact-logo.svg` and the green "i" mark (`interact-mark.svg`). | Until then the PNG logo is used. |

## 4. Accepted at default unless you say otherwise

**Architecture (`docs/architecture/system-design.md` §17)**
- Q-ARCH-01 The outsourced administrator cannot be a leave delegate; delegates are employees.
- Q-ARCH-02 Nobody, including Super Admin, can change their own salary; your pay is maintained by the Admin.
- Q-ARCH-03 Carry-forward leave counts as used by **leave date** (days taken on or before 31/03).
- Q-ARCH-04 An Admin with their own claim in a batch cannot mark that batch Disbursed; another Admin or Super Admin must.
- Q-ARCH-10 Screens, PDFs and CSVs show `RM 1,234.56`; .xlsx keeps numbers as numbers (shown as RM); bank/AutoCount/statutory files follow their own required format.
- Q-ARCH-11 Anonymising a leaver clears live data and files; audit logs are kept untouched for 7 years.
- Q-ARCH-12 "Manager" for claims = the claim-approver override if set, else the reporting manager, plus their delegate.
- Q-ARCH-13 A manager can open an MC only while the sick leave is waiting for their decision.

**UX (`docs/design/ux/screen-inventory.md`)**
- UXQ-01 Admin/Super Admin users land on the Admin dashboard, with "My home" one click away.
- UXQ-02 Change requests stay under Employees ▸ Change requests (with a count badge), not in Approvals.
- UXQ-03 Late-claim override: Admin picks the employee and sees only their overdue New claim lines.
- UXQ-04 Reason optional to cancel future leave; required when cancellation needs approval.
- UXQ-05 Admin can reassign a pending item's approver, with a reason.
- UXQ-08 No partial cancellation of a leave range in R1.0 — cancel and re-apply.
- UXQ-10 "Approve as Admin (override)" is a separate button needing a reason.
- UXQ-11 Probation recommendation: Confirm / Extend (months) / Do not confirm, plus remarks.
- UXQ-12 TP1 (R1.1): employee can edit until verified; Admin can verify or return it.
- UXQ-13 Department, position, grade, manager, location and work pattern change only through "Add job change", keeping history.
- UXQ-09 Done — UI reference updated to the four roles and new claim statuses.

**UI (`docs/design/ui/design-system.md`)**
- UI-2 Warning colour darkened to amber-brown `#B45309` so it passes accessibility.
- UI-4 No dark mode in Phase 1.
- UI-5 A quiet slate grey `#5B6578` for low-emphasis buttons.
- Claim "Approved" chip is blue (awaiting payment) and "Disbursed" is green; leave "Approved" is green.
- Admin dashboard highlights non-zero counts in amber; claims count as aged after 30 days.

## 5. Delivery Lead checks done
- All three lanes wrote only in their own folders; nothing committed by agents.
- Roles (D11), claim statuses (D12), bank details (D15) and HLB-only payment (D16) are
  reflected consistently across architecture, UX and UI.
- Colour-contrast figures re-computed independently.
- Not yet verified: SQL and theme snippets are design-stage only (not run) — they are
  proven in the build and at GATE 3.
