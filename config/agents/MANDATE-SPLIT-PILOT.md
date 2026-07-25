# Mandate-split pilot (Agent 1) — what changed and how to repeat it

**Status:** piloted on agent-1 only, on branch `pilot/agent-1-mandate-split`.
Agent-2 and agent-3 are untouched and still use the flat `personality.md`
pattern — this is deliberate, not partial work left unfinished.

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

### New files (agent-1 only)

- `config/agents/agent-1/master.md` — identity, core boundary, mandate
  one-paragraph edge hypothesis, universe eligibility. Applies regardless of
  task.
- `config/agents/agent-1/buy-playbook.md` — entry hard gates, scoring, sizing.
  This is the part that's actually specific to hunting new BUYs.
- `config/agents/agent-1/sell-playbook.md` — human-readable narrative of the
  deterministic exit rules. **Not loaded by any job.** Its only purpose is
  letting a reviewer sanity-check that `lib/mandate-policy.js` still matches
  the mandate without reading branching logic. If it and the code ever
  disagree, the code (and its tests) wins — fix whichever is wrong.

### Deleted

- `config/agents/agent-1/personality.md` — replaced by `master.md` +
  `buy-playbook.md`.

### Code changes

- `jobs/research-scan.js` — added `loadPersonality(dir)`. If
  `master.md`/`buy-playbook.md` both exist, it concatenates them
  (`${master}\n\n${buyPlaybook}`) into the same `personality` slot the AI
  overlay has always received. Otherwise it falls back to reading
  `personality.md` unchanged. This is the one piece of shared code touched —
  agent-2/agent-3 hit the fallback branch and are provably unaffected (see
  Verification below).
- `config/agents/mandate-policy.js` — added an `exit` block to agent-1's
  policy object: `atrFullExitThreshold: 2.5`, `atrPartialExitThreshold: 2.0`,
  `atrReviewThreshold: 1.5`. (The dead-trade day thresholds — 20/30/40 — were
  *already* in this file's `cadence` block; the code just wasn't reading them.)
- `lib/mandate-policy.js` — in `evaluateHoldingTriggers`'s agent-1 branch,
  replaced the hardcoded literals (`2.5`, `2`, `1.5`, `40`, `30`, `20`) with
  reads from `policy.exit.*` / `policy.cadence.*`. Agent-2 and agent-3
  branches are untouched — they still use inline literals.

### Docs touched

- `config/agents/README.md` — describes both the flat and split layouts now.
- `docs/CHANGE_MAP.md` — "Onboarding a specialist mandate" section points here.
- `tests/specialist-mandate-config.test.js` — agent-1's test now reads
  `master.md` + `buy-playbook.md` and concatenates them the same way the
  runtime loader does, instead of reading a `personality.md` that no longer
  exists. Same assertions, same expected content.

## Verification performed

1. `npm test` — 866/866 passing (baseline required `npm install`; dependencies
   weren't present in a fresh checkout).
2. Ran `loadPersonality()`'s exact logic standalone against all three agents:
   agent-1 resolved via the new split path (1830 chars, split); agent-2 and
   agent-3 both resolved via the flat-file fallback, byte-identical to before.
3. `tests/mandate-policy.test.js` exercises the exact ATR/trading-day
   thresholds (1.5, 2, 40, etc.) end to end through `evaluateMandateHolding` —
   passing confirms the config-sourced values produce identical exit decisions
   to the old hardcoded ones.

## How to repeat for agent-2 / agent-3

1. Read the agent's current `personality.md` and split its content: identity
   + core boundary + mandate paragraph + universe/eligibility rules →
   `master.md`; entry gates + scoring/sizing → `buy-playbook.md`. Don't
   invent or drop rules — same content, reorganized (mirrors the
   `_TEMPLATE-STRATEGY-SPEC.md` rule: don't invent mandate content).
2. Write `sell-playbook.md` narrating that agent's exit branch in
   `lib/mandate-policy.js`'s `evaluateHoldingTriggers` (the `else if
   (policy.agentId === "agent-2")` / `else` branch).
3. Delete the old `personality.md`. No code change needed here —
   `loadPersonality()` already handles both layouts automatically.
4. In `config/agents/mandate-policy.js`, add that agent's `exit` block with
   its current hardcoded threshold values (agent-2: the 50/200-day trend-break
   day counts, deceleration-quarter counts, dead-quarter count; agent-3: the
   65 business-score floor, 25% drift cap, 0.9 valuation percentile).
5. In `lib/mandate-policy.js`, replace that agent's literals with
   `policy.exit.*` / `policy.cadence.*` reads — same pattern as the agent-1
   diff on this branch.
6. Update that agent's block in `tests/specialist-mandate-config.test.js` the
   same way agent-1's was updated.
7. Run `npm test` and confirm the pass count doesn't drop, then spot-check
   `loadPersonality()` standalone the same way as step 2 of Verification above.
