# PRET — Modern UI refresh: three visual directions

**Work item:** W2-009 · **Author:** UI Designer · **Status:** Draft for GATE 2 (design step) · **Last updated:** 23/11/2026
> **DECISION (GATE 2, D35): Albert chose Direction B · Sunrise** for the admin portal, the employee portal (desktop) and mobile web. Spec: [`theme-tokens.md`](theme-tokens.md) (Sunrise). The Clarity recommendation below is kept for the record; its tokens are in [`theme-tokens-clarity.md`](theme-tokens-clarity.md). Sunrise's cons (low density, bubbly look for payroll) are handled by the "calm admin" rules in `theme-tokens.md` §0: pastel rationed on admin, tables on plain white, hero on portal Home only, Compact density mode, numerals in Inter.

**Decision:** D34 (modern look; no longer bound to Interact's customer-facing systems). **Preview:** [`preview.html`](preview.html) (open in a browser; tabs switch direction, "Compare" shows all three). **Tokens for the recommended direction:** [`theme-tokens.md`](theme-tokens.md).

> Everything below changes **look only**. Fields, flows, roles, list pattern (search, filters, pagination, CSV export), dd/mm/yyyy dates, RM 1,234.56 money, WCAG AA and the MUI 7 + Emotion stack are unchanged. The Interact logo stays as the product mark in all three. All sample data in the preview is synthetic.

## Shared ground rules (all three directions)

- **Contrast:** body text >= 4.5 : 1, large text and UI boundaries (input borders, focus rings, icons that carry meaning) >= 3 : 1. Ratios below are computed from the WCAG 2.x relative-luminance formula, rounded to 2 dp; the frontend must re-assert them in a unit test (see `theme-tokens.md` §12).
- **Focus:** 2 px ring, 2 px offset, in the primary colour of the surface, on every control.
- **Touch targets:** >= 44 px on phone; 8 px minimum gap between adjacent targets.
- **Status never colour-only:** text label on every chip, icon on every flag.
- **Numbers:** `font-variant-numeric: tabular-nums` on money, counts, dates in tables.
- **Phone floor:** 360 px wide; bottom bar + sticky action bar pattern unchanged.
- **Buttons:** all three drop the old UPPERCASE button label. Sentence case is more modern and more readable; the label text itself is unchanged ("Export .CSV", "Apply leave"). See open question 1.

---

## Direction A — "Clarity"

*Calm, minimal SaaS. Lots of whitespace, soft neutrals, one confident indigo. Feels like Linear/Notion-class software: quiet until you need it.*

### A.1 Palette (hex tokens and AA checks)

| Token | Hex | Check |
|---|---|---|
| Canvas (page) | `#F8F9FB` | — |
| Surface (cards, nav) | `#FFFFFF` | — |
| Border / divider | `#E6E8EE` | decorative |
| Control border (inputs) | `#868E9C` | 3.30 : 1 on white (>= 3) |
| Text primary | `#111827` | 17.7 : 1 on white |
| Text secondary | `#4B5563` | 7.56 : 1 on white, 7.17 : 1 on canvas |
| Text disabled | `#9CA3AF` | exempt (disabled) |
| **Primary** | `#4F46E5` | white on primary **6.29 : 1** |
| Primary hover / pressed | `#4338CA` | white on it 7.9 : 1 |
| Primary tint (selected nav, bulk bar) | `#EEF2FF` with text `#3730A3` | 8.9 : 1 |
| Link | `#4338CA` | 7.9 : 1 on white |
| Success | `#047857` (tint `#DCFCE7` / text `#166534`) | white on it 5.48; tint text 6.49 |
| Info | `#1D4ED8` (tint `#DBEAFE` / text `#1E40AF`) | white on it 6.70; tint text 7.14 |
| Warning | `#B45309` (tint `#FEF3C7` / text `#92400E`) | white on it 5.02; tint text 6.36 |
| Error | `#B91C1C` (tint `#FEE2E2` / text `#991B1B`) | white on it 6.47; tint text 6.80 |
| Purple (Exported, Parallel) | `#6D28D9` (tint `#EDE9FE` / text `#5B21B6`) | white on it 7.10; tint text 7.56 |
| Grey chip | tint `#F3F4F6` / text `#374151` | 9.37 |

Buttons: primary = white on `#4F46E5` (6.29); approve/export = white on `#047857` (5.48); danger = white on `#B91C1C` (6.47). No compromise on brand hue is needed: the old `#666CFF` problem (4.07 : 1) disappears because the brand indigo is simply darker.

### A.2 Typography

**Inter** (Google Fonts, variable, `opsz` off; features `cv11`, `ss03`, `tnum`). Kept deliberately: best-in-class tabular numerals for payroll, and best on-screen legibility at 13-14 px. Refinement comes from tighter display tracking and a calmer scale.
Scale (desktop / phone): Page title 24/32 600 -0.015em (20/28) · Section title 16/24 600 · Card title 14/20 600 · Body 14/20 400 on desktop, 16/24 on phone inputs · KPI 28/36 700 -0.02em (24/32) · Caption 12/18 · Overline 12/16 600 +0.06em uppercase · Button 14/20 600 sentence case.

### A.3 Shape, elevation, density

- **Radius:** cards 12, buttons and inputs 8, chips fully rounded (pill), dialogs 16, phone bottom sheet 20 top.
- **Elevation:** flat. Cards are white with a 1 px `#E6E8EE` border and no shadow at rest; menus and dialogs get one soft shadow. No coloured shadows.
- **Density:** airy. Table row 56 px (48 compact option), card padding 24 / 16 phone, page gutter 32 / 16, 8 px grid.

### A.4 Shell and navigation

- **Admin desktop:** white 256 px left rail with a hairline right border; Interact logo + `v0.2.11` at top; section overlines (WORK, ADMIN, SYSTEM) in 12 px caps grey; items 40 px, icon 20 px grey; **active item = indigo tint pill (`#EEF2FF`, text `#3730A3`) with a 3 px indigo bar**, not a solid block. Top bar is transparent on the canvas (no border until scroll): breadcrumb + page title left, bell and avatar right. The collapsed rail is 72 px.
- **Portal phone:** white bottom bar, 4 icon+label items + More; active item = indigo icon and label with a small indigo pill behind the icon; 12 px labels. Top bar shows a large friendly page title (no hamburger on Home).
- **Portal desktop:** same left rail as admin (filtered by role), content centred at max 1100 px.

### A.5 Components

- **Lists:** filter row sits on the page canvas as a single white card; table card has no vertical column lines, hairline row dividers, sticky header in 12 px caps grey on white. Hover = canvas tint. First column is a text link in indigo; employee names carry a 32 px initials avatar in a pale tint.
- **KPI / balance cards:** white cards, small grey label, big number, tiny context line; a thin 4 px leave-type colour bar on the left for balance tiles. No gradients.
- **Forms:** top-aligned labels above 40 px inputs (not floating labels; they read cleaner with MUI `InputLabel` shrink always on, outlined). Sections are cards with a title and a hairline.
- **Status chips:** pill, tinted background, 6 px leading dot in the tone colour, 12/16 600 text. Flags use an icon instead of the dot; "solid" emphasis chips (EMERGENCY, Over limit) are the only saturated chips.
- **Buttons:** primary filled indigo; secondary white with 1 px grey border; text/ghost; danger outlined to confirm-filled. 40 px (44 phone), radius 8, no uppercase, no shadow.
- **Empty states:** a 56 px soft-tint circle with a line icon, one-line title, one-line help, one button. Plenty of space.

### A.6 Modes

Light only for v1. Palette is tokenised so a dark scheme can be added later without redesign (not recommended for v1: small team, office/phone daylight use).

### A.7 Pros and cons for PRET

- **Pros:** lowest cognitive load for occasional users (most staff open the portal a few times a month); whitespace makes long forms (claim, new employee) feel short; indigo continues the Interact family without a clash; flat styling is the cheapest to build, theme and keep consistent in MUI; highest contrast margins; ages well.
- **Cons:** least "personality"; whitespace reduces rows per screen for the outsourced admin (mitigate with a compact density toggle on lists); can read as generic.

---

## Direction B — "Sunrise" — CHOSEN (D35)

*Bold, colourful and friendly. Big rounded cards, pastel tiles, a warm violet-to-indigo hero. Feels like a consumer wellbeing app, not a back-office system.*

### B.1 Palette

| Token | Hex | Check |
|---|---|---|
| Canvas | `#F7F4FF` | — |
| Surface | `#FFFFFF` | — |
| Border | `#E7E1F7` | decorative |
| Control border | `#857FA3` | 3.8 : 1 on white |
| Text primary | `#1F1B3B` | 16.4 : 1 on white |
| Text secondary | `#5B5675` | 6.90 on white, 6.37 on canvas |
| **Primary** | `#6D28D9` | white on it **7.10 : 1** |
| Primary hover | `#5B21B6` | white on it 9.0 : 1 |
| Hero gradient | `#6D28D9` -> `#4F46E5` at 135 deg | white text >= 6.29 across the gradient |
| Success / Info / Warning / Error | as Direction A (`#047857`, `#1D4ED8`, `#B45309`, `#B91C1C`) | 5.48 / 6.70 / 5.02 / 6.47 with white |
| Pastel tiles (fill / text) | Lavender `#EDE9FE` / `#5B21B6` (7.56) · Mint `#D1FAE5` / `#065F46` (6.79) · Sky `#E0F2FE` / `#075985` (6.59) · Peach `#FFEDD5` / `#9A3412` (6.38) · Rose `#FCE7F3` / `#9D174D` (6.70) | all text on tile |

### B.2 Typography

**Plus Jakarta Sans** (Google Fonts, 400/500/600/700/800). Geometric, warm, slightly wide. Scale: page title 26/34 700 (22/30), section 17/24 700, body 15/22 (16/24 inputs on phone), KPI 32/38 800, caption 12/18, button 15/20 700. Tabular figures: confirm `tnum` support at build time; fallback is Inter for numeric cells only (adds a second font; this is a con).

### B.3 Shape, elevation, density

- **Radius:** cards 20, buttons fully rounded (pill, 999), inputs 14, chips pill, dialogs 24, sheets 28 top.
- **Elevation:** soft, tinted: `0 8px 24px -8px rgba(109,40,217,.18)` on cards, lifted on hover. Hero card has the gradient and a faint decorative circle.
- **Density:** generous. Row 60 px, card padding 24 / 20, 12 px grid gaps.

### B.4 Shell and navigation

- **Admin desktop:** white rail, 264 px, nav items as 44 px pills with pastel icon chips (each section has its own pastel: Employees lavender, Leave mint, Claims peach, Payroll sky); active = filled violet pill with white text (7.10). Top bar has a large greeting-style title.
- **Portal phone:** a floating, rounded bottom bar (inset 12 px from the edges, radius 24, shadow); the active item grows into a violet pill with its label; hero greeting card with gradient; quick actions as 2 x 2 pastel tiles.
- **Portal desktop:** left rail as admin; Home is a two-column grid of pastel tiles.

### B.5 Components

- **Lists:** table sits in a big rounded card; rows are separated by space and a faint line; header is a pale lavender strip; names have coloured avatars (hue by name hash, all pastel with dark text). Phone lists are fat cards.
- **Cards / balances:** pastel tile per leave type with a large number and a progress ring/bar.
- **Forms:** rounded 14 px inputs, floating labels, helper text in friendly language; the submit bar is a floating pill bar.
- **Status chips:** pill, bold 12/16 700, pastel fills; emphasis chips use saturated fills.
- **Buttons:** pill-shaped, primary violet with soft shadow; secondary lavender fill (not outline).
- **Empty states:** illustrated-style: large pastel blob with an icon, warm copy.

### B.6 Modes

Light only. Dark mode not offered (pastel system loses its character and doubles the contrast-checking work).

### B.7 Pros and cons for PRET

- **Pros:** the friendliest for non-office staff and phone-first use; leave balances become glanceable and even a little delightful; strongest differentiation from Kakitangan.
- **Cons:** reads as a consumer app for a **payroll** tool: serious screens (batch approval, payroll runs, statutory data) sit awkwardly in bubbly styling; lower information density hurts the outsourced admin; more tokens (5 pastels x text pairs) to verify and maintain; pill buttons and 20 px radii make dense tables look odd; the second-font fallback for numerals; most likely to date quickly.

---

## Direction C — "Console"

*Crisp, high-density pro tool. Dark navy sidebar, compact tables, mono reference numbers, blue accent. Feels like an ops dashboard: built for people who process things all day.*

### C.1 Palette

| Token | Hex | Check |
|---|---|---|
| Canvas | `#F1F3F6` | — |
| Surface | `#FFFFFF` | — |
| Border | `#DDE1E8` | decorative |
| Control border | `#7A8496` | 3.8 : 1 on white |
| Text primary | `#0F172A` | 17.85 : 1 on white |
| Text secondary | `#475569` | 7.60 : 1 on white |
| **Primary** | `#2563EB` | white on it **5.16 : 1** |
| Primary hover | `#1D4ED8` | white on it 6.70 |
| Sidebar bg | `#0F172A` | — |
| Sidebar text | `#CBD5E1` on bg | 12.0 : 1 |
| Sidebar muted (overline, icons) | `#94A3B8` on bg | 6.95 : 1 |
| Sidebar active | bg `#1E293B`, text `#FFFFFF`, 3 px bar `#60A5FA` | white on `#1E293B` 14.6 : 1 |
| Success / Warning / Error | `#047857` / `#B45309` / `#B91C1C` | 5.48 / 5.02 / 6.47 with white |
| Tints | same tint/text pairs as Direction A | 6.4 - 9.4 |
| **Dark mode** (offered) | canvas `#0B1020`, surface `#111827`, border `#243049`, text `#E5E7EB` (14.4), secondary `#9CA3AF` (7.0 on surface), primary `#60A5FA` text/link on surface (6.97), button bg `#3B82F6` with text `#0B1020` (5.2) | verified on surface |

### C.2 Typography

**IBM Plex Sans** (UI) + **IBM Plex Mono** (reference numbers CL-…, LV-…, INT-004; amounts optional). Plex has default tabular numerals and a technical feel. Scale: page title 20/28 600 · section 14/20 600 · body 13/18 (the density driver; 16/24 on phone inputs) · table 13/18 · KPI 24/28 600 · caption 11.5/16 is **not** used (12/16 minimum) · button 13/20 600.

### C.3 Shape, elevation, density

- **Radius:** 6 on cards, buttons, inputs; chips 4 (squarish "tag" look); dialogs 8.
- **Elevation:** borders, not shadows; one crisp shadow only on menus/dialogs. 1 px borders everywhere, strong grid feel.
- **Density:** compact. Table row 40 px (36 optional), card padding 16, gutter 20. About 40% more rows per screen than A.

### C.4 Shell and navigation

- **Admin desktop:** **dark navy 232 px sidebar**, logo on a small white plate (the Interact logo is designed for light backgrounds), nav items 36 px, active = lighter navy block with white text and a blue left bar; section overlines grey-blue. A slim 48 px light top bar holds breadcrumb, a global "jump to" search field, bell, avatar. Collapsible to 56 px.
- **Portal phone:** dark navy bottom bar (56 px) with white/blue active item, and a compact header; the page below stays light. Home uses dense, list-like rows instead of big tiles.
- **Portal desktop:** same dark sidebar.

### C.5 Components

- **Lists:** zebra optional off, hairline rows, sticky header in a pale grey strip, column separators visible, bulk bar docks to the table bottom; mono reference column; compact pagination.
- **Cards / balances:** dense stat blocks with a sparkline-style bar; numbers in Plex Mono.
- **Forms:** compact 36 px inputs (44 on phone), labels above, two-up/three-up grids to keep forms on one screen.
- **Status chips:** squarish 4 px tags, 11.5 -> 12/16 600, uppercase **off**; filled tints with a 1 px tone border.
- **Buttons:** 32 px desktop (44 phone), 6 px radius, primary solid blue, secondary white with border.
- **Empty states:** small, left-aligned, text-forward with a button; no big artwork.

### C.6 Modes

Light and dark both offered (dark ships in a later pass; tokens defined above). Dark mode helps long admin sessions during payroll month-end.

### C.7 Pros and cons for PRET

- **Pros:** best information density for the outsourced admin and for payroll runs and batch approval; looks authoritative for a payroll system; dark sidebar gives strong orientation; dark mode available; mono references make IDs scannable.
- **Cons:** the most "enterprise"; the employee portal on phone feels heavy and less welcoming for staff who use it a few times a month; two font families; dark sidebar needs a logo plate; denser type (13 px) is harder on older eyes and needs the 44 px phone overrides to stay compliant; dark mode doubles the QA surface.

---

## Side-by-side summary

| | A Clarity | B Sunrise | C Console |
|---|---|---|---|
| Personality | Calm, minimal | Bold, friendly | Crisp, dense |
| Primary | `#4F46E5` (6.29) | `#6D28D9` (7.10) | `#2563EB` (5.16) |
| Font | Inter | Plus Jakarta Sans | IBM Plex Sans + Mono |
| Radius (card / button) | 12 / 8 | 20 / pill | 6 / 6 |
| Nav | White rail, indigo tint pill | White rail, pastel pills | Dark navy rail |
| Row height | 56 | 60 | 40 |
| Dark mode | Not v1 (token-ready) | No | Yes (later pass) |
| Admin productivity | Good | Fair | **Best** |
| Employee phone feel | **Welcoming** | **Most delightful** | Functional |
| Build / maintain cost | **Lowest** | Highest | Medium |
| Fit: payroll seriousness | Good | Weak | **Strong** |

## Recommended direction: A — "Clarity" (with two borrowed ideas)

**Why.** PRET's majority audience is Interact's own staff using the portal occasionally, mostly on phones: they need something calm, obvious and fast, and a serious payroll back-office the admin trusts. Clarity gives both with the least risk: it has the strongest contrast margins (every button is >= 5.0 : 1, brand indigo is itself AA), it is the cheapest to implement and maintain consistently in MUI (flat surfaces, one accent, one font already in the project), and it stays visibly related to the Interact family without copying the old template. B is lovely on the phone but undermines the seriousness of payroll and costs more to keep consistent; C is the best pure admin tool but makes the employee portal feel like work.

**Borrowed ideas** (low risk, in `theme-tokens.md`):
1. From C: a **density toggle** on admin lists (Comfortable 56 px / Compact 44 px), remembered per browser, so the outsourced admin can process more rows. Default is Comfortable.
2. From B: on **portal Home only**, a soft tinted hero strip behind the greeting and balance tiles (a pale indigo-to-white gradient, not violet), so the first screen feels welcoming. No pastel rainbow elsewhere.

## Open questions for Albert

1. **Button label case.** All directions move buttons from UPPERCASE to sentence case ("Export .CSV"). OK?
2. **Direction choice:** A (recommended), B or C, or A with C's dark sidebar (a hybrid is feasible: A's tokens with a dark rail).
3. **Dark mode:** not in v1 under A. Do you want it scheduled for a later release?
4. **Logo:** the preview uses `public/brand/interact-logo.png` as supplied. A mark-only SVG for the collapsed rail and favicon is still missing.
5. **Density default** for admin lists: Comfortable (recommended) or Compact?

## Ready for GATE 2 (design)?

The three directions are specified and previewable, with a recommendation and the full token set for it. **Ready for Albert to choose a direction.** After the choice, `design-system.md` and `components.md` need a revision pass to the chosen tokens (separate work item; existing component behaviour specs remain valid).
