/**
 * Offline capability-parity baseline for the three specialist agents.
 *
 * This module is deliberately inert: no production job imports it and it grants
 * no proposal or execution authority. It records the code-backed state of each
 * agent's workflow so a prompt, config file, or shadow-only component cannot be
 * mistaken for a production capability.
 *
 * "Same capability" means each agent has the same complete workflow stages.
 * It does NOT mean that the mandates use the same screens, weights, time
 * horizons, entry rules, holding cadence, or exit rules.
 */

export const PARITY_AGENT_IDS = Object.freeze(["agent-1", "agent-2", "agent-3"]);

export const CAPABILITY_STATES = Object.freeze([
  "deterministic_live",
  "deterministic_shadow",
  "advisory_only",
  "missing",
]);

export const CAPABILITY_COVERAGE = Object.freeze(["complete", "partial", "none"]);

export const SHARED_TRUST_CONTROLS = Object.freeze([
  {
    id: "human_approval_boundary",
    description: "Every order requires Sam's personal approval; research agents cannot trade.",
  },
  {
    id: "proposal_validation_and_evaluation",
    description: "Every agent uses the same structured proposal and evaluator boundary.",
  },
  {
    id: "deterministic_risk_downgrade",
    description: "Backend risk checks may downgrade or clamp an agent recommendation, never upgrade it.",
  },
  {
    id: "portfolio_circuit_breaker",
    description: "The same portfolio-level drawdown circuit breaker applies regardless of originating agent.",
  },
  {
    id: "ownership_and_fill_attribution",
    description: "Lots, fills, and sells are attributed by agent and fail closed on ownership violations.",
  },
  {
    id: "signed_ledger_and_observability",
    description: "The same signed-ledger, runtime-receipt, and observation controls cover every agent.",
  },
]);

export const SHARED_SKILL_CAPABILITIES = Object.freeze([
  {
    id: "broad_candidate_discovery",
    description: "Discover candidates from a broad, refreshed catalog rather than only a fixed watchlist.",
  },
  {
    id: "mandate_catalog_screen",
    description: "Apply a deterministic mandate-specific eligibility screen to the shared catalog.",
  },
  {
    id: "selection_rotation_and_cooldown",
    description: "Rotate research using recency, cooldown, exploration, holdings, and event priority.",
  },
  {
    id: "supported_mandate_evidence_adapter",
    description: "Convert sourced evidence into the exact named inputs required by that agent's mandate.",
  },
  {
    id: "deterministic_mandate_scoring",
    description: "Score those inputs with the agent's own deterministic weights, bands, and fallbacks.",
  },
  {
    id: "deterministic_entry_policy",
    description: "Enforce the mandate's defining entry and sizing rules outside the model prompt.",
  },
  {
    id: "deterministic_holding_monitor",
    description: "Monitor every attributed holding using the mandate's objective triggers and cadence.",
  },
  {
    id: "deterministic_reunderwrite_cadence",
    description: "Schedule and record each mandate's required periodic and event-driven re-underwrites.",
  },
  {
    id: "deterministic_add_accounting",
    description: "Enforce and durably account for the mandate's pyramiding, averaging-down, or one-add rules.",
  },
]);

const live = (coverage, evidence) => Object.freeze({
  state: "deterministic_live",
  coverage,
  evidence,
});
const shadow = (coverage, evidence) => Object.freeze({
  state: "deterministic_shadow",
  coverage,
  evidence,
});
const advisory = (coverage, evidence) => Object.freeze({
  state: "advisory_only",
  coverage,
  evidence,
});
const missing = (evidence) => Object.freeze({
  state: "missing",
  coverage: "none",
  evidence,
});

/**
 * Evidence-backed snapshot at production revision 3c01d03.
 *
 * A "partial" live component is useful, but it does not satisfy parity. A
 * deterministic shadow component is also useful, but it is not live skill
 * evidence until it is integrated, observed, and promoted through the normal
 * change-control gates.
 */
