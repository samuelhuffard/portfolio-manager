---
date: "2026-06-22 19:16"
promoted: false
---

# Investing Agent Philosophies

The software/coding side is mostly in place, so the next focus is defining each of the three investing agents' philosophies. The detailed philosophy is not fully flushed out yet. Sam's friend is stronger on examples of good and bad trading, investing philosophy, useful articles, and what industries each agent should or should not touch, so leave that deeper strategy work for him for now.

Initial agent framing:

- Agent 1: short-term trading agent. Makes trades every day or every few days.
- Agent 2: medium-term trading agent. Makes trades monthly.
- Agent 3: long-term investing agent. Waits at least one year before making a trade.

Implementation note: do not change code yet. This is a planning/strategy placeholder only. Do not write these mandates into the agents' `personality.md` files until the investing philosophies are more fully specified.

Portfolio manager uncommitted worktree note from `git status --short` at capture time:

```text
 M config/agents.js
 M jobs/holdings-sync.js
 M jobs/performance-review.js
 M jobs/research-scan.js
 M lib/redis.js
 M lib/robinhood-sync.py
 M lib/sheets.js
?? .mcp.json
?? handoff.md
?? lib/agent-attribution.js
?? lib/tax-lots.js
```
