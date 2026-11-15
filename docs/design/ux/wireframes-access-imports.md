# PRET — Wireframes: Imports & migration · Users, access, audit, privacy, notifications

**Work item:** W1-004 · **Author:** UX Designer · **Status:** Draft for GATE 2 (Design) · **Last updated:** 15/11/2026
**Shared primitives:** [`wireframes.md`](wireframes.md) §0. **Screens:** S-IM-01 – 04 (ADM, SA) · S-AC-01 – 13. Field ids are PRD §10 (`U` user, `AU` audit) and §13 (templates T1–T16).

---

# Imports & migration (M9)

## A1 · Imports — S-IM-01 · `/imports` · F-MIG-01, F-MIG-11 · US-MIG-001, 003
Two cards.
*Templates* table: Template · Purpose · Upsert key · Release · `DOWNLOAD .CSV` · `DOWNLOAD .XLSX` (with "Field guide" and code-list sheets, synthetic examples) · `IMPORT` (→ S-IM-02 pre-selected). Rows in recommended order: T1 Organisation masters · T2 Employees · T3 Emergency contacts · T4 Spouses · T5 Children · T6 Job history · T7 Opening leave balances · T8 Leave history (current year) · T9 Future-dated approved leave · T10 Public holidays · T11 Claims history (Could) · T12 Documents zip + manifest (Could) · T13 Compensation (R1.1) · T14 YTD payroll balances (R1.1) · T15 Kakitangan payroll results (R1.1) · T16 TP1 / TP3 / CP38 (R1.1). Order hint: "Import T1 before T2; T2 before T3–T9."
*Import log* (list pattern): Search import no., file name · Filters Template, Status (Validated / Committed / Failed), Mode, User, Date from–to · Columns Import no. › · Template · File name · Mode · Rows · Inserted · Updated · Errors · User · Started · Finished · Status ● · `EXPORT .CSV`.

## A2 · Import wizard — S-IM-02 · `/imports/new?template=` · F-MIG-02–10, 14–19 · US-MIG-002, 004–010, 013–017
```
Step 1 Template & file ── Step 2 Validation result ── Step 3 Commit
```
*Step 1:* Template * (select) · File * (.csv / .xlsx ≤ 10 MB; T12 = .zip + manifest) · Mode * (•) Validate only — dry run (default) (•) Validate and commit · For T7: "As at (cut-over) date *" · `VALIDATE`.
*Step 2:* summary tiles Rows total · Valid · Errors · Warnings · Will insert · Will update (upsert key). Errors table: Row · Column · Value (masked for sensitive columns) · Message (e.g. "Date must be dd/mm/yyyy", "Leave type 'XL' not configured — valid codes: AL, SL, …", "Manager INT-009 not found", "Reporting line would create a loop"). Warnings table (e.g. "DOB differs from MyKad — file value kept"). `DOWNLOAD ERROR REPORT (.csv)` (original columns + "Error"). `[x] I have reviewed the {n} warnings` required to continue. `[(UPLOAD A CORRECTED FILE)] [COMMIT IMPORT]` — commit enabled only with 0 errors.
*Step 3:* progress then result: "IM-2027-004 committed — 57 inserted, 0 updated." (all-or-nothing). Links: view log (S-IM-03) · next template · for T2: "Employees are not invited automatically — [GO TO EMPLOYEES TO SEND INVITES]" (F-MIG-12). N-56 to the initiator.

## A3 · Import log detail — S-IM-03 · `/imports/{no}` · F-MIG-11
Fields: Import no. · Template · File name · Mode · Rows / inserted / updated / errors · User · Started / finished · Status · Source file (`DOWNLOAD` until deleted 30 days after commit, then "Source file deleted dd/mm/yyyy") · Error report download · Audit link.

## A4 · Migration reconciliation & sign-off — S-IM-04 · `/imports/reconciliation` · F-MIG-13 · US-MIG-012
```
┌ Migration reconciliation · cut-over 01/02/2028                                   ┐
│ Control item                    Kakitangan (enter)   PRET     Difference  Status │
│ Active employees                [ 57 ]               57       0           ✓      │
│ AL total balance (days)         [ 412.5 ]            412.5    0.0         ✓      │
│ SL total balance (days)         [ 701.0 ]            699.0    −2.0        ✕ › per-employee │
│ … one row per leave type                                                         │
│ Future approved leave (count)   [ 9 ]                9        0           ✓      │
│ Statutory corrections (D13) applied  —               12 adjustments            ℹ │
│ Remarks [                                   ]                                    │
│ [SAVE CONTROL TOTALS]                 [SIGN OFF] (SA; enabled when all ✓)         │
└──────────────────────────────────────────────────────────────────────────────────┘
```
Per-employee difference drill-down: Employee · Type · Kakitangan value (entered/imported) · PRET value · Difference. Sign-off record: name · dd/mm/yyyy HH:mm · remarks (read-only once signed; "Go-live checklist item ✓"). R1.1 equivalent: S-PY-20.

