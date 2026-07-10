/**
 * Registry of independent research agents. Each agent has its own watchlist,
 * quant weights, risk limits, personality (empty until named), and internal
 * tab (Agent-1/Agent-2/Agent-3 in lib/sheets.js) for its own recommendation
 * history, strategy notes, and track record.
 *
 * All three agents propose trades against the SAME shared portfolio (one real
 * Robinhood account, one spreadsheet — see lib/redis.js getCachedSharedSpreadsheetId).
 * Risk limits are checked against that real shared portfolio's actual position/
 * sector sizes, so agents can downgrade/block each other's proposals.
 */
export const AGENTS = [
  { id: "agent-1", name: "", executionEligibility: "supervised" },
  { id: "agent-2", name: "", executionEligibility: "paper" },
  { id: "agent-3", name: "", executionEligibility: "paper" },
];
