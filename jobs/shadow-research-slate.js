import { readFileSync } from "node:fs";
import { selectEvidenceSlate } from "../lib/evidence-slate.js";
import { compareShadowSlate } from "../lib/shadow-slate.js";
import { summarizeActionableCandidateDossiers } from "../lib/actionable-candidate-dossier.js";
import { contentHash, mandateMetadataFor } from "../lib/research-version.js";
import { writeResearchSelectionRun } from "../lib/pg/research-events.js";
import { setShadowSelectionStatus } from "../lib/redis.js";
import { getPrivateResearchSlate } from "../lib/redis.js";
import { TICKER_RE } from "../contracts/proposal.js";

const CONFIG_URL = new URL("../config/research-selection.json", import.meta.url);
const UNIVERSE_URL = new URL("../config/agents/agent-1/universe.json", import.meta.url);
const BASELINE_POLICY = Object.freeze({ version: "live-review-baseline-v1", maxAgeMs: 36 * 60 * 60 * 1000 });
const COMPARATOR_VERSION = "shadow-slate-comparator-v1";
const BASELINE_BUCKETS = new Set(["holdings", "movers", "ranked", "exploration"]);

function selectionConfig(config = JSON.parse(readFileSync(CONFIG_URL, "utf8"))) {
  const { mode, policyVersion, canarySlots, explorationSlots, maxSectorShare } = config ?? {};
  if (!["shadow", "canary", "live"].includes(mode) || !String(policyVersion ?? "").trim()
    || !Number.isInteger(canarySlots) || canarySlots < 0
    || !Number.isInteger(explorationSlots) || explorationSlots < 0
    || !Number.isFinite(maxSectorShare) || maxSectorShare < 0 || maxSectorShare > 1) {
    throw new TypeError("research-selection config is invalid");
  }
  return { mode, policyVersion, canarySlots, explorationSlots, maxSectorShare };
}

function derivedUniverseSettings(universe = JSON.parse(readFileSync(UNIVERSE_URL, "utf8"))) {
  const researchCooldownDays = Number(universe?.researchCooldownDays);
  const aiReviewBudget = Number(universe?.aiReviewBudget);
  const productionUniversePolicyVersion = mandateMetadataFor("agent-1").productionUniversePolicyVersion;
  if (!Number.isInteger(researchCooldownDays) || researchCooldownDays < 0 || !Number.isInteger(aiReviewBudget) || aiReviewBudget < 0 || !productionUniversePolicyVersion) {
    throw new TypeError("Agent 1 production universe cooldown is invalid");
  }
  return { aiReviewBudget, cooldownPolicy: {
    version: `${productionUniversePolicyVersion}:research-cooldown-days-${researchCooldownDays}`,
    maxAgeMs: researchCooldownDays * 24 * 60 * 60 * 1000,
  } };
}

function derivedCooldownPolicy(universe) { return derivedUniverseSettings(universe).cooldownPolicy; }