---

# Users, roles & access (M6)

## A5 · Users — S-AC-01 · `/users` · F-ADM-01 · US-ADMIN-001
List: Search email, display name, employee no. · Filters User type (Employee user / External administrator), Role (Admin / Super Admin / none), Status (Invited / Active / Locked / Disabled / Expired), Last login before/after, MFA (Enrolled / Not enrolled) · Columns Display name › · Login email · User type · Linked employee · Roles (chips; Manager shown as derived "Manager (n reportees)") · Status ● · Last login · MFA · Access end · `INVITE USER` · `EXPORT .CSV`. ADM scope: employee users without privileged roles only (others hidden).

## A6 · Invite user — S-AC-02 · `/users/new` · F-ADM-02, F-ADM-04 · US-ADMIN-002, 003
U3 User type * (•) Employee user (•) External administrator (SA only).
*Employee user:* U4 Linked employee * (employees without a user) → U1 Login email 🔒 = work email · U2 Display name (default preferred + surname) · U5 Roles (SA only: [ ] Admin [ ] Super Admin) · U7 Access start (default today) · Invite (•) Send now (•) Schedule dd/mm/yyyy.
*External administrator (SA):* U1 Login email * · U2 Display name * · U9 Service provider (company) * · U5 Roles 🔒 Admin · U7 Access start * · U8 Access end * (auto-expiry) · note "External users never get Employee or Manager access and cannot be a delegate; every record they open is logged." 
`SEND INVITE` → N-50; privileged role → N-53 to user and SA.

## A7 · User detail — S-AC-03 · `/users/{id}` · F-ADM-03/04/05/07/13 · US-ADMIN-004, 005, 007, 013
Header: Display name · email · type · status ● · roles. Cards: *Account* (U1–U4, U9, U15) · *Roles* (SA: toggles Admin / Super Admin with `SAVE ROLES`; confirm "Assigning Super Admin gives full access including audit logs"; blocked on own account "You can't change your own roles" and when removing the last active SA — EC-ADM-01) · *Access window* (U7, U8; External: `EXTEND ACCESS` SA) · *Security* (U13 MFA status + `RESET TWO-FACTOR` SA · U14 last login / failed attempts) · *Login history* list (dd/mm/yyyy HH:mm · Result · IP · Device; filters result, date range; `EXPORT .CSV`).
Actions (by status, not on own account): `RESEND INVITE` (Invited) · `UNLOCK` (Locked) · `SEND PASSWORD RESET` · `DISABLE` (reason) · `RE-ENABLE` · SA only for privileged/External users (BR-ADM-01).

## A8 · Role permission reference — S-AC-04 · `/users/roles` · F-ADM-08 · US-ADMIN-008
Read-only rendering of PRD §16: rows = function groups, columns EMP · MGR · ADM · SA, cells with codes (C R U A X · o/t/a) and notes; legend; search box filters rows; `PRINT`, `EXPORT .CSV`. Top: role descriptions (PRD §3) and "Roles are fixed in Phase 1."

---

# Audit, privacy & notifications

## A9 · Audit & access log — S-AC-05 · `/audit` · F-ADM-09/10/11, F-PAY-41 · US-ADMIN-009–011 · SA only
List: Filters Date from–to * (default last 7 days) · Actor (user) · User type (External only toggle) · Action (AU4 values, multi) · Entity type · Employee concerned · Data category (AU10, multi) · Search entity reference · Columns Timestamp (dd/mm/yyyy HH:mm:ss) · Actor (+ roles at the time) · Action · Entity / reference › · Employee concerned · Data categories · Reason · 👁 · `EXPORT .CSV` (the export is itself logged). Row → **S-AC-06 entry detail** dialog: AU1–AU10 incl. field changes table (Field · Before · After — masked; `REVEAL` logged) · IP · user agent · "On behalf of". Append-only — no edit/delete controls anywhere.

