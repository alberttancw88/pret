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
| W1-003 | Architecture baseline, data model, RLS + ADRs | solution-architect | backlog | GATE 2 | Starts when the D11–D16 amendment to the PRD lands. Output `docs/architecture/`. |
| W1-004 | UX — screen inventory, IA, field-level wireframes, interaction notes | ux-designer | backlog | GATE 2 | Runs alongside W1-003. Output `docs/design/ux/`. |
| W1-005 | UI — MUI design system, component specs, dashboard visuals | ui-designer | backlog | GATE 2 | After W1-004 wireframes. Output `docs/design/ui/`. |

## Backlog — later waves
- Wave 2: UX/UI design → build R1.0 (foundation, employee master, leave, claims, portal), then R1.1 payroll.
- Wave 3: QA + Security → GATE 3 (per release).
- Wave 4: Release pipeline, Kakitangan data migration, user guides, R1.0 go-live; R1.1 parallel run → payroll cut-over.

## Log
- 2026-11-15 — D11–D16 amendment delivered by product-analyst (6 functions removed, 2 added; 6 stories removed, 3 added; traceability re-checked). System renamed **PRET** (D17). GATE 1 baseline committed as v0.1.0.
- 2026-11-15 — **GATE 1 approved by Albert** (spec + D11–D16; all other open questions on their proposed defaults). Gate 2 items W1-003/004/005 queued behind the amendment pass.
- 2026-11-15 — Albert: bank details maintained by SA or Admin (D15); all payments direct via HLB, no Kakitangan claims handover (D16). Relayed to product-analyst mid-amendment.
- 2026-11-15 — Albert answered Q3 (four roles), Q4 (single-level claim approval, month-end disbursement, new statuses), Q7 (statutory entitlements), Q30 (PDPA extras not required) → `01-decisions.md` D11–D14. Product-analyst amending PRD, stories, BRD (agent type not registered in this session; dispatched as general-purpose under `.claude/agents/product-analyst.md`).
- 2026-11-15 — W1-001/002 delivered by product-analyst → staged at GATE 1.
- 2026-11-15 — Kakitangan studied read-only → `docs/reference/kakitangan-study.md`; sent to product-analyst.
- 2026-11-15 — Albert moved **payroll into Phase 1** (two releases: R1.0 HR/leave/claims, R1.1 payroll after parallel run). HLB = manual, no interface. AutoCount Cloud = .xlsx export only, no integration (D5, D6, D10). Product-analyst re-briefed.
- 2026-11-15 — Project started. Albert set Phase-1/Phase-2 scope, stack and governance (`01-decisions.md` D1–D9). Board created; W1-001/002 dispatched to product-analyst.
