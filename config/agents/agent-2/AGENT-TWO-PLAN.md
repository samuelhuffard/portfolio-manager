---
date: "2026-07-13"
status: active
agent: agent-2
source: "agent_mandates/Agent_Two_Mandate_v3.md"
scope: "Agent Two only"
---

# Agent Two Strategy Specification v3

The full normative mandate is `agent_mandates/Agent_Two_Mandate_v3.md`. The runtime compact mandate is `master.md` + `buy-playbook.md` (split-mandate layout — see `config/agents/MANDATE-SPLIT-PILOT.md`); together they are deliberately a constrained summary, not a replacement for the source document.

Agent Two is a medium-term momentum specialist: it seeks established trends supported by persistent fundamental and institutional evidence, holds through ordinary noise, and recycles dead capital when the trend genuinely breaks.

## Runtime enforcement

- Human approval remains mandatory for every order.
- `risk-limits.json` enforces 12% maximum single-name weight, 60% sector exposure, $300M market-cap floor, $10M average-dollar-volume floor, stale-data block, and no averaging down.
- The evaluator receives the compact mandate and fails closed on insufficient evidence.
- Peer-relative / thin-peer scoring is explicitly required by the mandate, but remains off until its deterministic data path is wired and verified; no model may fabricate peer ranks or substitutions.

## Known implementation limits

The current runtime does not yet deterministically enforce Agent Two's exact macro red-state, moving-average, relative-volume, estimate-history, insider, or two-quarter dead-money rules. These remain mandatory review criteria in the mandate and evaluator context; they must become deterministic before any autonomy expansion beyond human-supervised proposals.
