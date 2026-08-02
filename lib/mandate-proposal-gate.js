/**
 * Live-scan adapter for the optional mandate-score proposal gate.
 *
 * The durable Postgres observation is the only permitted source: Redis holds a
 * presentation cache and cannot answer the decision-time query.  This adapter
 * is intentionally small so the money-adjacent scan path keeps the pure policy
 * decision in `mandate-proposal-clamp.js` and the I/O boundary is testable.
 */
import { applyMandateScoreClamp, mandateGateEnabled, mandateGateSummary } from "./mandate-proposal-clamp.js";
import { readLatestMandateScoreObservationAtOrBefore } from "./pg/research-observations.js";

export async function applyPersistedMandateScoreGate(rec, {
  agentId,
  ticker,
  asOf,
  evidence = {},
  env = process.env,
  readObservation = readLatestMandateScoreObservationAtOrBefore,
} = {}) {
  const enabled = mandateGateEnabled(env);
  if (!enabled || rec?.action !== "BUY") {
    return { rec, gate: null, summary: null, applied: false };
  }

  let scoreObservation = null;
  try {
    scoreObservation = await readObservation({ agentId, ticker, asOf });
  } catch (error) {
    // Do not allow a database outage or malformed durable row to become an
    // un-gated entry. The pure clamp records the stable no-observation reason.
    const message = error instanceof Error ? error.message : String(error ?? "unknown error");
    console.error(`[MandateGate] ${agentId} ${ticker}: durable score lookup failed (failing closed): ${message}`);
  }

  const result = applyMandateScoreClamp(rec, {
    agentId,
    scoreObservation,
    evidence,
    asOf,
    enabled: true,
  });
  return { ...result, summary: mandateGateSummary(result.gate, scoreObservation) };
}
