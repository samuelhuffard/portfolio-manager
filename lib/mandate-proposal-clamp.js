/**
 * The missing wire: make the deterministic mandate conviction score actually drive
 * proposal sizing.
 *
 * Everything this needs already existed and was consumed by nothing but its own tests:
 * `lib/mandate-policy.js` (`evaluateMandateSizing` → tier resolution, macro tier cap,
 * position/sector/cash ceilings) over the canonical per-agent tables in
 * `config/agents/mandate-policy.js`. `lib/mandate-score.js` produces the score. This
 * module joins them to the proposal pipeline.
 *
 * The mandate rule being enforced (Agent One §6.5, mirrored per agent in
 * `MANDATE_POLICIES[...].score.tiers`):
 *   85–100 → tier 1 · 65–84 → tier 2 · 45–64 → tier 3 · below the agent's
 *   `minimumEntryScore` → NO_TRADE. Agent 3 has no speculative tier and a 65 floor.
 *
 * FOUR HARD RULES, each load-bearing:
 *
 * 1. DOWNGRADE-ONLY. `jobs/research-scan.js` states the pipeline invariant: "Nothing in
 *    here may ever upgrade an action — every step only blocks, shrinks, or downgrades
 *    toward HOLD." A tier therefore sets a CEILING. If the generator asked for 3% and
 *    tier 1 permits 10–15%, the result stays 3% — we never raise a request to fill a
 *    band. `evaluateMandateSizing` is built the same way ("enforces upper bounds only").
 *
 * 2. BUY ONLY — NEVER GATE A SELL. Entry tiers are entry economics; the sell procedure
 *    is a separate mandate section. Letting thin score coverage block an exit would mean
 *    that degraded data makes positions unsellable, which is strictly more dangerous
 *    than not sizing an entry. This mirrors the Agent 4 asymmetry rule ("never block a
 *    sell"). SELL and HOLD pass through untouched.
 *
 * 3. FAIL CLOSED WHEN ENABLED. Once the gate is on, a missing, unparseable, stale, or
 *    identity-mismatched score downgrades a BUY to HOLD. A BUY must never proceed
 *    merely because we could not read its score.
 *
 * 4. OFF BY DEFAULT. Gated by `MANDATE_SCORE_GATES_PROPOSALS=1`. The master plan places
 *    score-driven proposals at Phase 3–4; the flag keeps the mechanism reviewable in
 *    place without changing live behavior until the owner turns it on.
 *
 * Pure and synchronous. Never touches orders, ledgers, execution, or signatures.
 */
import { evaluateMandateSizing } from "./mandate-policy.js";

/** Env flag. Absent/anything-but-"1" leaves the pipeline exactly as it is today. */
export function mandateGateEnabled(env = process.env) {
  return env.MANDATE_SCORE_GATES_PROPOSALS?.trim() === "1";
}

function note(rec, text) {
  return { ...rec, overrideNotes: [...(rec.overrideNotes ?? []), text] };
}

function toHold(rec, reason) {
  return note({ ...rec, action: "HOLD", targetWeight: 0 }, `mandate_score_gate: ${reason}`);
}

/**
 * Apply the mandate conviction score to one proposed recommendation.
 *
 * @param {object} rec        the recommendation after the risk engine, `{action, targetWeight, ...}`
 * @param {object} args
 * @param {string} args.agentId
 * @param {object|null} args.scoreObservation  a durable mandate score observation
 *        (`lib/mandate-observation.js` shape — NOT the Redis latest-view cache row,
 *        which omits the identity fields `evaluateMandateScore` validates).
 * @param {object} args.evidence   typed evidence records for `evaluateMandateSizing`
 * @param {string} args.asOf       zoned ISO instant
 * @param {boolean} [args.enabled] defaults to the env flag
 * @returns {{ rec: object, gate: object|null, applied: boolean }}
 */
export function applyMandateScoreClamp(rec, { agentId, scoreObservation = null, evidence = {}, asOf, enabled } = {}) {
  const on = enabled ?? mandateGateEnabled();
  if (!on) return { rec, gate: null, applied: false };

  // Rule 2: only entries are tier-sized. An exit is never blocked by score coverage.
  if (rec?.action !== "BUY") return { rec, gate: null, applied: false };

  // Rule 3: fail closed. Handled before evaluateMandateSizing so a missing observation
  // produces a stable reason code rather than a schema blocker cascade.
  if (!scoreObservation) {
    return { rec: toHold(rec, "no mandate score observation for this candidate"), gate: null, applied: true };
  }

  let gate;
  try {
    gate = evaluateMandateSizing({ agentId, evidence, asOf, scoreObservation });
  } catch (error) {
    // A malformed asOf is a programming error, not a market condition — still fail closed.
    return { rec: toHold(rec, `sizing evaluation failed (${error.message})`), gate: null, applied: true };
  }

  if (!gate.eligible) {
    const codes = gate.blockers.map((b) => b.code).join("; ");
    return { rec: toHold(rec, codes || "blocked by mandate sizing policy"), gate, applied: true };
  }

  // Eligible: the tier ceiling caps the request. `evaluateMandateSizing` already
  // rejects a request above the ceiling, so reaching here with an over-tier weight
  // should be impossible — clamp anyway rather than trusting an upstream invariant.
  const ceiling = gate.tier?.targetWeight?.[1];
  if (typeof ceiling === "number" && typeof rec.targetWeight === "number" && rec.targetWeight > ceiling) {
    return {
      rec: note(
        { ...rec, targetWeight: ceiling },
        `mandate_score_gate: ${gate.tier.name} ceiling — clamped ${rec.targetWeight}%→${ceiling}%`,
      ),
      gate,
      applied: true,
    };
  }

  // Within tier. Record the tier for the evaluator's benefit without altering size.
  return {
    rec: note(rec, `mandate_score_gate: ${gate.tier?.name ?? "tier"} (score ${scoreObservation.score}) — size unchanged`),
    gate,
    applied: true,
  };
}

/**
 * Compact, serializable summary of the gate decision to attach to the proposal so the
 * evaluator and the approval UI can see WHY a size was permitted, not just the number.
 * Returns null when the gate did not run.
 */
export function mandateGateSummary(gate, scoreObservation = null) {
  if (!gate) return null;
  return {
    policyVersion: gate.policyVersion,
    agentId: gate.agentId,
    mandateId: gate.mandateId,
    mandateVersion: gate.mandateVersion,
    eligible: gate.eligible,
    status: gate.status,
    tier: gate.tier?.name ?? null,
    tierRange: gate.tier?.targetWeight ?? null,
    score: scoreObservation?.score ?? null,
    maxAvailablePoints: scoreObservation?.maxAvailablePoints ?? null,
    observationId: scoreObservation?.id ?? null,
    blockers: gate.blockers.map((b) => b.code),
    evidenceLineage: gate.evidenceLineage,
  };
}
