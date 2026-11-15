# PRET — Low-Fidelity Wireframes (index, shared primitives, global screens)

**Work item:** W1-004 · **Author:** UX Designer · **Status:** Draft for GATE 2 (Design)
**Last updated:** 15/11/2026
**Companions:** [`screen-inventory.md`](screen-inventory.md) · [`information-architecture.md`](information-architecture.md) · [`interaction-notes.md`](interaction-notes.md)
**Aligns to:** [`docs/design/reference-interact-ui.md`](../reference-interact-ui.md) — the left-nav shell and canonical list pattern below reproduce Interact's live app; every screen inherits them.

> **Field level, not outline.** Every screen states every field (with its PRD field id),
> every list column, filter and button, and its empty / error states. This is the lesson
> from Direct Order, whose GATE 3 failed because screens were approved in outline. Low
> fidelity only: structure, hierarchy, flow. Colours, type, spacing and component
> polish are the UI Designer's lane.

## Wireframe files

| File | Covers | Screen ids |
|------|--------|-----------|
| **wireframes.md** (this file) | Shared primitives (shell, list, form, detail, dialog, mobile patterns) · global screens (sign-in, notifications, account settings, privacy notice, no access, directory, org chart) | S-GL-01 – 13 |
| [`wireframes-portal.md`](wireframes-portal.md) | Employee self-service (home, leave, claims, profile, documents, R1.1 payslips/EA/YTD/TP1) · Manager approvals & team | S-PT-01 – 25, S-AP-01 – 08 |
| [`wireframes-employees.md`](wireframes-employees.md) | Employee records admin (list, new employee, profile tabs, job change, probation, separation, rehire, change requests, bulk update, documents, bank) | S-EM-01 – 17 |
| [`wireframes-leave-admin.md`](wireframes-leave-admin.md) | Leave admin (applications, on behalf, balances, adjustments, overrides, credits, types, bands, policy, workflows, roll-over, delegations) | S-LV-01 – 14 |
| [`wireframes-claims-admin.md`](wireframes-claims-admin.md) | Claims admin (claims list, on behalf, bulk entry, late overrides, categories, limits, settings, month-end batches, HLB list, AutoCount, attachments) | S-CL-01 – 16 |
| [`wireframes-org-setup.md`](wireframes-org-setup.md) | Organisation masters, public holidays, reporting lines, system settings | S-OR-01 – 11 |
| [`wireframes-reports.md`](wireframes-reports.md) | Admin dashboard, reports catalogue, report viewer, every R1.0 report, payroll-input pack | S-RP-01 – 24 |
| [`wireframes-access-imports.md`](wireframes-access-imports.md) | Imports & migration · users, roles, audit, access review, privacy, DSR, breach, retention, notification log/templates | S-IM-01 – 04, S-AC-01 – 13 |
| [`wireframes-payroll.md`](wireframes-payroll.md) | Payroll R1.1 (settings, pay groups, items, statutory tables, compensation, runs, inputs, approval, payment list, payslips, EA/Form E, statutory outputs, reports, AutoCount journal, TP1/TP3/CP38, parallel run) | S-PY-01 – 20 |

**Legend:** `[BUTTON]` contained · `[(BUTTON)]` outlined · `[ Field ]` input · `[ Field ▾ ]` select · `[ dd/mm/yyyy 📅 ]` date · `(•)` radio · `[x]` checkbox · `●Chip` status chip · `›` drill-in link · `👁` view icon · `⋮` row menu · `⚠` inline warning/error slot · `*` mandatory · `🔒` read-only/locked · `••••1234` masked value. Field ids in braces, e.g. `{A2}`, refer to PRD §5–§14 field tables.

---

# PART 0 — Shared primitives (inherited by every screen)

## 0.1 · App shell (S-GL-05) — every authenticated page