export const CURRENT_SKILL_CAPABILITY_MATRIX = Object.freeze({
  "agent-1": Object.freeze({
    broad_candidate_discovery: live("complete", "config/agents/agent-1/universe.json uses the refreshed catalog with fallback visibility"),
    mandate_catalog_screen: live("complete", "lib/screener.js is applied in scheduled and lab Agent 1 research"),
    selection_rotation_and_cooldown: live("complete", "catalog slate uses cooldown, exploration, holdings, movers, and ranked candidates"),
    supported_mandate_evidence_adapter: shadow("partial", "lib/mandate-evidence.js supports only part of Agent 1 standard-sector evidence"),
    deterministic_mandate_scoring: shadow("partial", "jobs/mandate-scoring.js is Agent 1-only and research-context-only"),
    deterministic_entry_policy: live("partial", "universe/risk/conviction checks are deterministic, but the full mandate is not"),
    deterministic_holding_monitor: live("partial", "jobs/monitor-positions.js is Agent 1-only and explicitly incomplete for some fundamental triggers"),
    deterministic_reunderwrite_cadence: advisory("partial", "mandate review expectations exist, but a complete recorded cadence is not enforced"),
    deterministic_add_accounting: live("partial", "averaging-down and sizing checks exist; complete mandate add accounting does not"),
  }),
  "agent-2": Object.freeze({
    broad_candidate_discovery: missing("config/agents/agent-2/universe.json uses a fixed watchlist"),
    mandate_catalog_screen: missing("no Agent 2 catalog eligibility adapter exists"),
    selection_rotation_and_cooldown: missing("cooldown can reorder a fixed list, but there is no broad discovery/exploration funnel"),
    supported_mandate_evidence_adapter: missing("lib/mandate-evidence.js explicitly returns supported:false for Agent 2"),
    deterministic_mandate_scoring: shadow("partial", "Agent 2 rule tables exist, but the required evidence adapter and live wiring do not"),
    deterministic_entry_policy: live("partial", "basic risk caps are enforced; macro red-state and trend-persistence rules remain advisory"),
    deterministic_holding_monitor: missing("the automated holding-exit monitor is scoped to Agent 1"),
    deterministic_reunderwrite_cadence: advisory("partial", "weekly and earnings re-underwrites are specified but not completely scheduled and recorded"),
    deterministic_add_accounting: live("partial", "averaging down is blocked, but the full mandate lifecycle is not accounted"),
  }),
  "agent-3": Object.freeze({
    broad_candidate_discovery: missing("config/agents/agent-3/universe.json uses a fixed watchlist"),
    mandate_catalog_screen: missing("no Agent 3 catalog eligibility adapter exists"),
    selection_rotation_and_cooldown: missing("cooldown can reorder a fixed list, but there is no broad discovery/exploration funnel"),
    supported_mandate_evidence_adapter: missing("lib/mandate-evidence.js explicitly returns supported:false for Agent 3"),
    deterministic_mandate_scoring: shadow("partial", "Agent 3 rule tables exist, but the required evidence adapter and live wiring do not"),
    deterministic_entry_policy: live("partial", "basic risk caps are enforced; the valuation cascade and hard gate remain incomplete"),
    deterministic_holding_monitor: missing("the automated holding-exit monitor is scoped to Agent 1"),
    deterministic_reunderwrite_cadence: advisory("partial", "annual/event re-underwrites are specified but not durably enforced"),
    deterministic_add_accounting: advisory("partial", "the one-add lifetime rule is in the mandate but has no durable counter"),
  }),
});

const trustReady = Object.fromEntries(
  SHARED_TRUST_CONTROLS.map(({ id }) => [id, live("complete", "shared production boundary")])
);

export const CURRENT_TRUST_CAPABILITY_MATRIX = Object.freeze(
  Object.fromEntries(PARITY_AGENT_IDS.map((agentId) => [agentId, Object.freeze({ ...trustReady })]))
);

