/**
 * Pure helpers for the dashboard Lab's single-ticker research endpoint
 * (POST /research-ticker + GET /research-ticker/<requestId> in server.js).
 * Kept pure — no Redis/Sheets/Anthropic — so request validation and the
 * result-shape building are unit-testable (tests/lab-research.test.js).
 * Advisory/reporting only: nothing in here makes or alters a money decision.
 */

// Strict lab-endpoint ticker format: 1-5 uppercase letters, optionally followed
// by a "." or "-" class suffix of 1-2 uppercase letters (BRK.B, BF-B). This is
// deliberately narrower than createProposal's own ticker check — the Lab is a
// human-typed input surface.
export const LAB_TICKER_RE = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;

export const DEFAULT_LAB_AGENT_ID = "agent-1";

/**
 * Validates a POST /research-ticker body. Normalizes ticker (trim + uppercase)
 * before the strict format check; agentId defaults to agent-1 when absent and
 * must otherwise be a known agent. Fails closed: anything unexpected is an error.
 * Returns { ok: true, ticker, agentId } or { ok: false, error }.
 */
export function validateResearchTickerRequest(body, knownAgentIds) {
  if (!Array.isArray(knownAgentIds) || !knownAgentIds.length) {
    // Refuse loudly rather than validating against nothing.
    return { ok: false, error: "Server misconfiguration: no known agent ids" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "JSON object body required" };
  }
  if (typeof body.ticker !== "string") {
    return { ok: false, error: "ticker is required and must be a string" };
  }
  const ticker = body.ticker.trim().toUpperCase();
  if (!ticker) return { ok: false, error: "ticker is required" };
  if (!LAB_TICKER_RE.test(ticker)) {
    return { ok: false, error: `Invalid ticker format: ${ticker} (expected 1-5 letters, optional .X/-X class suffix)` };
  }

  let agentId = DEFAULT_LAB_AGENT_ID;
  if (body.agentId != null && body.agentId !== "") {
    if (typeof body.agentId !== "string") return { ok: false, error: "agentId must be a string" };
    agentId = body.agentId.trim();
  }
  if (!knownAgentIds.includes(agentId)) {
    return { ok: false, error: `Unknown agentId: ${agentId}` };
  }

  return { ok: true, ticker, agentId };
}

/**
 * Builds the `outcome` object stored under pm:lab-research:<requestId> from a
 * researchTickerForAgent() result. Purely a reporting shape:
 * - action/thesis/confidence/quantScore/ruleCheck describe the final (post-
 *   downgrade) recommendation;
 * - evaluatorVerdict is the independent evaluator's final word (or why it
 *   didn't run);
 * - proposalId/amountDollars/riskSummary appear only when a proposal was
 *   actually queued; otherwise `reason` says, in human terms, why not.
 */
export function buildLabOutcome({
  ticker,
  agentId,
  quantScore,
  rec,
  recommendation,
  createdProposal,
  evaluatorVerdict,
  noProposalReason,
} = {}) {
  const action = recommendation?.action ?? rec?.action ?? "HOLD";
  const outcome = {
    ticker: ticker ?? recommendation?.ticker ?? null,
    agentId: agentId ?? null,
    action,
    thesis: rec?.thesis ?? recommendation?.rationale ?? "",
    confidence: rec?.confidence ?? recommendation?.confidence ?? null,
    quantScore: quantScore ?? recommendation?.quantScore ?? null,
    ruleCheck: recommendation?.ruleCheck ?? (rec?.overrideNotes?.length ? rec.overrideNotes.join("; ") : "OK"),
    evaluatorVerdict: evaluatorVerdict ?? "not run",
  };
  if (createdProposal) {
    outcome.proposalId = createdProposal.id;
    outcome.amountDollars = createdProposal.amountDollars;
    outcome.riskSummary = createdProposal.riskSummary ?? null;
  } else {
    outcome.reason = noProposalReason ?? (action === "HOLD" ? "HOLD after risk checks" : "no proposal was queued");
  }
  return outcome;
}
