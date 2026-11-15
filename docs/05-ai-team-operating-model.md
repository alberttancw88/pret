# PRET — AI Team Operating Model

**Status:** Adopted from Direct Order (v1) · **Last updated:** 2026-11-15
**Owner:** Albert (Product Owner / Co-owner)

How this project is built by a coordinated team of AI agents, with the human owner at
the top. Same framework, gates and controls as Direct Order, adapted for an internal,
single-company HR system holding sensitive personal data.

---

## 1. Agreed decisions

| Decision | Choice |
|----------|--------|
| Coordination model | **Model A — single orchestrator** (Delivery Lead dispatches specialists directly). |
| Roster | Same 10 roles as Direct Order (§3). |
| Approval gates | **All 3 gates** enforced (scope → design → ship). |
| Rollout | Wave 1 (requirements + architecture) → Wave 2 (design + build) → Wave 3 (QA + security) → Wave 4 (release + docs). Phase 2 (payroll) repeats the waves. |

---

## 2. Core principles

1. **Albert is Product Owner & Co-owner** — vision, priorities, and sign-off at every
   gate. Agents propose; Albert disposes.
2. **Artifact-based handoff** — agents don't share live memory. Each reads defined inputs
   and writes defined outputs to fixed repo locations. The repo *is* the shared brain.
3. **One orchestrator, many specialists** — the Delivery Lead decomposes and dispatches.
4. **Gates, not autopilot** — work halts for Albert's approval at each phase boundary.
5. **Everything versioned in Git** — commit history + `docs/` is the audit trail; SemVer
   tag + CHANGELOG entry per commit.
6. **No push without approval** — nothing is pushed to GitHub until Albert approves.
7. **Personal data is protected by design** — PDPA 2010; synthetic data only in the repo;
   least-privilege access to NRIC, bank, salary and medical information.

---

## 3. Roster

| # | Agent | Phase | Produces | Writes to | Model | Wave |
|---|-------|-------|----------|-----------|-------|------|
| — | **Delivery Lead** (manager) | Orchestration | Backlog, dispatch, integration, status | `docs/backlog.md` | — (main session) | 1 |
| 1 | Product / Business Analyst | Requirements | BRD, PRD, stories, acceptance criteria | `docs/product/` | Opus | 1 |
| 2 | Solution Architect | Architecture | System design, data model, RLS, ADRs | `docs/architecture/` | Opus | 1 |
| 3 | UX Designer | Experience | Screens, IA, wireframes | `docs/design/ux/` | Opus | 2 |
| 4 | UI / Visual Designer | Interface | MUI theme, component specs | `docs/design/ui/` | Sonnet | 2 |
| 5 | Frontend Engineer | Build (web) | Next.js app, components | `src/` | Sonnet | 2 |
| 6 | Backend / Supabase Engineer | Build (data) | Schema, RLS, migrations | `supabase/`, `src/server/` | Sonnet | 2 |
| 7 | QA / Test Engineer | Quality | Test plans, automated + access-control tests | `tests/`, `docs/qa/` | Sonnet | 3 |
| 8 | Security & Compliance | Assurance | RLS/PII audit, security review, PDPA flags | `docs/security/` | Opus | 3 |
| 9 | DevOps / Release | Delivery | CI/CD, migrations, deploy config | `.github/`, `infra/` | Sonnet | 4 |
| 10 | Tech Writer | Docs | User guides (employee, manager, HR admin) | `docs/guides/` | Sonnet | 4 |

---

## 4. Coordination (Model A)

```
                 ALBERT  (Product Owner / Co-owner)
                   │  priorities · gate approvals
                   ▼
        ┌────────────────────────┐
        │   DELIVERY LEAD         │  = the main Claude Code session
        │  decompose · dispatch · │
        │  integrate · report     │
        └───────────┬────────────┘
      dispatches specialists directly (no sub-leads in Model A)
   ┌────────┬────────┬────────┬────────┬────────┬────────┐
   ▼        ▼        ▼        ▼        ▼        ▼        ▼
  BA    Architect  UX/UI   FE/BE     QA    Security   Ops/Docs
```

---

## 5. Lifecycle & the 3 gates

```
Albert states a need
  → Delivery Lead logs a work item on the board (docs/backlog.md)
  → Product/BA writes story + acceptance criteria     ══ GATE 1: SCOPE (Albert)
  → Architect + UX/UI produce design                   ══ GATE 2: DESIGN (Albert)
  → Frontend + Backend build (isolated worktrees)
  → QA + Security review vs acceptance criteria         ══ GATE 3: SHIP (Albert)
  → DevOps releases · Tech Writer documents
```

**All 3 gates are mandatory.** Between gates, agents run autonomously; at each gate the
Delivery Lead presents the artifact and waits for Albert's approve / amend / reject.

### Definition of Done (per work item)
- Acceptance criteria met and demonstrable in a browser, as each affected role.
- QA tests pass, including **access-control tests**: an employee never sees another
  employee's record, leave or claims; a manager sees only their reportees; sensitive
  fields (NRIC, bank, salary, medical) only for authorised HR roles.
- Security review clean (RLS + secrets + storage + audit trail).
- Docs updated. Committed to Git with version tag (pushed only after approval).

---

## 6. Future roles

| Role | Phase | When |
|------|-------|------|
| Payroll / Statutory Compliance specialist | Assurance | Phase 2 (EPF/SOCSO/EIS/PCB/HRDF rule verification) |
| Technical Support / L2 | Post-deployment | After go-live |

---

## 7. Handoff contract (where each agent reads/writes)

```
docs/
  product/        ← Product/BA          (BRD, PRD, stories)
  architecture/   ← Architect           (design, data model, ADRs)
  design/ux/      ← UX Designer         (screens, wireframes)
  design/ui/      ← UI Designer         (design system, specs)
  security/       ← Security agent      (reviews, audits)
  qa/             ← QA agent            (test plan, sign-off)
  guides/         ← Tech Writer         (user guides)
  reference/      ← Delivery Lead       (anonymised Kakitangan/policy references)
  backlog.md      ← Delivery Lead       (the work board)
src/              ← Frontend / Backend engineers
supabase/         ← Backend engineer    (schema, RLS, migrations)
tests/            ← QA engineer
.github/, infra/  ← DevOps
.claude/agents/   ← agent definitions
```

An agent only writes inside its lane; cross-lane changes are requested via the Delivery
Lead, never done unilaterally.
