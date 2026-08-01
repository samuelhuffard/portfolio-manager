# W4 — Agent 4 Shadow Policy Packet

**Status:** Phase 1 policy preparation; shadow-only, non-authorizing  
**Existing pure engine:** `lib/portfolio-manager-shadow.js`  
**Existing contract:** `contracts/portfolio-decision.js`

## Required policy version

Before a shadow cadence is activated, record one versioned policy with objective,
virtual strategy budgets, allocation/concentration/cash/gross caps, conflict
treatment, permitted regime inputs and freshness, explanation format, cadence,
abstention, demotion, and rollback. Numeric bounds are policy-owner decisions; this
packet intentionally does not choose them.

## Immutable paired shadow record

Each record must contain:

- exact specialist proposal fingerprint and immutable snapshot;
- allocation and portfolio-risk snapshot IDs/fingerprints;
- policy version and explicit decision time;
- Agent 4 `ACCEPT` or `REJECT`, ordered reasons, explanation, and virtual effect;
- Sam's independent decision/outcome label; and
- `mode=SHADOW`, `liveApprovalHmac=null`, and `orderIntent=null`.

## Negative boundary and fixture set

Agent 4 cannot originate, amend, resize, force a sale, hold an approval key, produce
an order intent, or bypass specialist-owned SELL lots. The existing deterministic
shadow engine already rejects self-origin, proposal mutation, stale/mismatched
snapshots, budget exhaustion, concentration/cash/gross breaches, and unowned SELLs.

The Phase 4 fixture set must retain those cases plus duplicate-thesis conflict,
stale portfolio snapshot, and disagreement-with-Sam labels. Any missing evidence or
policy ambiguity produces a shadow rejection/abstention, never a live action.
The local metadata catalog is `fixtures/agent4-shadow-policy-cases.js`; it marks
duplicate-thesis and Sam-disagreement behavior as policy-unresolved/record-only
instead of inventing a portfolio rule.

## Promotion boundary

Shadow records may inform later evaluation only at the matching specialist horizon.
They are not Phase 0 evidence, do not reserve cash, and cannot promote Agent 4.
Promotion remains the master-plan sequence: shadow → bounded eligible BUY acceptance
→ owner-proposed SELL acceptance → later authority, each with separate evidence.
