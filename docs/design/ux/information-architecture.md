# PRET — Information Architecture & Navigation

**Work item:** W1-004 · **Author:** UX Designer · **Status:** Draft for GATE 2 (Design)
**Last updated:** 15/11/2026
**Inputs:** PRD §3 (roles, D11), §8.3 (navigation by role), §16 (access matrix); `reference-interact-ui.md` (left-nav shell).
**Companions:** [`screen-inventory.md`](screen-inventory.md) (screen ids `S-…`) · [`wireframes.md`](wireframes.md) · [`interaction-notes.md`](interaction-notes.md).

---

## 1. Principles

1. **One shell for everyone** (F-PRT-18). The Interact left-nav shell (logo + version
   badge, "Hi, {preferred name}" + role chip, icon+label items with expandable sections,
   active item highlighted) wraps every authenticated page. The employee portal is the
   *lighter* version of the same shell — fewer items, never a different app.
2. **Two zones in one nav:** **"My …"** (self-service: things about me) on top, then
   **work zones** (Approvals, My Team, admin modules). A user sees the union of their
   roles' items (FR-PRT-12). External administrators never see "My" items (EC-PRT-02).
3. **Four roles only (D11):** EMP, MGR (derived — no assignment UI), ADM, SA. The role
   chip shows the **highest** role held: Super Admin > Admin > Manager > Employee.
4. **Navigation is not access control.** Every route, server action and query re-checks
   role and scope (own / team / all) — FR-G-02. Typing a URL to a screen outside your
   role returns S-GL-10 "Not found or no access" and is logged (EC-PRT-03).
5. **Admin work is grouped by the job, not by the old roles.** The former HR / Finance /
   Payroll split is gone: Employees, Leave, Claims, Payroll are sibling sections inside
   one Admin workspace.
6. **Lists are the entry point, detail is one click away.** Every module lands on its
   canonical list (filter card → action bar → table → pagination); the first column
   drills into the detail; filter state is kept when coming back (FR-G-06).
7. **Phone-first for EMP and MGR** (FR-G-14, §8.4): the five things people do on a phone
   — apply leave, submit a claim with a receipt photo, check balances, approve, see who
   is away — are reachable in one tap from Home or the bottom bar.

## 2. Global chrome (all authenticated pages — S-GL-05)

| Element | Position | Content / behaviour | Roles |
|---------|----------|--------------------|-------|
| Logo + version badge | Sidebar top | Interact logo (required) + `vX.Y.Z`; click → Home | All |
| Greeting + role chip | Below logo | "Hi, {preferred name or display name}" + chip (Employee / Manager / Admin / Super Admin); External users show "Admin · External" | All |
| Collapse toggle « | Sidebar | Collapses to icons (desktop); state remembered per browser | All |
| Page title + breadcrumb | Top bar left | e.g. "Claims ▸ Disbursement batches ▸ PB-2027-011" | All |
| Notification bell + unread count | Top bar right | Opens S-GL-06; count = unread (FR-PRT-08) | All |
| Avatar menu | Top bar right | Account settings (S-GL-08) · Privacy notice (S-GL-09, if published) · Sign out | All |
| Footer links | Sidebar bottom | Privacy notice · Help (link to user guide, when it exists) | All |
| Bottom bar (< 600 px only) | Screen bottom | Home · Leave · Claims · Approvals (MGR/ADM/SA, with badge) · More (opens drawer) — UXQ-07 | Employee users |

## 3. Navigation per role

### 3.1 Employee (EMP) — self-service only

```
Home                                   S-PT-01
My Leave ▸
   Apply leave                         S-PT-02
   My applications                     S-PT-03  (→ S-PT-04 detail)
   My balances                         S-PT-05  (→ S-PT-06 ledger, S-PT-07 yearly report)
   Replacement credits                 S-PT-09  (→ S-PT-08 request)
   Leave calendar                      S-PT-10
   Public holidays                     S-PT-11
My Claims ▸
   My claims                           S-PT-12  (→ S-PT-15 detail)
   New claim                           S-PT-13
My Pay ▸                               (R1.1)
   Payslips                            S-PT-21  (→ S-PT-22)
   EA forms                            S-PT-23
   YTD statement                       S-PT-24
   TP1 declarations                    S-PT-25
My Profile ▸
   Profile                             S-PT-16
   Change requests                     S-PT-18  (→ S-PT-17 new)
   Documents                           S-PT-19
   Download my data                    S-PT-20
Directory ▸
   Staff directory                     S-GL-12
   Org chart                           S-GL-13
```

