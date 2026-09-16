# Today Financial Pulse & Command Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only, workspace-isolated financial summary to hosted Today using the canonical 1G-F forecast engine.

**Architecture:** Add a focused pure adapter that converts hosted Income/Bill/Baseline records into `buildPaydayForecast` input, then a dedicated client component that loads the three existing authorized financial endpoints for exactly one logical workspace and renders a compact pulse. Wire the component into the existing task-focused Today surface only in hosted mode, preserving Indelitech Intel and all existing Today behavior.

**Tech Stack:** TypeScript, React 19, Next.js 16, existing hosted APIs, Cloudflare/Vinext, Node test runner.

**Spec:** `docs/MILESTONE-1G-G-TODAY-FINANCIAL-PULSE.md`

## Global Constraints

- Personal Financial Pulse reads Personal financial data only.
- Indelitech Financial Pulse reads Indelitech financial data only.
- Reuse `buildPaydayForecast`; do not duplicate forecast math.
- Missing baseline is missing, never zero.
- Unknown/estimated amounts remain visibly uncertain.
- The panel is read-only and performs no financial mutations.
- Local mode does not fetch or render Financial Pulse.
- Old workspace financial state must fail closed during switches or stale responses.
- No bank linking, transaction import, payment execution, safe-to-spend, or financial advice.

---

### Task 1: Pure Today forecast adapter

**Files:**
- Create: `lib/today-financial-pulse.ts`
- Test: `tests/today-financial-pulse.test.ts`

**Interfaces:**
- Consumes: `HostedIncomeSource[]`, `HostedIncomeOccurrence[]`, `HostedBill[]`, `HostedBillOccurrence[]`, `HostedCashflowBaseline | null`, product date, currency.
- Produces: `buildTodayFinancialPulseForecast(input): PaydayForecast` and formatting helpers needed by the Today UI.

- [ ] **Step 1: Write the failing adapter tests**

Cover: selected-workspace data only is supplied by the caller; non-USD occurrences are excluded from the USD summary; missing baseline stays `null`; fixed/variable/unknown amounts preserve canonical forecast semantics; same-day Bills remain outside `billsBeforePayday`.

- [ ] **Step 2: Verify the focused test fails**

Run: `npm test -- tests/today-financial-pulse.test.ts`

Expected: FAIL because `lib/today-financial-pulse.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal adapter**

Build maps from source IDs to canonical source definitions, filter records to the requested currency, and call `buildPaydayForecast` with no additional money math.

- [ ] **Step 4: Verify the focused test passes**

Run: `npm test -- tests/today-financial-pulse.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `Add Today financial forecast adapter`

### Task 2: Financial Pulse component

**Files:**
- Create: `components/today-financial-pulse.tsx`
- Create: `components/today-financial-pulse.module.css`
- Test: `tests/today-financial-pulse-ui.test.ts`

**Interfaces:**
- Consumes: `workspaceId: ProductWorkspaceId`.
- Produces: `TodayFinancialPulse` read-only panel.

- [ ] **Step 1: Write failing UI contract tests**

Assert the component requests exactly:

```text
/api/hosted/income?workspaceId=<selected>&includeArchived=false
/api/hosted/bills?workspaceId=<selected>&includeArchived=false
/api/hosted/cashflow/baseline?workspaceId=<selected>
```

Assert it clears loaded financial state before a workspace load, records which workspace successfully loaded, suppresses stale data when `loadedWorkspaceId !== workspaceId`, links to `/cash-flow?workspaceId=...`, and includes copy that distinguishes manual projection from bank verification.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/today-financial-pulse-ui.test.ts`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement loading and fail-closed workspace handling**

On each workspace change: abort the previous request, clear Income/Bills/Baseline/forecast state, fetch all three endpoints with `cache: "no-store"`, and set `loadedWorkspaceId` only after all three requests succeed for the current workspace.

- [ ] **Step 4: Implement compact rendering**

Render four summary cells: Next payday, Expected income, Due before payday, Projected known after payday. Show `Not set`, `No baseline`, exact/estimated/unknown qualifiers, and a compact retry error without blocking Today.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- tests/today-financial-pulse-ui.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `Add Today Financial Pulse panel`

### Task 3: Hosted Today integration

**Files:**
- Modify: `components/control-center.tsx`
- Test: `tests/today-financial-pulse-ui.test.ts`

**Interfaces:**
- Consumes: `TodayFinancialPulse`.
- Produces: hosted-only rendering in `TaskFocusedTodayView` while preserving existing TaskAttentionPanel, TaskHorizon, and HostedIntelTodayPanel behavior.

- [ ] **Step 1: Extend the failing UI contract test**

Assert Personal and Indelitech hosted Today can render Financial Pulse, local Personal does not render it, and Indelitech still renders Hosted Intel.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/today-financial-pulse-ui.test.ts`

Expected: FAIL because Control Center does not yet wire the panel.

- [ ] **Step 3: Wire hosted-only rendering**

Pass an explicit hosted/financial-pulse flag into `TaskFocusedTodayView`; render `TodayFinancialPulse workspaceId={workspaceId}` after the task/horizon grid and before Indelitech Intel.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/today-financial-pulse-ui.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `Surface Financial Pulse on hosted Today`

### Task 4: Roadmap and regression verification

**Files:**
- Modify: `docs/ROADMAP.md`
- Optionally modify: `CHANGELOG.md` if the branch remains focused and the update is limited to the new milestone.

- [ ] **Step 1: Mark 1G-G as active/delivered-on-branch in the roadmap**

Document that 1G-G is the read-only Today projection of existing 1G-F data, not a new financial domain.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm test -- tests/today-financial-pulse.test.ts
npm test -- tests/today-financial-pulse-ui.test.ts
npm test -- tests/cashflow-forecast.test.ts
npm test -- tests/cash-flow-ui-contract.test.ts
npm test -- tests/today-task-agenda.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Run repository verification**

Run:

```bash
npm run check
npm run smoke
```

Expected: all local checks pass before PR.

- [ ] **Step 4: Self-review against the spec**

Confirm all ten acceptance criteria have a corresponding implementation/test and no deferred 1G-F scope leaked into the branch.

- [ ] **Step 5: Open PR and wait for cross-platform Check**

PR must use the repository template and stop at the merge boundary for explicit user approval.
