---
date: "2026-07-20"
status: active
agent: agent-1
source: "agent_mandates/Agent_One_Mandate_v3.md"
scope: "Agent One only"
---

# Agent One Strategy Specification v3

The full normative mandate is `agent_mandates/Agent_One_Mandate_v3.md`. The
runtime compact mandate is `master.md` + `buy-playbook.md` (split-mandate
pilot — see `config/agents/MANDATE-SPLIT-PILOT.md`); together they are
deliberately a constrained summary, not a replacement for the source document.

Agent One is the short-term high-velocity specialist. It searches every eligible
sector for current acceleration, enters quickly only when price, volume,
fundamental, balance-sheet, macro, and evidence gates clear, and exits quickly
when its short-clock thesis breaks or fails to progress.

## Runtime enforcement

- Human approval remains mandatory for every order.
- `lib/mandate-policy.js` defines the same timestamped-evidence, scoring, entry,
  add, holding-monitor, re-underwrite, and exit-review interface for Agents One,
  Two, and Three. Live callers must wire that pure interface before it counts as
  production enforcement.
- The v3 liquidity rule is conditional: qualifying microcaps require at least
  $3M average daily dollar volume; all other entries require at least $10M.
- Dual-red SPY/rate macro state blocks new entries; one red state caps sizing at
  Tier 2.
- Entry requires price above the 200-day average, at least 1.2× relative volume,
  current critical evidence, a mandate-actionable score, and no credibility or
  disclosure block.
- The deterministic holding adapter covers daily monitoring, weekly rescoring,
  earnings/events, the ATR ladder, momentum/fundamental triggers, conviction
  tier changes, and the 20/30/40-trading-day dead-trade clock.
- Averaging down remains prohibited.

## Authority and version note

The former technology-only v5 plan and compact prompt were stale artifacts.
Decision D-001 makes the versioned sector-agnostic v3 mandate authoritative.
Discovery activation and cohort identity remain separately versioned; this
strategy file does not by itself authorize a catalog, proposal, approval, order,
or trade.