### 3.2 Manager (MGR) — EMP items plus

```
Approvals  (badge = items awaiting me)  S-AP-01  (→ S-AP-02/03/04)
My Team ▸
   Team members                        S-AP-06  (→ S-AP-07)
   Team leave                          S-LV-01  [scope: team]
   Team balances                       S-LV-03  [scope: team]
   Team claims                         S-CL-01  [scope: team]
   Team reports                        S-RP-02  [team reports: S-RP-07, S-RP-10, S-RP-13, S-RP-24]
```
Leave calendar (S-PT-10) automatically shows the manager's reportees with leave types.
Delegation is set in Account settings ▸ Delegation (S-GL-08). The manager panel appears on Home (F-RPT-22).

### 3.3 Admin (ADM) — workspace (plus EMP/MGR items if the Admin is also an employee/manager)

```
Dashboard                              S-RP-01
[My home, My Leave, My Claims, My Pay, My Profile — only if an employee user; UXQ-01]
Approvals (badge)                      S-AP-01   leave at Admin level; all Submitted claims; approved-not-disbursed
Employees ▸
   All employees                       S-EM-01  (→ S-EM-03 profile; S-EM-02 new)
   Change requests (badge)             S-EM-12  (→ S-EM-13)
   Bulk update                         S-EM-14
Leave ▸
   Applications                        S-LV-01
   Balances                            S-LV-03
   Adjustments                         S-LV-04
   Entitlement overrides               S-LV-06
   Replacement credits                 S-LV-07
   Calendar                            S-PT-10  [scope: all]
   Delegations                         S-LV-14
   Year-end roll-over                  S-LV-13
   Setup ▸ Leave types (S-LV-08) · Entitlement bands (S-LV-10) · Policy (S-LV-11) · Approval workflows (S-LV-12)
Claims ▸
   All claims                          S-CL-01
   Disbursement batches                S-CL-09  (→ S-CL-10 new, S-CL-11 detail)
   Late overrides                      S-CL-04
   Bulk entry (Could)                  S-CL-03
   Setup ▸ Categories & limits (S-CL-05/06/07) · Claims settings (S-CL-08)
Payroll ▸  (R1.1)
   Payroll runs                        S-PY-06  (→ S-PY-08)
   Payslips                            S-PY-14
   Statutory outputs                   S-PY-16
   Annual returns (EA / Form E)        S-PY-15
   TP1 / TP3 / CP38                    S-PY-19
   Parallel run                        S-PY-20
   Payroll reports                     S-PY-17
   Setup ▸ Payroll settings (S-PY-01) · Pay groups (S-PY-02) · Pay items (S-PY-03) · Statutory tables (S-PY-04)
Organisation ▸
   Company profile                     S-OR-01  (view + non-statutory edit)
   Departments · Positions · Grades    S-OR-02/03/04
   Work locations · Working patterns   S-OR-05/06
   Public holidays                     S-OR-07
   Reporting lines                     S-OR-08
   Cost centres · Employee groups      S-OR-09/10 (Could)
Reports                                S-RP-02
Imports ▸
   Import data                         S-IM-01 / S-IM-02
   Migration reconciliation            S-IM-04
Users & access ▸
   Users                               S-AC-01  (employee users without privileged roles)
   Role reference                      S-AC-04
Privacy & logs ▸
   Privacy notice                      S-AC-08
   Data-subject requests (read)        S-AC-09
   Notification log                    S-AC-12
Settings                               S-OR-11  (view; edit leave/claims/payroll operating settings)
```

### 3.4 Super Admin (SA) — everything ADM sees, plus

```
Users & access ▸ Users (all, incl. External and privileged) · Invite external administrator · Assign roles (on S-AC-03)
Audit & privacy ▸
   Audit & access log                  S-AC-05
   Access review                       S-AC-07
   Data-subject requests (edit)        S-AC-09
   Breach & incidents                  S-AC-10
   Retention & anonymisation           S-AC-11
   Notification templates              S-AC-13
Settings (all, incl. control settings) S-OR-11
Company profile (statutory numbers, HLB paying account) S-OR-01 edit
Approvals ▸ also: disbursement batches pending approval (only when the setting is on) · payroll runs pending approval (R1.1)
Payroll ▸ Statutory tables — Verify action (maker ≠ checker)
```