/**
 * The rules intentionally differ by mandate. These differences are not parity
 * defects; failing to enforce them through equivalent workflow stages is.
 */
export const MANDATE_POLICY_DIFFERENCES = Object.freeze({
  "agent-1": Object.freeze({
    mandate: "short-term high-velocity",
    discoveryBias: "technology sub-verticals and near-term acceleration",
    holdingCadence: "daily objective monitoring and short-clock exit logic",
    addPolicy: "no averaging down; additions return to percentage sizing",
  }),
  "agent-2": Object.freeze({
    mandate: "medium-term momentum",
    discoveryBias: "persistent price, fundamental, and institutional trends",
    holdingCadence: "daily triggers, weekly rescore, and earnings re-underwrite",
    addPolicy: "no averaging down; adds require trend persistence",
  }),
  "agent-3": Object.freeze({
    mandate: "long-term compounder",
    discoveryBias: "durable multi-year quality at a defensible valuation",
    holdingCadence: "event-driven monitoring plus annual re-underwrite",
    addPolicy: "at most one controlled add after a complete fresh re-underwrite",
  }),
});

export function capabilitySatisfiesParity(capability) {
  return capability?.state === "deterministic_live" && capability?.coverage === "complete";
}

function assess(agentId, requirements, matrix) {
  if (!PARITY_AGENT_IDS.includes(agentId)) throw new Error(`Unknown parity agent: ${agentId}`);
  const record = matrix?.[agentId] ?? {};
  const blockers = requirements
    .filter(({ id }) => !capabilitySatisfiesParity(record[id]))
    .map(({ id }) => ({
      capabilityId: id,
      state: record[id]?.state ?? "missing",
      coverage: record[id]?.coverage ?? "none",
      evidence: record[id]?.evidence ?? "no evidence recorded",
    }));
  return { ready: blockers.length === 0, blockers };
}

export function assessAgentCapabilityParity(
  agentId,
  {
    skillMatrix = CURRENT_SKILL_CAPABILITY_MATRIX,
    trustMatrix = CURRENT_TRUST_CAPABILITY_MATRIX,
  } = {}
) {
  const trust = assess(agentId, SHARED_TRUST_CONTROLS, trustMatrix);
  const skill = assess(agentId, SHARED_SKILL_CAPABILITIES, skillMatrix);
  return {
    agentId,
    trustReady: trust.ready,
    capabilityReady: skill.ready,
    trustObservationEligible: trust.ready,
    skillObservationEligible: trust.ready && skill.ready,
    trustBlockers: trust.blockers,
    skillBlockers: skill.blockers,
  };
}

export function assessFleetCapabilityParity(options = {}) {
  const agents = PARITY_AGENT_IDS.map((agentId) => assessAgentCapabilityParity(agentId, options));
  return {
    agents,
    trustObservationEligible: agents.every((agent) => agent.trustObservationEligible),
    skillObservationComparable: agents.every((agent) => agent.skillObservationEligible),
  };
}

/** Build the acceptance target without changing the evidence-backed current snapshot. */
export function buildCompleteParityTarget() {
  const skillMatrix = {};
  const trustMatrix = {};
  for (const agentId of PARITY_AGENT_IDS) {
    skillMatrix[agentId] = Object.fromEntries(
      SHARED_SKILL_CAPABILITIES.map(({ id }) => [id, {
        state: "deterministic_live",
        coverage: "complete",
        evidence: `verified production evidence for ${agentId}/${id}`,
      }])
    );
    trustMatrix[agentId] = Object.fromEntries(
      SHARED_TRUST_CONTROLS.map(({ id }) => [id, {
        state: "deterministic_live",
        coverage: "complete",
        evidence: `verified production evidence for ${agentId}/${id}`,
      }])
    );
  }
  return { skillMatrix, trustMatrix };
}