Desktop (≥ 1024 px):
```
┌──────────────────────────┬────────────────────────────────────────────────────────┐
│ [INTERACT LOGO]  v1.0.0  │ {Breadcrumb ▸ Page title}                 [🔔 3]  (AT)▾ │ top bar
│ Hi, Aina   ●Admin        │────────────────────────────────────────────────────────│
│ «                        │                                                        │
│ ⌂ Dashboard              │   CONTENT AREA — white cards on light-grey background   │
│ ✓ Approvals          (4) │                                                        │
│ 👤 Employees ▸           │                                                        │
│ 🗓 Leave ▾               │                                                        │
│     Applications  ◀active│                                                        │
│     Balances             │                                                        │
│     …                    │                                                        │
│ 💳 Claims ▸              │                                                        │
│ …                        │                                                        │
│ ─────────────            │                                                        │
│ Privacy notice · Help    │                                                        │
└──────────────────────────┴────────────────────────────────────────────────────────┘
```
Phone (< 600 px) — same shell, lighter:
```
┌──────────────────────────────┐
│ ☰  {Page title}      [🔔 3]  │  ☰ opens the left nav as a drawer (logo, greeting, chip, items)
├──────────────────────────────┤
│                              │
│   CONTENT (single column)    │
│                              │
├──────────────────────────────┤
│ ⌂Home  🗓Leave  💳Claims ✓Appr(2) ⋯More │  bottom bar (employee users; Approvals only for MGR/ADM/SA) — UXQ-07
└──────────────────────────────┘
```
- Sidebar items, sections and their visibility: `information-architecture.md` §3.
- Role chip text: Employee / Manager / Admin / Super Admin; External users: "Admin · External".
- Avatar menu: `Account settings` (S-GL-08) · `Privacy notice` (S-GL-09, only if published) · `Sign out`.
- Bell: unread count (hidden when 0; "99+" above 99). Opens S-GL-06.
- Every page has a single `<h1>` page title; breadcrumb for admin depth ≥ 2.

## 0.2 · Canonical list pattern (every list screen)

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ FILTER CARD                                                                     │
│ [ Search keyword…        × ] [ Field ▾ × ] [ Field ▾ × ] [ From 📅 × ] [ To 📅 × ]│
│ [ More filters ▸ ]  (expands a second row when a list has > 5 filters)          │
├────────────────────────────────────────────────────────────────────────────────┤
│                         [EXPORT .CSV] [ADD NEW …] [(CLEAR)] [SEARCH]            │ action bar, right-aligned
├────────────────────────────────────────────────────────────────────────────────┤
│ [ ] Col-1 ↕        Col-2 ↕      Date ↕       Amount (RM) ↕   Status     Action  │
│ [ ] LV-2027-00012› value        05/05/2027       1,250.00   ●Approved   👁 ⋮    │
│ [ ] …                                                                           │
├────────────────────────────────────────────────────────────────────────────────┤
│ {n} selected: [BULK ACTION] [BULK ACTION]           (only when rows selected)   │
│ Rows per page [25 ▾]                          1–25 of 128      ‹  ›             │
└────────────────────────────────────────────────────────────────────────────────┘
```
Rules (FR-G-06, US-ADMIN-024) — apply to every list in every file:
- **Search**: one keyword box (fields searched are stated per list) + the list's filters; each filter individually clearable (×). Filters apply on `SEARCH` (or Enter); `CLEAR` resets to the list's defaults.
- **Sort**: every column header sortable unless stated; default sort stated per list.
- **Pagination**: 10 / 25 / 50 / 100 rows, default 25; "1–25 of N"; prev/next.
- **`EXPORT .CSV`** (green): exports the **filtered** set, all pages, only the columns the user may view; filename `<list>-<dd-mm-yyyy>.csv`; sensitive exports access-logged (F-ADM-10).
- **First column** is the drill-in link; **Action** column: 👁 view, ⋮ row menu with the row's allowed actions only.
- **Money** right-aligned "1,250.00" under a header "(RM)"; outside tables "RM 1,250.00". **Dates** dd/mm/yyyy.
- **State persistence**: filters, sort, page and rows-per-page are kept when the user opens a detail and comes back.
- **Phone (< 600 px)**: filter card collapses to a `[Filters (3)]` button opening a bottom sheet; table rows become cards (first-column link as card title, status chip top-right, 3–4 key fields, money bold); bulk select hidden unless stated.
- **Empty states**: "No {items} yet" (no data at all, with the create action if allowed) vs "No {items} match these filters" (with `CLEAR`). Details in `interaction-notes.md` §2.

## 0.3 · Form pattern

```
┌ Card: Section title ─────────────────────────────────────────────┐
│ Label *                      Label                                │
│ [ input                    ] [ input ▾                         ]  │
│ ⚠ field error text                                               │
│ Helper text (format, limits)                                      │
└───────────────────────────────────────────────────────────────────┘
                                   [(CANCEL)]  [SAVE]
