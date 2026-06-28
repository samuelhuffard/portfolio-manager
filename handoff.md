# Handoff

## Goal
Inspect the Robinhood Agentic Trading MCP tools, then walk Sam through the first live holdings sync and trade execution on the Agentic sub-account.

## Current State
- `robinhood-trading` MCP is registered in `.mcp.json` (`https://agent.robinhood.com/mcp/trading`). Sam completed OAuth + mobile verification in a prior session — should show Connected when this session starts.
- Agentic sub-account is a **separate Robinhood sub-account** (not Sam's main account). Was at $0 / "add funds" as of last check. Sam is funding it now.
- Full execution layer is built and pushed (`0a740be`):
  - `EXECUTION-GUIDE.md` — Claude agent playbook; read this before executing anything
  - `scripts/list-approved-proposals.js` — lists dashboard-approved proposals ready for execution
  - `scripts/record-trade.js --proposalId ... --orderId ... --ticker ... --side ... --shares ... --price ... --agentId agent-1` — validates the approved proposal, appends Trade Ledger, updates FIFO Lots, then marks fulfilled in Redis
  - `scripts/mark-fulfilled.js <proposalId> <tradeId>` — repair-only helper if fulfillment marking needs to be rerun
  - `scripts/sync-holdings-from-mcp.js` — reads normalized position JSON from stdin and updates Holdings, Performance/NAV, Overview, cached portfolio value, tax reserve, and SPY benchmark
- Jetson is up to date (`0a740be` confirmed), PM2 online. Research/exit/performance jobs run nightly — they don't need Robinhood credentials, they read from the Sheet.
- 71/71 tests pass.

## Files in Flight
- `EXECUTION-GUIDE.md` — Step 2 and Step 3d use placeholder tool names; update with real MCP tool names once inspected
- `scripts/sync-holdings-from-mcp.js` — field mapping may need adjustment once real MCP position output format is known

## Failed Attempts
- `robin_stocks` Python sync cannot work — Robinhood hangs waiting for interactive MFA. Do not attempt to revive it.
- MCP does NOT load unless Claude starts from this exact directory. ToolSearch for "robinhood" from any other directory returns nothing.
- Do not remove `.mcp.json` — a prior session made that mistake and had to re-add the entry manually.

## Next Step
1. Run `ToolSearch` query `"robinhood"` — note exact tool names for reading positions and placing orders
2. Update `EXECUTION-GUIDE.md` Step 2 and Step 3d with the real tool names
3. Run `node scripts/list-approved-proposals.js` — check if any proposals are already queued
4. Once Sam has funded the account: call the positions tool → pipe to `sync-holdings-from-mcp.js` for the first live holdings sync
