# Handoff

## Goal
Get Robinhood's official "Agentic Trading" MCP server wired up so Claude can read Sam's portfolio and place approval-gated trades in his dedicated Agentic sub-account, eventually routed through the dashboard's `/approvals` queue.

## Current State
- `robinhood-trading` MCP is registered correctly: scoped to **project** in this repo's `.mcp.json` (URL: `https://agent.robinhood.com/mcp/trading`), confirmed legitimate against Robinhood's own docs (https://robinhood.com/us/en/support/articles/agentic-trading-overview/) — official MCP server launched May 2026, not a third-party hack.
- Sam ran `claude` from inside this directory, approved the connector via `/mcp`, completed OAuth + Robinhood mobile verification. `claude mcp list` now shows `robinhood-trading: ✔ Connected`.
- **This is the open item**: the session that approved/connected it has accumulated unrelated conversation history (was being used for other things too). A *fresh* session started from this same directory should also load the MCP tools, since `.mcp.json` lives here and MCP load is project-path-based, not session-specific.
- Underlying account: Robinhood Agentic sub-account just approved, 0 positions, needs funding (Robinhood UI was prompting "add funds" as of last check).
- Robinhood-read-only sync (separate from the MCP) is fully working on the Jetson (`~/portfolio-manager`, PM2 process `portfolio-manager`); `holdings:sync` and `research:scan` run clean.

## Files in Flight
- `.mcp.json` (repo root) — contains the `robinhood-trading` server entry. Don't remove this — see Failed Attempts.

## Failed Attempts
- Assumed "Claude is connected" messaging on Robinhood's site meant the connection was claude.ai-account-level, unreachable from Claude Code CLI, and removed the `robinhood-trading` MCP entry based on that guess. **Wrong** — Robinhood's own support docs confirm this is a real, standard MCP server meant to be added exactly as originally done (`claude mcp add robinhood-trading --transport http https://agent.robinhood.com/mcp/trading`). Re-added it; don't re-litigate this, the URL/mechanism is verified correct.
- Tried to inspect available Robinhood MCP tools via `ToolSearch` from a session launched in a *different* project directory (`aide-ai`) — got no results, because MCP servers load based on the project path the session started in. Must start fresh session from `/Users/samhuffard/All Claude Projects/portfolio-manager` for the tools to appear.

## Next Step
From a fresh session started in `/Users/samhuffard/All Claude Projects/portfolio-manager`, use `ToolSearch` (query "robinhood") to see the actual tool/verb surface (e.g. read positions, place_order, analyze_concentration). Then decide with Sam how the permission level (ask-every-time vs allow-all, set during OAuth) interacts with the dashboard's `/approvals` queue (`portfolio-dashboard/app/approvals`, `app/api/proposals`) before building anything further.
