# Mandate split — what changed and how it was done

**Status:** rolled out to all three agents (agent-1 piloted first on branch
`pilot/agent-1-mandate-split`; agent-2/agent-3 repeated the same steps on the
same branch). All three now use `master.md` + `buy-playbook.md` +
`sell-playbook.md` instead of one flat `personality.md`.

## Why

Two separate ideas, previously living in one bucket:

1. **Buy-side research mandate** — free text an AI reads and reasons over
   (`personality.md`, fed into `lib/ai-overlay.js`'s system prompt).
2. **Sell-side exit rules** — deterministic code with hardcoded numeric
   thresholds (`lib/mandate-policy.js`), by design never AI-reasoned.

Splitting (1) into "identity/philosophy that applies to every task" vs.
"buy-specific search/sizing instructions" shrinks and focuses what the model
reads per task. Extracting (2)'s hardcoded thresholds into the existing config
file (`config/agents/mandate-policy.js`) removes a real asymmetry: entry
thresholds were already externalized as config, exit thresholds weren't.

## What changed, file by file

### New files (all three agents)

- `config/agents/agent-N/master.md` — identity, core boundary, mandate
  one-paragraph edge hypothesis, universe eligibility. Applies regardless of
  task.
- `config/agents/agent-N/buy-playbook.md` — entry hard gates, scoring, sizing.
  This is the part that's actually specific to hunting new BUYs.
- `config/agents/agent-N/sell-playbook.md` — human-readable narrative of the
  deterministic exit rules. **Not loaded by any job.** Its only purpose is
  letting a reviewer sanity-check that `lib/mandate-policy.js` still matches
  the mandate without reading branching logic. If it and the code ever
  disagree, the code (and its tests) wins — fix whichever is wrong.

### Deleted

- `config/agents/agent-1/personality.md`, `agent-2/personality.md`,
  `agent-3/personality.md` — each replaced by that agent's `master.md` +
  `buy-playbook.md`.

### Code changes

- `jobs/research-scan.js` — added `loadPersonality(dir)`. If
  `master.md`/`buy-playbook.md` both exist, it concatenates them
  (`${master}\n\n${buyPlaybook}`) into the same `personality` slot the AI
  overlay has always received. Otherwise it falls back to reading
  `personality.md` unchanged — kept only so a future agent-4-style onboarding
  can still start flat before splitting; no current agent uses that path.
- `config/agents/mandate-policy.js` — added an `exit` block to each agent's
  policy object:
  - agent-1: `atrFullExitThreshold: 2.5`, `atrPartialExitThreshold: 2.0`,
    `atrReviewThreshold: 1.5` (the dead-trade day thresholds — 20/30/40 — were
    *already* in this file's `cadence` block; the code just wasn't reading them).
  - agent-2: `consecutiveClosesBelow50DayThreshold: 5`,
    `relativeStrengthDecliningWeeksThreshold: 4`,
    `revenueDecelerationQuartersThreshold: 2`,
    `epsDecelerationQuartersThreshold: 2`, `deadQuartersThreshold: 2`.
  - agent-3: `businessScoreFloor: 65`, `positionDriftCeilingPct: 25`,
    `valuationPercentileCeiling: 0.9`.
- `lib/mandate-policy.js` — in `evaluateHoldingTriggers`, all three agent
  branches now read `policy.exit.*` / `policy.cadence.*` instead of inline
  numeric literals. The one threshold left as a literal everywhere is the
  conviction-tier-drop check (`tierDrop >= 1`) — identical across all three
  agents and not really a mandate-tuning knob, so it wasn't extracted.

### Docs touched

- `config/agents/README.md` — describes the split layout as the current
  pattern for all three agents.
- `docs/CHANGE_MAP.md` — "Onboarding a specialist mandate" section points here.
- `config/agents/agent-{1,2,3}/AGENT-*-PLAN.md`,
  `config/agents/INVESTING-PHILOSOPHIES.md` — updated to reference
  `master.md`/`buy-playbook.md` instead of the now-deleted `personality.md`.
- `tests/specialist-mandate-config.test.js` — added a shared `readPersonality(agentId)`
  helper that reads `master.md` + `buy-playbook.md` and concatenates them the
  same way the runtime loader does, used for all three agents' tests instead
  of reading a `personality.md` that no longer exists. Same assertions, same
  expected content.

## Verification performed

1. `npm test` — 866/866 passing both after the agent-1 pilot and after the
   agent-2/agent-3 rollout (baseline required `npm install`; dependencies
   weren't present in a fresh checkout).
2. Ran `loadPersonality()`'s exact logic standalone against all three agents
   after each stage to confirm which path each one resolved through (split vs.
   flat fallback) and that content came out as expected.
3. `tests/mandate-policy.test.js` exercises the exact exit thresholds (ATR
   ladder, trading-day windows, business-score floor, drift ceiling,
   valuation percentile) end to end through `evaluateMandateHolding` for all
   three agents — passing confirms the config-sourced values produce
   identical exit decisions to the old hardcoded ones.

## The steps that were followed (repeat again for a future agent-4-style onboarding)

1. Read the agent's current `personality.md` and split its content: identity
   + core boundary + mandate paragraph + universe/eligibility rules →
   `master.md`; entry gates + scoring/sizing → `buy-playbook.md`. Don't
   invent or drop rules — same content, reorganized (mirrors the
   `_TEMPLATE-STRATEGY-SPEC.md` rule: don't invent mandate content).
2. Write `sell-playbook.md` narrating that agent's exit branch in
   `lib/mandate-policy.js`'s `evaluateHoldingTriggers`.
3. Delete the old `personality.md`. No code change needed here —
   `loadPersonality()` already handles both layouts automatically.
4. In `config/agents/mandate-policy.js`, add that agent's `exit` block with
   its current hardcoded threshold values.
5. In `lib/mandate-policy.js`, replace that agent's literals with
   `policy.exit.*` / `policy.cadence.*` reads.
6. Add/extend a shared `readPersonality(agentId)` helper in
   `tests/specialist-mandate-config.test.js` and point that agent's test at it.
7. Run `npm test` and confirm the pass count doesn't drop, then spot-check
   `loadPersonality()` standalone the same way as step 2 of Verification above.
8. Sweep the repo for remaining `personality.md` mentions (`grep -rl
   "personality\.md"`) and update any doc that still claims the flat file is
   current for that agent.
