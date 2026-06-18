/**
 * Registry of independent research agents. Each agent has its own watchlist,
 * quant weights, risk limits, personality (empty until named), and spreadsheet
 * (own Holdings/Recommendations/Strategy/Track Record tabs) — no shared state
 * between agents except market-data caches (news, macro) that are facts, not
 * agent memory or opinion.
 *
 * agent-1 is Sam's real Robinhood account (synced by jobs/holdings-sync.js,
 * which stays single-agent). agent-2/agent-3 are research-only/paper until
 * Sam provisions a spreadsheet for each (create a blank Sheet, share it with
 * the service account as Editor, set the env var below) — until then they're
 * skipped with a log line, not an error.
 */
export const AGENTS = [
  { id: "agent-1", name: "", spreadsheetEnvVar: "SPREADSHEET_ID" },
  { id: "agent-2", name: "", spreadsheetEnvVar: "SPREADSHEET_ID_AGENT_2" },
  { id: "agent-3", name: "", spreadsheetEnvVar: "SPREADSHEET_ID_AGENT_3" },
];