function reasonCounts(items) {
  const counts = {};
  for (const item of items) for (const code of item.reasonCodes ?? []) counts[code] = (counts[code] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function sourceTimestamp(observations, fallback) {
  const timestamps = observations.map((item) => Date.parse(item.observedAt)).filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : fallback;
}

function withObservationLineage(items, observations) {
  const currentByIdentity = new Map(observations.map((item) => [`${item.agentId}/${item.ticker}`, item]));
  return items
    .map((item) => ({
      ...item,
      triggeringObservationId: item.triggeringObservationId
        ?? currentByIdentity.get(`${item.agentId ?? "agent-1"}/${item.ticker}`)?.id
        ?? null,
    }))
    .filter((item) => item.budgetExempt || item.triggeringObservationId || item.triggeringEventId);
}

function normalizeBaseline(baselineSlate, defaultAgentId) {
  if (!Array.isArray(baselineSlate)) throw new TypeError("baselineSlate must be an array");
  return baselineSlate.map((item) => {
    const value = typeof item === "string" ? { ticker: item, agentId: defaultAgentId } : item;
    if (!value || typeof value !== "object") throw new TypeError("baselineSlate items must be tickers or objects");
    return { ...value, ticker: String(value.ticker ?? "").trim().toUpperCase(), agentId: value.agentId ?? defaultAgentId };
  });
}

function validatedBaseline(envelope, { agentId, completedAt }) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return { unavailable: "baseline_unavailable" };
  if (!Array.isArray(envelope.items) || envelope.items.length === 0) return { unavailable: "baseline_unavailable" };
  const sourceRunId = String(envelope.sourceRunId ?? "").trim();
  const capturedAt = String(envelope.capturedAt ?? "").trim();
  const capturedMs = Date.parse(capturedAt);
  const completedMs = Date.parse(completedAt);
  if (!sourceRunId || envelope.agentId !== agentId || !Number.isFinite(capturedMs) || !Number.isFinite(completedMs)) {
    return { unavailable: "baseline_provenance_invalid" };
  }
  const identities = new Set();
  for (const item of envelope.items) {
    const ticker = String(item?.ticker ?? "").trim().toUpperCase();
    if (!item || typeof item !== "object" || Array.isArray(item) || item.agentId !== agentId
      || !TICKER_RE.test(ticker) || !BASELINE_BUCKETS.has(item.bucket) || identities.has(ticker)) {
      return { unavailable: "baseline_provenance_invalid" };
    }
    identities.add(ticker);
  }
  const ageMs = completedMs - capturedMs;
  if (ageMs < 0 || ageMs > BASELINE_POLICY.maxAgeMs) return { unavailable: "baseline_stale" };
  return { sourceRunId, capturedAt: new Date(capturedMs).toISOString(), items: envelope.items };
}

function sectorConcentrationSummary(value) {
  return {
    count: value.count,
    unknownSectorCount: value.unknownSectorCount,
    maxSectorShare: value.maxSectorShare,
  };
}

function marketCapConcentrationSummary(value) {
  return {
    count: value.count,
    knownMarketCapCount: value.knownMarketCapCount,
    unknownMarketCapCount: value.unknownMarketCapCount,
    maxMarketCapShare: value.marketCaps.length
      ? value.marketCaps.reduce((max, item) => Math.max(max, item.share ?? 0), 0)
      : null,
  };
}

function ageSummary(value) {
  return {
    count: value.count,
    knownCount: value.knownCount,
    unknownCount: value.unknownCount,
    minMs: value.minMs,
    maxMs: value.maxMs,
    averageMs: value.averageMs,
    medianMs: value.medianMs,
  };
}

function aggregateComparatorSummary(comparison) {
  return {
    version: COMPARATOR_VERSION,
    overlap: {
      count: comparison.overlap.count,
      nonHoldingCount: comparison.overlap.nonHoldingCount,
      currentCount: comparison.overlap.currentCount,
      proposedCount: comparison.overlap.proposedCount,
      nonHoldingShareOfCurrent: comparison.overlap.nonHoldingShareOfCurrent,
      nonHoldingShareOfProposed: comparison.overlap.nonHoldingShareOfProposed,
    },
    novelty: { count: comparison.novelty.count, shareOfProposedNonHoldings: comparison.novelty.shareOfProposedNonHoldings },
    turnover: { ...comparison.turnover },
    sectorConcentration: {
      current: sectorConcentrationSummary(comparison.sectorConcentration.current),
      proposed: sectorConcentrationSummary(comparison.sectorConcentration.proposed),
    },
    marketCapConcentration: {
      current: marketCapConcentrationSummary(comparison.marketCapConcentration.current),
      proposed: marketCapConcentrationSummary(comparison.marketCapConcentration.proposed),
    },
    evidenceAge: {
      current: ageSummary(comparison.evidenceAge.current),
      proposed: ageSummary(comparison.evidenceAge.proposed),
    },
  };
}

function candidatePoolCount({ agentId, holdings, mandatoryReunderwrites, events, stableCandidates, explorationCandidates }) {
  const identities = new Set();
  for (const item of [...holdings, ...mandatoryReunderwrites, ...events, ...stableCandidates, ...explorationCandidates]) {
    const ticker = typeof item === "string" ? item : item?.ticker;
    if (ticker) identities.add(`${item?.agentId ?? agentId}/${String(ticker).trim().toUpperCase()}`);
  }
  return identities.size;
}

function persistedItems(selected, baselineSlate, selectionRunId) {
  const selectedIdentities = new Set(selected.map((item) => `${item.agentId}/${item.ticker}`));
  const selectedRows = selected.map((item) => {
    const protectedReason = !item.budgetExempt ? null
      : (item.bucket === "holding" || item.bucket === "holdings") ? "holding"
        : item.bucket === "mandatory_reunderwrite" ? "mandatory_reunderwrite" : null;
    if (item.budgetExempt && !protectedReason) throw new TypeError("protected selection item has an unsupported bucket");
    return {
      id: `research-selection-item:${contentHash({ selectionRunId, ticker: item.ticker, agentId: item.agentId, selected: true })}`,
      selectionRunId, ticker: item.ticker, agentId: item.agentId, selected: true, rank: item.rank,
      bucket: protectedReason === "holding" ? "holding" : item.bucket, budgetExempt: item.budgetExempt, protectedReason,
      reasonCodes: protectedReason ? [...new Set([protectedReason, ...item.reasonCodes])] : item.reasonCodes,
      triggeringObservationId: item.triggeringObservationId, triggeringEventId: item.triggeringEventId,
      comparedTicker: item.displacedCandidate, displacedTicker: item.displacedCandidate,
    };
  });
  const displacedRows = baselineSlate
    .filter((item) => !selectedIdentities.has(`${item.agentId}/${item.ticker}`))
    .sort((left, right) => String(left.ticker).localeCompare(String(right.ticker)))
    .map((item, index) => ({
      id: `research-selection-item:${contentHash({ selectionRunId, ticker: item.ticker, agentId: item.agentId ?? "agent-1", selected: false })}`,
      selectionRunId, ticker: item.ticker, agentId: item.agentId ?? "agent-1", selected: false,
      rank: selectedRows.length + index, bucket: "current_rotation", budgetExempt: false, protectedReason: null,
      reasonCodes: ["displaced"], triggeringObservationId: null, triggeringEventId: null,
      comparedTicker: null, displacedTicker: null,
    }));
  return [...selectedRows, ...displacedRows];
}

/**
 * Records a shadow selection only. It never mutates the active research slate;
 * canary with zero slots has that same immediate rollback property. Positive
 * canary and every live request fail closed until a separately reviewed gate.
 */
export async function runShadowResearchSlate({
  runId, agentId = "agent-1", observations = [], events = [], holdings = [], mandatoryReunderwrites = [],
  baselineSlate, baselineProvenance, stableCandidates, explorationCandidates, budget = null,
  eventAgePolicy = null, config, universe, now = () => new Date(), pool,
  writeSelection = writeResearchSelectionRun, writeStatus = setShadowSelectionStatus,
  loadPrivateBaseline = getPrivateResearchSlate,
} = {}) {
  const sourceRunId = String(runId ?? "").trim();
  if (!sourceRunId) throw new TypeError("runShadowResearchSlate requires the workflow runId");
  const policy = selectionConfig(config);
  if (policy.mode === "live" || (policy.mode === "canary" && policy.canarySlots > 0)) {
    throw new Error("research selection live or positive-canary application is blocked pending promotion");
  }
  const completedAt = sourceTimestamp(observations, now().toISOString());
  const loadedBaseline = baselineSlate === undefined ? await loadPrivateBaseline(agentId) : { ...baselineProvenance, items: baselineSlate };
  const baseline = validatedBaseline(loadedBaseline, { agentId, completedAt });
  if (baseline.unavailable) {
    const unavailable = { state: "not_configured", reason: baseline.unavailable, runId: sourceRunId, failureStage: "baseline" };
    await writeStatus(unavailable);
    return unavailable;
  }
  const settings = derivedUniverseSettings(universe);
  const cooldownPolicy = settings.cooldownPolicy;
  const normalizedBaseline = normalizeBaseline(baseline.items, agentId).map((item) => ({ ...item, evidenceAt: baseline.capturedAt }));
  const baselineHoldings = normalizedBaseline.filter((item) => item.bucket === "holdings");
  const baselineStable = normalizedBaseline.filter((item) => item.bucket === "movers" || item.bucket === "ranked");
  const baselineExploration = normalizedBaseline.filter((item) => item.bucket === "exploration");
  const effectiveHoldings = holdings.length ? holdings : baselineHoldings;
  const effectiveStable = stableCandidates?.length ? stableCandidates : baselineStable.map((item) => ({ ...item, score: observations.find((observation) => observation.agentId === item.agentId && observation.ticker === item.ticker)?.score ?? null }));
  const effectiveExploration = explorationCandidates?.length ? explorationCandidates : baselineExploration;
  const effectiveBudget = budget == null ? settings.aiReviewBudget : budget;
  const candidateCount = candidatePoolCount({
    agentId, holdings: effectiveHoldings, mandatoryReunderwrites, events, stableCandidates: effectiveStable, explorationCandidates: effectiveExploration,
  });
  const stable = withObservationLineage(effectiveStable, observations);
  const exploration = withObservationLineage(effectiveExploration, observations);
  const slate = selectEvidenceSlate({
    agentId, holdings: effectiveHoldings, mandatoryReunderwrites, events, baselineSlate: normalizedBaseline,
    stableCandidates: stable, explorationCandidates: exploration,
    budget: effectiveBudget, explorationSlots: policy.explorationSlots, maxSectorShare: policy.maxSectorShare,
    eventAgePolicy, cooldownPolicy, now: completedAt,
  });
  const comparisonTickers = new Set([...normalizedBaseline, ...slate.items].map((item) => item.ticker));
  const comparisonObservations = [...new Map(observations
    .filter((item) => item.agentId === agentId && comparisonTickers.has(item.ticker))
    .map((item) => [item.ticker, item])).values()];
  const comparisonEvents = [...new Map(events
    .filter((item) => item.agentId === agentId && comparisonTickers.has(item.ticker))
    .map((item) => [item.ticker, item])).values()];
  const comparison = compareShadowSlate({
    currentSlate: normalizedBaseline,
    proposedSlate: slate.items,
    holdings: effectiveHoldings,
    candidatePool: comparisonObservations,
    researchEvents: comparisonEvents,
    now: completedAt,
  });
  const comparatorSummary = aggregateComparatorSummary(comparison);
  // The peer-relative score selects attention. This adjacent, deterministic
  // shadow record tells us whether selected names have enough fresh mandate
  // evidence to justify a future full dossier investigation. It never changes
  // the live slate, calls a model, or creates a proposal.
  // Holdings and mandatory re-underwrites are protected maintenance work, not
  // competing candidates. Keep them out of the dossier-readiness denominator.
  const candidateDossierReadiness = summarizeActionableCandidateDossiers(
    slate.items.filter((item) => item.budgetExempt !== true), observations,
  );
  const selectionRunId = `research-selection:${contentHash({
    sourceRunId,
    policyVersion: policy.policyVersion,
    mode: policy.mode,
    baselineSourceRunId: baseline.sourceRunId,
    baselineCapturedAt: baseline.capturedAt,
  })}`;
  const items = persistedItems(slate.items, normalizedBaseline, selectionRunId);
  const run = {
    id: selectionRunId, sourceRunId, policyVersion: policy.policyVersion,
    selectionPolicy: {
      version: policy.policyVersion, mode: policy.mode, canarySlots: policy.canarySlots,
      explorationSlots: policy.explorationSlots, maxSectorShare: policy.maxSectorShare,
      eventAgePolicyVersion: eventAgePolicy?.version ?? null,
      cooldownPolicyVersion: cooldownPolicy.version,
      policyUnresolved: eventAgePolicy == null,
      baselinePolicyVersion: BASELINE_POLICY.version,
      baselineSourceRunId: baseline.sourceRunId,
      baselineCapturedAt: baseline.capturedAt,
      comparator: comparatorSummary,
      candidateDossierReadiness,
    },
    mode: policy.mode, candidateCount, selectedCount: slate.items.length,
    displacedCount: items.filter((item) => !item.selected).length,
    createdAt: completedAt, completedAt,
  };
  await writeSelection({ run, items }, { pool });
  const selected = items.filter((item) => item.selected);
  const result = {
    runId: sourceRunId, selectionRunId, mode: policy.mode, policyVersion: policy.policyVersion,
    policyUnresolved: eventAgePolicy == null, candidateCount, selectedCount: selected.length,
    displacedCount: items.length - selected.length,
    overlapCount: comparatorSummary.overlap.nonHoldingCount,
    eligibleEventCount: events.filter((event) => event.researchEligible === true).length,
    reasonCodeCounts: reasonCounts(items), failureStage: null,
    // Deliberately expose no selected ticker list; the live scan path stays old.
    liveSlate: normalizedBaseline,
  };
  await writeStatus(Object.fromEntries([
    "runId", "selectionRunId", "mode", "policyVersion", "policyUnresolved", "candidateCount",
    "selectedCount", "displacedCount", "overlapCount", "eligibleEventCount", "reasonCodeCounts", "failureStage",
  ].map((field) => [field, result[field]])));
  return result;
}

export { derivedCooldownPolicy, selectionConfig };
