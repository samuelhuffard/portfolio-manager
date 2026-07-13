# Phase 0 Observation Record

**Owner:** Codex, with Sam as final authority  
**Purpose:** the authoritative human-readable record for the 10 consecutive clean
trading-day Phase 0 exit gate in `AUTONOMY-ROADMAP.md`. This is evidence tracking,
not a substitute for the Jetson system sentinel or signed ledgers.

## Window rule

The clock starts on the first market day **after** the Day 0 blockers below are
deployed and independently re-verified. A day counts only when all required
evidence is clean; a missed critical job, unresolved broker/ledger difference,
manual ledger repair, hidden failure, unsafe client exposure, or invalid
MCP receipt resets the consecutive-day count.

## Day 0 — 2026-07-12 ET: BLOCKED

| Check | Evidence | Result |
| --- | --- | --- |
| Jetson service | `portfolio-manager` online; health reports Redis, Sheets auth, Anthropic key, webhook secret, and Telegram all present | Pass |
| Mac companion | `portfolio-executor` online; log contains a successful MCP holdings sync and a clean empty-order reconciliation | Pass |
| Signed financial records | Investors 5/5, Performance 40/40, Trade Ledger 1/1, Lots 1/1, Audit 2,949/2,949 verified | Pass |
| Shadow ledger parity | Sheets positions = `NVDA` plus `Synced via Robinhood Agentic MCP`; Postgres positions = `NVDA` only | **Blocked** |
| Mandate-v3 safety boundary | 437/437 local tests; no live scan import; peer flags remain off | Pass |

### Required repair before Day 1

`lib/pg/parity-runner.js` filters `Last synced...` marker rows but not the current
`Synced via Robinhood Agentic MCP` marker. It therefore reports a false position
divergence (2 Sheets rows vs. 1 Postgres position). The scoped parser fix and
regression test pass locally; deploy it as an isolated production hotfix and prove a
production `npm run db:parity` **MATCH**. Until then, 2026-07-13 is not Day 1.

### Watch, do not normalize away

- Freshly distinguish the retired Python sync's 2026-07-10 failures from the MCP path;
  no new Python-path failure may be treated as harmless without proof.
- Athena timeouts, Yahoo validation chatter, and absent FRED macro data are degraded
  evidence. They must be visible in the daily record and must not silently create
  actionable proposals.

## Daily evidence checklist

After the market close, record the evidence rather than a subjective status.

1. Jetson health is 200 and every required dependency is true.
2. The scheduled holdings sync and order reconciliation each have a valid, account-bound
   MCP receipt; the companion is online and has a fresh heartbeat.
3. `npm run ledgers:verify` is clean; no manual ledger repair occurred.
4. `npm run db:parity` is a MATCH; Sheets and Postgres counts/digests agree.
5. All critical market jobs ran or have a documented market-calendar skip. No hidden
   failure, unresolved fill, invalid signature, or unsafe client exposure occurred.
6. Every holding was monitored despite quote/data degradation. Log any Athena/Yahoo/FRED
   degradation and prove it was downgraded or blocked.
7. Update proposal throughput: cumulative genuine actionable proposals, evaluator
   approvals, filled trades, and any owner/lot reconciliation requirement.

## Consecutive-day ledger

| Trading day | Status | MCP sync + reconciliation | Ledgers | Parity | Jobs / holdings monitoring | Proposal evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Jul 13 | Pending Day 1 eligibility | — | — | — | — | — | Starts only after Day 0 repair is live and clean |
| Jul 14 | Pending | — | — | — | — | — | |
| Jul 15 | Pending | — | — | — | — | — | |
| Jul 16 | Pending | — | — | — | — | — | |
| Jul 17 | Pending | — | — | — | — | — | |
| Jul 20 | Pending | — | — | — | — | — | |
| Jul 21 | Pending | — | — | — | — | — | |
| Jul 22 | Pending | — | — | — | — | — | |
| Jul 23 | Pending | — | — | — | — | — | |
| Jul 24 | Pending | — | — | — | — | — | |

## Exit evidence summary

- Consecutive clean trading days: **0 / 10**
- Genuine actionable proposals: **0 / 3 required during the window**
- Evaluator approvals: **0 / 1 required during the window**
- Filled trades during this observation window: **0**
- Autonomy level: **human-supervised; Agents 2/3 paper-only; Agent 4 shadow-only**
