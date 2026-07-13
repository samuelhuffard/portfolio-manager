---
date: "2026-07-13"
status: active
agent: agent-3
source: "agent_mandates/Agent_Three_Mandate_v3.md"
scope: "Agent Three only"
---

# Agent Three Strategy Specification v3

The full normative mandate is `agent_mandates/Agent_Three_Mandate_v3.md`. The runtime compact mandate is `personality.md`; it is deliberately a constrained summary, not a replacement for the source document.

Agent Three is a long-term compounder specialist: it seeks durable, financially resilient businesses at sensible prices, tolerates ordinary price volatility, and exits only on structural business, stewardship, or valuation failure.

## Runtime enforcement

- Human approval remains mandatory for every order.
- `risk-limits.json` enforces 15% maximum single-name weight, 60% sector exposure, $10M average-dollar-volume floor, stale-data block, and a higher confidence floor.
- The evaluator receives the compact mandate and fails closed on insufficient evidence.
- Peer-relative / thin-peer scoring is explicitly required by the mandate, but remains off until its deterministic data path is wired and verified; no model may fabricate peer ranks, valuation history, or sector substitutions.

## Known implementation limits

The current runtime does not yet deterministically enforce Agent Three's full valuation cascade, annual re-underwrite, special-sector data, or one-add lifetime accounting. These are required before any autonomy expansion beyond human-supervised proposals.
