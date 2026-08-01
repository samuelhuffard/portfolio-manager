# Phase 1 Policy Worksheet — Decisions Required Before Mandate Encoding

**Status:** draft input worksheet; no policy is accepted until the decision register records it.
**Purpose:** turn the four open Phase 1 investing decisions into answers that a later implementation can test, rather than letting prompts or code guess.

## How to use this worksheet

For each question, record one exact rule, its source hierarchy, its exception path,
the approving person/date, affected mandates, policy version, and a named regression
fixture. Then copy the accepted outcome into `docs/RESEARCH-DECISION-REGISTER.md`
and add the fixture before turning it on. A blank field remains
`policy_unresolved`; it is never a default.

**Decision-record template**

| Field | Required value |
| --- | --- |
| Exact rule | Testable rule, unit, boundary, and actionability effect |
| Source hierarchy | Ordered approved sources and receipt requirements |
| Exception/fallback rule | Explicit unavailable/conflict/special-sector handling |
| Owner / accepted date | Named policy owner and dated acceptance |
| Policy version | Version that will bind the affected mandate(s) |
| Affected mandates | One or more of Agents 1–3; do not imply all by default |
| Regression fixture | Fixture/test name covering normal, boundary, and unavailable cases |

## Q-001 — Agent 1 balance-sheet definitions

**Decision owner:** Sam + investing partner
**Blocks:** Agent 1 balance-sheet scoring actionability

Decide all of the following:

1. Which approved EDGAR concepts establish profitability, cash, debt, and EBITDA?
2. What is the EBITDA fallback order when the preferred concept is unavailable?
3. How should negative EBITDA, zero debt, restricted cash, banks/insurers, and other financial companies be classified?
4. When data are unavailable or ambiguous, is the score unavailable, partial, or non-actionable?

**Accepted rule:** _pending_
**Source hierarchy:** _pending_
**Exception/fallback rule:** _pending_
**Owner / accepted date:** _pending_
**Policy version:** _pending_
**Affected mandates:** _pending_
**Regression fixture:** _pending_

## Q-002 — Current-estimate freshness

**Decision owner:** Sam + investing partner
**Blocks:** estimate-based entry/holding actionability

Decide:

1. maximum age for a free-source estimate snapshot;
2. whether the threshold differs for a new entry, an existing holding, or an earnings-adjacent period;
3. whether stale estimates make a candidate ineligible, partial, or merely require a warning;
4. durable receipt/time-zone requirements.

**Accepted rule:** _pending_
**Source hierarchy:** _pending_
**Exception/fallback rule:** _pending_
**Owner / accepted date:** _pending_
**Policy version:** _pending_
**Affected mandates:** _pending_
**Regression fixture:** _pending_

## Q-003 — Entry quote and relative-volume freshness

**Decision owner:** Sam + investing partner
**Blocks:** exact entry actionability

Decide:

1. maximum allowed quote age and relative-volume age;
2. regular-session versus premarket/after-hours qualification;
3. behavior when the market is closed, halted, or quote data are delayed;
4. whether stale data blocks creation, blocks approval, or permits only a draft.

**Accepted rule:** _pending_
**Source hierarchy:** _pending_
**Exception/fallback rule:** _pending_
**Owner / accepted date:** _pending_
**Policy version:** _pending_
**Affected mandates:** _pending_
**Regression fixture:** _pending_

## Q-004 — Consensus and 13F completeness

**Decision owner:** Sam + investing partner
**Blocks:** complete evidence policy for all specialist mandates

Decide:

1. whether consensus estimates and 13F evidence are temporarily optional under the existing v3 80-point availability floor;
2. whether either becomes thesis-critical by agent, business family, market capitalization, or holding state;
3. what evidence makes an unavailable source distinguishable from a negative finding;
4. what must be disclosed to the evaluator and Sam when an input is absent.

**Accepted rule:** _pending_
**Source hierarchy:** _pending_
**Exception/fallback rule:** _pending_
**Owner / accepted date:** _pending_
**Policy version:** _pending_
**Affected mandates:** _pending_
**Regression fixture:** _pending_

## Agent 4 policy packet

Before implementation, specify and version:

- objective and allowable recommendations;
- accept/reject-only boundary (no origination, amendment, or forced sale);
- virtual strategy-budget and allocation bounds;
- conflict treatment between specialists;
- permitted regime inputs and their source/freshness rules;
- required explanation/evidence output;
- shadow-to-canary promotion evidence and rollback behavior.

**Accepted policy version:** _pending_
