# Phase 1 Compiled Mandate Specifications

**Status:** draft contract for review; offline-only and non-runtime  
**Source:** v3 specialist mandates plus released deterministic mandate-policy metadata  
**Executable artifact:** `config/phase1-mandate-freeze.js`  
**Verification:** `node --test tests/phase1-mandate-freeze.test.js`

## Boundary

This packet compiles the existing specialist policy into one reviewable schema. It
does not replace the canonical v3 Markdown mandates, alter live scoring, change a
threshold, or authorize a proposal. An unresolved field is deliberately represented
as `policy_unresolved` and is non-actionable until its accepted decision record and
regression fixture exist.

## Shared workflow invariant

All three specialists must retain the same:

| Capability | Frozen invariant |
| --- | --- |
| Discovery | Broad catalog, supervised workflow |
| Evidence | Typed evidence; missing, stale, conflicting, or future evidence blocks |
| Evaluator | Same supervised evaluator path |
| Risk/sizing | Same deterministic risk and sizing path |
| Proposal semantics | Same supervised proposal path |
| Ownership | Strategy-owned SELL lots only |
| Observability | Same receipt and funnel semantics |

Equal workflow does not mean equal investing judgment. The compiled contracts expose
different horizons, entry conditions, evidence lists, tiers, risk envelopes, and
abstention reasons while retaining the invariant above.

## Compiled specialist templates

| Field | Agent 1 | Agent 2 | Agent 3 |
| --- | --- | --- | --- |
| Mandate / horizon | `agent_one` / days-to-weeks | `agent_two` / weeks-to-two-quarters | `agent_three` / years |
| Entry threshold | 45 | 45 | 65 |
| Explicit price structure | Above 200-day average | Above 50- and 200-day averages, with 50 above 200 | No separate price-structure rule in the released policy |
| Maximum position weight | 15% | 12% | 15% |
| Adds | Averaging down prohibited | Averaging down prohibited | Controlled exception; one lifetime add |
| Unresolved decisions | Q-001–Q-004 | Q-002–Q-004 | Q-002–Q-004 |

Every executable draft also carries universe eligibility, ranking/valuation cascade,
critical entry/holding evidence, freshness state, entry/abstention/exit semantics,
horizon/benchmark, risk/tiers, special-sector handling, and required decision-record
fields. The complete values are intentionally machine-inspectable in the offline
artifact, not duplicated into a second live policy source.

## Required decision-record shape

Before a `policy_unresolved` value can become a policy value, the register must
contain: exact rule, source hierarchy, exception/fallback rule, owner, accepted date,
policy version, affected mandates, and named regression fixture. The companion
[worksheet](PHASE-1-POLICY-WORKSHEET.md) supplies that record shape.

## Deliberate divergence fixture

The fixture uses one static, dated local input. At a score of 90 with price above its
200-day average but below its 50-day average:

- Agent 1 is `review_ready`;
- Agent 2 is `non_actionable` for 50/200 alignment.

With aligned prices but score 55, Agent 3 is `non_actionable` because its minimum is
65. This is an offline contract diagnostic only—not an investment recommendation,
ranker, or proposal generator.