## A10 · Access review — S-AC-07 · `/audit/access-review` · F-ADM-12 · US-ADMIN-012 · SA
Month selector *. Sections: Users (User · Type · Roles · Status · Last login · Days since login) · External users (Provider · Access end · Records opened · Sensitive views · Exports) · Flags (bank change + payment-list export by the same user within 7 days — EC-ADM-04 · changes to an SA's own compensation (R1.1) · privileged role changes) · `MARK REVIEWED` (remarks; by/at stored) · `EXPORT .CSV`.

## A11 · Company privacy notice — S-AC-08 · `/privacy/notice` · F-ADM-15 · US-ADMIN-015
Current notice card (Title · Effective date · Published by/at · `VIEW`). `PUBLISH NEW NOTICE` form: Title * (100) · Body text (rich text) and/or PDF (at least one) · Effective date * → "Publishing replaces the current notice; the old one is kept in history. No acknowledgement is collected." `PUBLISH` → N-55 (in-app FYI). History list: Title · Effective date · Replaced on · Published by · `VIEW`.

## A12 · Data-subject requests — S-AC-09 · `/privacy/dsr` · F-ADM-18 · US-ADMIN-018
List: Search request no., person · Filters Status (Open / Responded / Extended / Closed), Type (Access / Correction / Portability / Other), Due within N days · Columns Request no. › · Person · Type · Received · Due (received + 21 days; ⚠ ≤ 5 days) · Status ● · Response date · `NEW REQUEST` (SA) · `EXPORT .CSV`. Form (SA edit; ADM read-only): Person * (employee picker or free text for ex-employees) · Type * · Received date * · Due date 🔒 · Status * · Response date · Notes (1000). Link "Generate data file for this employee" → same output as S-PT-20 (logged).

## A13 · Breach-readiness & incidents — S-AC-10 · `/privacy/incidents` · F-ADM-17 · US-ADMIN-017 · SA
*Extract* card: Time window from–to * · User (optional) · Data category (multi, optional) · `RUN EXTRACT` → table Employee · Data categories · Records accessed/exported · Actor · When · `EXPORT .CSV`.
*Incident register* list: Incident no. › · Detected at · Categories · Affected count · Commissioner notified at (⚠ target ≤ 72 h from detection) · Data subjects notified at · Status · `NEW INCIDENT`. Form: Detected at * · Description * · Data categories * · Affected count · Commissioner notified at · Data subjects notified at · Closure notes.

## A14 · Retention & anonymisation — S-AC-11 · `/privacy/retention` · F-ADM-16 · US-ADMIN-016 · SA
List "Due for anonymisation": Employee › · Separated on · Retention class · Retention ends · Status (Due / Anonymised dd/mm/yyyy) · Filters Due by date · `EXPORT .CSV`. Per-row `ANONYMISE`: dialog lists what is removed (identity, contact, family, bank, statutory numbers, documents, attachments) and what is kept (aggregate leave/claim/payroll figures); type the employee no. to confirm · `ANONYMISE PERMANENTLY` (irreversible, logged).

## A15 · Notification log — S-AC-12 · `/notifications/log` · F-NTF-07 · US-NOTIF-008
List: Search recipient, reference · Filters Event (N-xx, multi), Channel (Email / In-app), Delivery status (Sent / Delivered / Failed / Bounced), Date from–to · Columns Sent at · Event · Recipient · Channel · Delivery status ● · Link (reference ›) · Content summary (no personal data, BR-NTF-02) · `EXPORT .CSV`.

## A16 · Notification templates — S-AC-13 · `/notifications/templates` · F-NTF-05 · US-NOTIF-010 · SA
List: Event id · Event · Recipients · Email ✓ · In-app ✓ · Action-required (✓ = cannot be opted out) · Editable (Could) · `VIEW`. Detail: subject and body with placeholders (e.g. `{reference}`, `{dates}`, `{link}`) — R1.0 read-only; if the Could is built: editable subject/body with `PREVIEW` (synthetic sample) and a guard "Placeholders for NRIC, bank account, salary or diagnosis are not available" (F-NTF-08); `SAVE` / `RESET TO DEFAULT`.

---

## Ready for GATE 2 (design)?
Import flow with dry-run validation and reconciliation sign-off; user/role management for SA and ADM scopes; audit, privacy and notification screens specified at field level. **Yes.**