### 3.5 Visibility matrix — top-level nav items

| Nav item | EMP | MGR | ADM | SA |
|----------|-----|-----|-----|----|
| Home / Dashboard | Home | Home (+ manager panel) | Admin dashboard (My home if employee — UXQ-01) | Admin dashboard |
| My Leave · My Claims · My Profile | ✓ | ✓ | if employee user | if employee user |
| My Pay (R1.1) | ✓ | ✓ | if employee user | if employee user |
| Directory | ✓ | ✓ | ✓ | ✓ |
| Approvals | — | ✓ team | ✓ all (not own) | ✓ all (not own) |
| My Team | — | ✓ | if manager | if manager |
| Employees | — | — | ✓ | ✓ |
| Leave (admin) | — | — | ✓ | ✓ |
| Claims (admin) | — | — | ✓ | ✓ |
| Payroll (R1.1) | — | — | ✓ | ✓ |
| Organisation | — | — | ✓ | ✓ |
| Reports | — | via My Team (team reports) | ✓ | ✓ |
| Imports | — | — | ✓ | ✓ |
| Users & access | — | — | ✓ (limited) | ✓ |
| Privacy & logs / Audit & privacy | — | — | ✓ (notice, DSR read, notification log) | ✓ (all) |
| Settings | — | — | ✓ (view + operating) | ✓ |

## 4. Landing pages and deep links

| User | After sign-in lands on | Deep links from notifications |
|------|-----------------------|-------------------------------|
| EMP / MGR | Home S-PT-01 | Leave → S-PT-04 (own) or S-AP-02 (as approver); claim → S-PT-15 or S-AP-04; credit → S-PT-09 / S-AP-03; CR → S-PT-18 |
| ADM (internal or External) | Admin dashboard S-RP-01 | as above + S-EM-13 (CR), S-CL-11 (batch), S-IM-03 (import), S-PY-08 (run) |
| SA | Admin dashboard S-RP-01 | as ADM + S-AC-03 (user, access expiry), S-AC-09 (DSR due) |
| Any user, link outside scope | S-GL-10 "Not found or no access" (logged) | — |
| Signed-out user opens a deep link | S-GL-01, then returns to the link after sign-in (if still in scope) | — |

## 5. Object model the user navigates (who sees which object, where)

| Object | Ref format | List screens | Detail screen | Who |
|--------|-----------|--------------|---------------|-----|
| Employee | `INT-nnn` | S-EM-01, S-AP-06, S-GL-12 | S-EM-03 (ADM/SA) · S-AP-07 (MGR) · S-PT-16 (own) | per §16 |
| Leave application | `LV-yyyy-nnnnn` (`-1/-2` split) | S-PT-03, S-AP-01, S-LV-01 | S-PT-04 (own) · S-AP-02 (approver/admin) | own / team / all |
| Replacement credit | `RL-yyyy-nnnnn` | S-PT-09, S-AP-01, S-LV-07 | S-PT-09 detail · S-AP-03 | own / team / all |
| Claim | `CL-yyyy-nnnnn` | S-PT-12, S-AP-01, S-CL-01, S-CL-11 | S-PT-15 (own) · S-AP-04 (approver/admin) | own / team / all |
| Disbursement batch | `PB-yyyy-nnn` | S-CL-09 | S-CL-11 | ADM, SA |
| Change request | `CR-yyyy-nnnnn` | S-PT-18, S-EM-12, profile tab 13 | S-PT-18 detail · S-EM-13 | own / all |
| Import | `IM-yyyy-nnn` | S-IM-01 | S-IM-03 | ADM, SA |
| Payroll run (R1.1) | `PR-yyyy-mm-nn` | S-PY-06 | S-PY-08 | ADM, SA |
| Payslip (R1.1) | month | S-PT-21, S-PY-14, profile tab 8 | S-PT-22 | own / all |

## 6. Key task flows (happy path, screen sequence)