```
- Mandatory fields marked `*`; conditional fields (Req **C**) appear only when their condition is met and become `*`.
- Validate on blur and on submit; error under the field; entered data kept; submit disabled while saving (FR-G-07).
- Leaving with unsaved changes: "Discard unsaved changes?" `[(KEEP EDITING)] [DISCARD]`.
- Every record footer: "Created by {name} at dd/mm/yyyy HH:mm · Last updated by {name} at dd/mm/yyyy HH:mm" (FR-G-13).
- On phone: single column, labels above inputs, primary button full-width and sticky at the bottom.

## 0.4 · Detail pattern

```
┌ Header card ────────────────────────────────────────────────────────────┐
│ LV-2027-00012                          ●Pending L1   ●EMERGENCY          │
│ Key facts (2–4 columns)                                                  │
│                                    [PRIMARY ACTION] [(SECONDARY)] [⋮]    │
└──────────────────────────────────────────────────────────────────────────┘
┌ Body cards / tabs ──────────────────┐ ┌ Side card: timeline / trail ────┐
│ …                                    │ │ ● Submitted 05/05/2027 09:12    │
└──────────────────────────────────────┘ │ ● Approved L1 by … 10:03        │
                                          └──────────────────────────────────┘
```
Only actions allowed for the user's role, scope and the record's status are shown (never disabled-with-no-reason; if an action is shown disabled, a tooltip says why, e.g. "Outputs out of date — regenerate first").

## 0.5 · Dialog pattern
Title · body (fields) · `[(CANCEL)] [CONFIRM ACTION]`. Destructive or irreversible actions name the effect in the button ("REJECT CLAIM", "MARK DISBURSED"). Reason/comment fields show a character counter. On phone, dialogs open as **bottom sheets**.

## 0.6 · Shared field widgets
| Widget | Behaviour |
|--------|-----------|
| Date `[ dd/mm/yyyy 📅 ]` | Typed or picked; picker shows PHs (dot) and non-working days (greyed) where relevant to leave; invalid → "Enter a date as dd/mm/yyyy". |
| Money `[ RM 0.00 ]` | 2 dp, thousands separator on blur, right-aligned, MYR only. |
| Employee picker `[ Search employee ▾ ]` | Type-ahead on employee no. / name; shows "INT-004 · Name · Department"; scope-filtered (active only unless stated). |
| Masked value `••••••1234 [Show]` | Reveal per field per view; ADM reveal asks a reason (S-EM-10); logged. |
| File / camera `[📷 TAKE PHOTO] [📎 CHOOSE FILE]` | JPG, JPEG, PNG, HEIC, PDF (+DOCX for documents); ≤ 10 MB; thumbnail with ✕; on phone, TAKE PHOTO opens the camera. |
| Status chip | Colour mapping owned by the UI Designer; label text fixed (see IA §7). |

---

# PART G — Global screens (all roles)

## G1 · Sign in — S-GL-01 · `/login` · F-PRT-01, F-ADM-13 · US-PORTAL-001

```
┌──────────────────────────────┬──────────────────────────────────┐
│                              │        [INTERACT LOGO]           │
│   (brand panel — UI          │        PRET                       │
│    Designer; hidden on       │        HR & Payroll               │
│    phone)                    │                                   │
│                              │   Work email *                    │
│                              │   [ name@interact.com.my       ]  │
│                              │   Password *                      │
│                              │   [ ••••••••••            👁   ]  │
│                              │   ⚠ Email or password is incorrect│
│                              │   [        SIGN IN            ]   │
│                              │   Forgot password?                │
│                              │   Privacy notice                  │
└──────────────────────────────┴──────────────────────────────────┘
```
| Field / control | Rules |
|-----------------|-------|
| Work email * | Email format; trimmed; case-insensitive |
| Password * | Show/hide toggle |
| `SIGN IN` | Disabled while submitting; on success → S-GL-04 if MFA required, else role landing page (IA §4) or the deep link the user came from |
| Forgot password? | → S-GL-02 |
| Privacy notice | → S-GL-09 (shown only if a notice is published) |
| No "Remember me" for ADM/SA (§8.4); no sign-up link (invite only) |

States: generic error "Email or password is incorrect" for any failure (never says which); after 5 failures: "Your account is locked for 30 minutes. Try again later or ask your administrator." (N-52); disabled/expired account: same generic error (no disclosure) — the event is logged.

## G2 · Forgot password — S-GL-02 · `/forgot-password` · US-PORTAL-002
Fields: Work email *. Button `SEND RESET LINK`. After submit (any email): "If an account exists for this email, a reset link has been sent. The link expires in {N} hours." · `Back to sign in`.

## G3 · Set password (invite / reset) — S-GL-03 · `/set-password?token=…` · F-ADM-02 · US-ADMIN-002
Fields: New password * (policy hint list ticks live: length, character mix — rules → Architect, BR-ADM-07) · Confirm password * (must match). Button `SET PASSWORD` → S-GL-04 if privileged, else landing page. Invalid/expired/used link: "This link is invalid or has expired." `[REQUEST A NEW LINK]` (→ S-GL-02; invite links: "Ask your administrator to re-send your invite", EC-ADM-05).

## G4 · Two-factor enrol / verify — S-GL-04 · `/mfa` · F-ADM-07 · US-ADMIN-007
- **Enrol** (first privileged sign-in, or after SA reset): step 1 QR code + manual key ("Scan with an authenticator app"); step 2 `[ 6-digit code ]` *; `VERIFY & CONTINUE`. Recovery approach → Architect.
- **Verify** (each sign-in): `[ 6-digit code ]` *; `VERIFY`; "Lost your device? Ask a Super Admin to reset two-factor." Wrong code: "Code is incorrect or expired." 5 wrong codes count toward lockout.

## G5 · Notifications — S-GL-06 panel · S-GL-07 page `/notifications` · F-PRT-13, F-NTF-02 · US-PORTAL-013
Panel (bell drop-down, max 10 latest; bottom sheet on phone):
```
┌ Notifications                      [Mark all read] ┐
│ ● Leave LV-2027-00012 approved        2 h ago     │  ● = unread
│   Annual leave 05/05/2027 – 06/05/2027            │
│ ○ Claim CL-2027-00031 disbursed       1 d ago     │
│   RM 245.60 · HLB ref 7781 · 30/11/2027           │
│ [View all notifications]                          │
└───────────────────────────────────────────────────┘
```
Page (list pattern): Filters — Read status (All / Unread), Category (Leave / Claims / Profile & requests / Payroll (R1.1) / System), Date from–to. Columns — Status dot · Title (link → deep link, marks read) · Summary · Category · Received (dd/mm/yyyy HH:mm). Actions — `MARK ALL READ`, `EXPORT .CSV` (own notifications, filtered set — FR-G-06), `CLEAR`, `SEARCH`; row ⋮ Mark read/unread. Search: title and summary text. Pagination 25. Empty: "You're all caught up."

## G6 · Account settings — S-GL-08 · `/account` · F-PRT-14, F-NTF-06, F-LV-24 · US-PORTAL-014, US-LEAVE-031
Tabs: **Password** · **Notifications** · **Delegation** (MGR, ADM, SA only) · **Two-factor** (ADM/SA: status, "Reset requires a Super Admin").

*Password:* Current password * · New password * · Confirm new password * · `CHANGE PASSWORD`. Success: "Password changed. Other sessions have been signed out."

*Notifications (F-NTF-06, Could):* table Event group · Email (toggle) · In-app (always on, 🔒). Action-required events show 🔒 "Required" (BR-NTF-04). `SAVE`.

*Delegation:*
```
┌ My delegations                                         [ADD DELEGATE] ┐
│ Delegate              From         To           Scope    Status   ⋮    │
│ INT-003 · Name        01/06/2027   10/06/2027   Both     ●Active  End  │
└────────────────────────────────────────────────────────────────────────┘
```
Add delegate dialog: Delegate * (employee picker — active employees and internal ADM users; never self, never External users, BR-ADM-04) · From * (date ≥ today) · To * (≥ From) · Scope * (•) Leave (•) Claims (•) Both · `SAVE DELEGATE` → N-17 to delegate. Row actions: `END NOW` (sets To = today), `EDIT` (future only). Overlapping delegations for the same scope: blocked "You already have a delegate for these dates."

## G7 · Privacy notice — S-GL-09 · `/privacy-notice` · F-ADM-15 · US-ADMIN-015
Shows the current notice: Title · Effective date · Body text and/or embedded PDF with `DOWNLOAD PDF`. Link "Previous versions" → list (Title · Effective date · Replaced on · View). No acknowledgement button (D14). If none published: route hidden from nav; direct URL shows "No privacy notice has been published."

## G8 · Not found or no access — S-GL-10 · FR-G-02 · US-ADMIN-020/021
"Not found or no access. The page may not exist, or you may not have access to it." `[GO TO HOME]`. Same response for "does not exist" and "not allowed" (no data leakage, EC-PRT-03); attempt logged.

## G9 · Session expired — S-GL-11 · F-ADM-14 · US-ADMIN-014
Warning dialog 2 minutes before idle timeout (30 min; 15 min ADM/SA): "You'll be signed out in 1:59 for inactivity." `[(SIGN OUT)] [STAY SIGNED IN]`. After timeout: dialog "Your session has ended. Sign in again to continue." with password (and MFA code for privileged) re-entry; unsaved form data on the page is kept in the form and restored after re-authentication where possible (interaction-notes §6).

## G10 · Staff directory — S-GL-12 · `/directory` · F-EMP-23 · US-EMP-020
List pattern; phone = cards with photo. Search: name, preferred name, position, department. Filters: Department (multi), Work location (multi). Columns (exactly FR-EMP-14, nothing else): Photo · Name (preferred name in brackets) · Position · Department · Work location · Work email (mailto) · Work phone (tel). Active employees only. Actions: `EXPORT .CSV` (same seven columns only — FR-G-06; no other data), `CLEAR`, `SEARCH`. Default sort Name asc; pagination 25. Empty: "No colleagues match."

## G11 · Org chart — S-GL-13 · `/org-chart` · F-EMP-22 (Could) · US-EMP-025
Top-down tree from Top of organisation; node = photo · name · position (names/positions only). Controls: `[ Find person ▾ ]` (centres and highlights), Department filter, expand/collapse, zoom +/−, `FIT`. Phone: indented collapsible list instead of a tree. Click node → S-GL-12 entry (ADM/SA: → S-EM-03).

---

## Open UX questions for Albert
Consolidated in [`screen-inventory.md`](screen-inventory.md#open-ux-questions-for-albert) (UXQ-01 – UXQ-14). Each module file lists the ones that touch it.

## Ready for GATE 2 (design)?
Shared primitives and global screens are specified at field level; module files cover every remaining screen. **Yes — ready for GATE 2 review** with the module files below.
