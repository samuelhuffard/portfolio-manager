/**
 * Inert end-to-end mandate v3 conviction aggregator.
 *
 * Consumes already-derived candidate values, peer distributions, and absolute
 * evidence. It performs no I/O and is intentionally not imported by live jobs.
 */
import { AGENT_SCORING, ABSOLUTE_VALUATION_TABLES } from "../config/scoring/mandate-v2.js";
import { absoluteRuleTableFor, SPECIAL_SECTOR_RULE_TABLES } from "../config/scoring/absolute-thresholds.js";
import { scoreAbsoluteRuleTable } from "./absolute-rules.js";
import { bandFraction, percentileRank, scoreValuationCascade, applyThinPeerConvictionCap } from "./peer-scoring.js";
import { pickFallbackMode } from "./peer-resolve.js";

const METHOD_RANK = { peer_relative: 0, blended_50_50: 1, absolute: 2 };
const round2 = (n) => Math.round(n * 100) / 100;

function metricSpecs(config) {
  const out = [];
  for (const [category, categorySpec] of Object.entries(config.categories)) {
    for (const [metricId, spec] of Object.entries(categorySpec.metrics)) out.push({ category, metricId, spec });
  }
  return out;
}

function peerComponent(value, peers, spec) {
  if (value == null || Number.isNaN(value)) return null;
  const percentile = percentileRank(value, [...peers, value], spec.higherIsBetter !== false);
  if (percentile == null) return null;
  const fraction = bandFraction(percentile);
  return { points: fraction * spec.points, fraction, percentile };
}

function absoluteComponent({ agentId, metricId, spec, evidence, sector, valuationEvidence }) {
  if (metricId === "peerValuation") {
    const requiredSectorSource = sector ? `${sector}_absolute` : null;
    if (requiredSectorSource && (!valuationEvidence?.absoluteSpec || valuationEvidence.absoluteSource !== requiredSectorSource)) return null;
    const result = scoreValuationCascade({
      ...valuationEvidence,
      value: valuationEvidence?.value ?? evidence?.value,
      absoluteSpec: valuationEvidence?.absoluteSpec ?? ABSOLUTE_VALUATION_TABLES.universal.forwardPE,
    });
    return result.missing ? null : { points: result.fraction * spec.points, fraction: result.fraction, source: result.source };
  }
  const table = absoluteRuleTableFor(agentId, metricId, sector);
  const result = scoreAbsoluteRuleTable(evidence, table);
  return result.missing ? null : { points: result.fraction * spec.points, fraction: result.fraction, source: sector && SPECIAL_SECTOR_RULE_TABLES[sector]?.[metricId] ? `${sector}_absolute` : "agent_absolute" };
}

export function scoreMandateCandidate({
  agentId,
  metricVector = {},
  peerDistributions = {},
  absoluteEvidence = {},
  valuationEvidence = null,
  sector = null,
  peerSetUsed = null,
  humanOverride = false,
}) {
  const config = AGENT_SCORING[agentId];
  if (!config) throw new Error(`Unknown mandate agent: ${agentId}`);

  const perMetric = {};
  const categories = {};
  const missingMetrics = [];
  const methods = [];
  const peerCounts = [];
  const sectorSubstitutionsUsed = [];
  const criticalMissingMetrics = [];
  let earned = 0;
  let maxAvailable = 0;

  for (const { category, metricId, spec } of metricSpecs(config)) {
    const peers = (peerDistributions[metricId] ?? []).filter((v) => v != null && !Number.isNaN(v));
    const routing = pickFallbackMode(peers.length);
    const peer = peerComponent(metricVector[metricId], peers, spec);
    const absolute = absoluteComponent({ agentId, metricId, spec, evidence: absoluteEvidence[metricId], sector, valuationEvidence });
    let points = null;

    if (routing.mode === "peer_relative") points = peer?.points ?? null;
    else if (routing.mode === "blended_50_50" && peer && absolute) points = peer.points * 0.5 + absolute.points * 0.5;
    else if (routing.mode === "absolute") points = absolute?.points ?? null;

    const isSpecialSectorMetric = Boolean(sector && (SPECIAL_SECTOR_RULE_TABLES[sector]?.[metricId] || metricId === "peerValuation"));
    if (points == null) {
      missingMetrics.push(metricId);
      if (isSpecialSectorMetric) criticalMissingMetrics.push(metricId);
    }
    else {
      earned += points;
      maxAvailable += spec.points;
      categories[category] ??= { earned: 0, maxAvailable: 0 };
      categories[category].earned += points;
      categories[category].maxAvailable += spec.points;
    }
    if (isSpecialSectorMetric) sectorSubstitutionsUsed.push(metricId);
    methods.push(routing.mode);
    peerCounts.push(peers.length);
    perMetric[metricId] = {
      points: points == null ? null : round2(points),
      maxPoints: spec.points,
      peerCount: peers.length,
      fallbackMethod: routing.mode,
      peer,
      absolute,
      missing: points == null,
    };
  }

  const uncapped = maxAvailable > 0 ? (earned / maxAvailable) * 100 : 0;
  const fallbackMethod = methods.reduce((worst, method) => METHOD_RANK[method] > METHOD_RANK[worst] ? method : worst, "peer_relative");
  const thinPeerSet = fallbackMethod !== "peer_relative";
  const total = applyThinPeerConvictionCap(Math.round(uncapped), { thinPeerSet, humanOverride });

  return {
    total,
    uncappedTotal: Math.round(uncapped),
    rawPoints: round2(earned),
    maxAvailable,
    complete: missingMetrics.length === 0,
    actionable: criticalMissingMetrics.length === 0 && maxAvailable >= 80,
    noTradeReason: criticalMissingMetrics.length
      ? "missing_critical_special_sector_data"
      : maxAvailable < 80
        ? "insufficient_available_points"
        : null,
    scoringBasis: missingMetrics.length ? "rescaled_available_fields" : "full",
    peerCount: peerCounts.length ? Math.min(...peerCounts) : 0,
    thinPeerSet,
    fallbackMethod,
    peerSetUsed,
    sectorSubstitutionsUsed,
    missingMetrics,
    criticalMissingMetrics,
    categories,
    perMetric,
  };
}
