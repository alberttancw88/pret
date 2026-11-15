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

## Backlog — later waves
- Wave 2: UX/UI design → build R1.0 (foundation, employee master, leave, claims, portal), then R1.1 payroll.
- Wave 3: QA + Security → GATE 3 (per release).
- Wave 4: Release pipeline, Kakitangan data migration, user guides, R1.0 go-live; R1.1 parallel run → payroll cut-over.

## Log
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
