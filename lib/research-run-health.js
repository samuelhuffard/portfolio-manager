const BUDGET_ERROR_RE = /\b(402|429|credit|spend|budget|quota|rate.?limit|usage.?limit)\b/i;
const PROVIDER_ERROR_RE = /\b(anthropic|api.?key|authentication|unauthori[sz]ed|forbidden|model.*(?:not found|unavailable)|overloaded|service unavailable)\b/i;

export function finiteNonNegative(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

export function classifyResearchFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? "unknown research failure");
  return {
    kind: BUDGET_ERROR_RE.test(message) ? "budget_exhausted" : PROVIDER_ERROR_RE.test(message) ? "provider_unavailable" : "scan_error",
    message,
  };
}

export function needsImmediateResearchFailureAlert(failure) {
  return ["budget_exhausted", "provider_unavailable"].includes(failure?.kind);
}

export function canCreateActionableProposal(agent) {
  return agent?.executionEligibility === "supervised";
}