| # | Task | Role | Flow |
|---|------|------|------|
| T1 | Apply annual leave on a phone | EMP | Home → `APPLY LEAVE` → S-PT-02 (type → dates → session → reason) → preview → `SUBMIT` → confirmation → S-PT-04 |
| T2 | Sick leave with MC photo | EMP | Home → `APPLY LEAVE` → type Sick → dates → `ADD MC` (camera) → `SUBMIT` |
| T3 | Submit a 3-line claim with receipt photos | EMP | Home → `NEW CLAIM` → S-PT-13 title → `ADD LINE` → S-PT-14 (category, date, amount, 📷) ×3 → `SAVE` (New) → `SUBMIT` → S-PT-15 |
| T4 | Approve leave and a claim on a phone | MGR | Push/email link or bottom-bar Approvals → S-AP-01 tab → item → S-AP-02 / S-AP-04 → `APPROVE` (comment optional) / `REJECT` (comment/reason required) → back to inbox (next item) |
| T5 | Copy a rejected claim | EMP | S-PT-15 (Rejected) → `COPY TO NEW CLAIM` → S-PT-13 (New, "Copied from CL-…") → fix → `SUBMIT` |
| T6 | Month-end disbursement | ADM | Claims ▸ Disbursement batches → `NEW MONTH-END BATCH` → S-CL-10 (month, cut-off, claims pre-selected, deselect) → `CREATE BATCH` → S-CL-11 `GENERATE OUTPUTS` → download HLB list (.xlsx/PDF) + AutoCount .xlsx → key into HLB Connect First (outside PRET) → `MARK DISBURSED` (date + HLB ref) |
| T7 | Hire a new employee | ADM | Employees → `ADD NEW EMPLOYEE` → S-EM-02 steps 1–6 → `CREATE` → S-EM-03 (invite scheduled) |
| T8 | Process a resignation | ADM | S-EM-03 → `RECORD SEPARATION` → S-EM-07 (notice date, type, reason, LWD, access end, leaver leave position) → `SAVE` |
| T9 | Employee changes bank account | EMP → ADM | S-PT-16 Bank tab → `REQUEST CHANGE` → S-PT-17 (new bank, account, holder, proof) → ADM: Employees ▸ Change requests → S-EM-13 → `APPROVE` → N-41 to employee (work + personal email) + SA |
| T10 | Year-end | ADM | Leave ▸ Year-end roll-over → S-LV-13 `PREVIEW` → review → `RUN ROLL-OVER` → report S-RP-17 |
| T11 | Migration go-live | ADM/SA | Imports → T1 → T2 → T3–T5 → T6 → T7 → T8–T10 (each: validate → commit) → S-IM-04 control totals → SA `SIGN OFF` → Employees ▸ bulk `SEND INVITES` |
| T12 | Monthly payroll (R1.1) | ADM → SA → ADM | Payroll runs → `NEW RUN` → S-PY-08 Inputs (S-PY-10) → `CALCULATE` → Exceptions → `SUBMIT FOR APPROVAL` → SA `APPROVE` (S-PY-11) → S-PY-13 payment list → key into HLB → `FINALISE` → payslips publish at pay date → S-PY-16 statutory files |
| T13 | Parallel run month (R1.1) | ADM, SA | Imports T15 (Kakitangan results) → Run in Parallel mode → S-PY-20 reconcile → explain variances → after 2–3 zero-variance months SA `SIGN OFF CUT-OVER` |

## 7. Naming conventions in the UI

- Menu labels in sentence case ("Disbursement batches"); **buttons UPPERCASE** per the
  Interact list pattern (`EXPORT .CSV`, `ADD NEW …`, `CLEAR`, `SEARCH`).
- Use the decided terms exactly: claim statuses **New, Submitted, Approved, Disbursed,
  Rejected, Withdrawn, Cancelled** (D12); leave statuses **Pending (L1/L2), Approved,
  Rejected, Withdrawn, Cancellation pending, Cancelled**; roles **Employee, Manager,
  Admin, Super Admin**.
- Money **RM 1,234.56**; dates **dd/mm/yyyy**; date-times **dd/mm/yyyy HH:mm** (MYT);
  leave days to 1 dp ("12.5 days").
- Reference numbers always shown in full and copyable (tap-to-copy on phone).

## Open UX questions for Albert

See the consolidated list in [`screen-inventory.md`](screen-inventory.md#open-ux-questions-for-albert). IA-specific: **UXQ-01** (landing page for employees who hold Admin/Super Admin), **UXQ-02** (change requests in the Approvals inbox or not), **UXQ-07** (phone bottom bar).

## Ready for GATE 2 (design)?

Navigation for all four roles, both releases, landing pages, deep links and the main task
flows are defined; every nav item resolves to a screen in the inventory. **Yes — ready for
GATE 2 review**, subject to Albert's answers on UXQ-01, -02 and -07 (defaults designed).
