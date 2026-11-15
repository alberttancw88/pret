# PRET — Interact UI Reference (must match)

**Source:** Interact's live app (v2.0.4 Sales Invoice screen) + official logo, provided by
Albert 2026-08-02 for Direct Order; reused for HRMS. PRET's look **must** be consistent with this. Feeds the UX and
UI design lanes and the eventual MUI theme (ADR-0013).

## Brand

- **Official logo MUST be included** in the system (login split-panel + top-left of the
  app shell). Logo = green "i" mark + blue **interact** wordmark + grey tagline
  "Business through Technology". *Asset file to be added to `assets/brand/` — Albert to
  supply SVG/PNG (see `assets/brand/README.md`).*
- **Brand colors** (approximate; finalise by sampling the official logo file):
  - Brand green `~#28C76F` (logo mark; app "Export" success actions)
  - Brand blue `~#2E7DF1` (logo wordmark; links)
  - App primary indigo `#666CFF` (measured — MUI primary, buttons/active nav)
  - Grey `~#9AA0A6` (tagline, secondary text)
- Reconciliation: keep **`#666CFF` as the MUI `palette.primary`** (matches their app);
  **brand green = `palette.success`** (Export/positive); brand blue = link/info accent.
  Single company — no per-tenant branding override.

## App shell (from the screenshot)

- **Left sidebar nav** (collapsible via « toggle), light theme:
  - Top: Interact logo + version badge (`v2.0.4`), then user greeting ("Hi, Faiza") with a
    role **chip** ("Admin", indigo).
  - Icon + label items; sections expand to sub-items (e.g. **Sales ▸ Sales Invoice /
    Sales Order / Sales Credit Note**). **Active item highlighted** with indigo fill +
    white text; parent highlighted when open.
  - Items observed: Route, Customer, Products, Promotion, Inventory, Sales, Return,
    Payment, Planogram, Feedback, Company, User.
- **Content area** on light-grey background, white **cards** with rounded corners
  (~8px) and subtle borders/shadow.

## Canonical "list" pattern (reuse everywhere)

The Sales Invoice screen is the template for every list/management screen:
1. **Filter card** (top): multi-field row of MUI outlined inputs with floating labels,
   each with a clear (×) affordance; selects for enumerated fields (Status, Proj No).
2. **Action bar** (right-aligned): `EXPORT .CSV` (contained **success/green** + icon),
   `ADD NEW …` (contained **primary/indigo**), `CLEAR` (outlined), `SEARCH` (contained
   primary). Uppercase button labels.
3. **Data table card**: MUI table — column headers with subtle dividers, row hover,
   money right-aligned (RM / MYR), first column as a **primary-colored link**
   (drill-in), **status chips** (color-coded: e.g. "Not Paid" = warning/amber, "Partial
   Paid" = info/blue, imply "Paid" = success/green), and an **Action** column with an
   icon button (eye = view).
4. **Pagination footer**: "Rows per page" select + "1–10 of N" + prev/next chevrons.

## How this maps to PRET screens

| Interact pattern | PRET screens that reuse it |
|------------------|----------------------------|
| List + filter + table + actions | Admin: employee list, leave applications, claims, leave balances, public holidays, leave/claim types. Employee: my leave, my claims. Manager: approvals queue. |
| First-column link drill-in | Employee no. → employee profile; Leave ref → leave detail; Claim no. → claim detail. |
| Status chips | Leave status (pending/approved/rejected/cancelled), claim status (D12: New / Submitted / Approved / Disbursed / Rejected / Withdrawn / Cancelled), employment status. |
| Export CSV (green) | Every list; month-end HLB payment list and AutoCount .xlsx exports. |
| Left-nav app shell | One shell; nav items driven by role (D11: Employee / Manager / Admin / Super Admin). |
| Role chip by user | Show the signed-in user's role. |
| KPI cards | Employee dashboard (leave balances, pending claims) and Admin dashboard (headcount, pending approvals, on leave today). |

## Notes for designers
- **UX Designer:** use this nav + list pattern for IA and wireframes; the employee portal is
  a lighter version of the same shell.
- **UI Designer:** encode the tokens above into the MUI theme; button color roles
  (primary vs success), chip color mapping, table + pagination specs and the login
  split-panel with the Interact logo.
