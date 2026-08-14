import "dotenv/config";
import { fileURLToPath } from "node:url";
import { fetchFundamentals, fetchConsensusTrend } from "../lib/yahoo.js";
import { fetchCompanyFacts } from "../lib/edgar.js";
import { getPeerCoverageRequests, getPeerMetrics, getUniverseCatalog, setPeerMetrics } from "../lib/redis.js";
import { peerMetricsRow } from "../lib/mandate-metrics.js";
import { selectPeerCoverageRefreshTargets } from "../lib/peer-coverage.js";
import { consensusSnapshotRow } from "../lib/consensus-snapshot.js";
import { consensusStoreConfigured, writeConsensusSnapshots } from "../lib/pg/consensus-snapshots.js";

const DEFAULT_LIMIT = 40;
const CHECKPOINT_SIZE = 5;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function configured(env = process.env) {
  return env.PEER_METRICS_ENABLED?.trim() === "1" && env.PEER_METRICS_EDGAR?.trim() === "1";
}

/**
 * Fetch requested peer cohorts directly, checkpointing every few names. This is
 * intentionally independent of the broad listing/quote refresh: a Lab request
 * should not wait behind thousands of catalog names before it can establish its
 * own peer evidence. It is research-data only and never calls a model or order path.
 */
export async function runPeerCoverageRefresh({
  env = process.env,
  limit = Math.max(1, Number(env.PEER_COVERAGE_REFRESH_LIMIT?.trim()) || DEFAULT_LIMIT),
  getCatalog = getUniverseCatalog,
  getRequests = getPeerCoverageRequests,
  getMetrics = getPeerMetrics,
  saveMetrics = setPeerMetrics,
  getFundamentals = fetchFundamentals,
  getCompanyFacts = fetchCompanyFacts,
  getConsensusTrend = fetchConsensusTrend,
  saveConsensusSnapshots = writeConsensusSnapshots,
  consensusStore = consensusStoreConfigured,
  pool,
  now = () => new Date(),
  sleep = pause,
} = {}) {
  if (!configured(env)) return { state: "disabled", reason: "peer_metrics_not_enabled", attempted: 0, cached: 0, failed: 0 };
  const [catalog, requests, existing] = await Promise.all([getCatalog(), getRequests(), getMetrics()]);
  if (!catalog || !Object.keys(catalog).length) return { state: "not_configured", reason: "universe_catalog_unavailable", attempted: 0, cached: 0, failed: 0 };
  const plan = selectPeerCoverageRefreshTargets(catalog, requests, existing, { limit });
  const targets = plan.targets;
  if (!targets.length) {
    return {
      state: plan.unresolvedRequests ? "blocked" : "idle",
      reason: plan.unresolvedRequests ? "unresolved_cohorts_have_no_refreshable_rows" : "no_coverage_requests",
      attempted: 0,
      cached: 0,
      failed: 0,
      unresolvedRequests: plan.unresolvedRequests,
    };
  }

  // Consensus accumulation rides this pass because it is the only place that
  // already visits each name on a paced, gated schedule. `estimateRevisions` is a
  // change between observed instants, so it does not exist until a history has
  // been built — every pass that skips collection is a permanently missing point.
  const collectConsensus = consensusStore({ pool });
  if (!collectConsensus) {
    console.warn("[PeerCoverage] durable consensus store not configured — consensus history is NOT accumulating.");
  }

  const merged = { ...(existing ?? {}) };
  const failures = [];
  const consensusRows = [];
  let cached = 0;
  let consensusFailed = 0;
  for (const [index, ticker] of targets.entries()) {
    try {
      const fundamentals = await getFundamentals(ticker);
      if (fundamentals?.error) throw new Error(fundamentals.error);
      const facts = await getCompanyFacts(ticker);
      merged[ticker] = peerMetricsRow(fundamentals, facts);
      cached++;
    } catch (error) {
      failures.push({ ticker, reason: String(error?.message ?? error).slice(0, 160) });
      console.warn(`[PeerCoverage] ${ticker} unavailable: ${failures.at(-1).reason}`);
    }
    // Consensus is a SEPARATE try: it is research context that can never upgrade
    // an action, so losing it must degrade revBeat/estimateRevisions to missing
    // (where lib/mandate-score.js rescales them out) and never cost this ticker
    // its peer-metrics row, which the whole peer-relative substrate depends on.
    if (collectConsensus) {
      try {
        const trend = await getConsensusTrend(ticker);
        const row = trend ? consensusSnapshotRow({ ...trend, ticker }, { now }) : null;
        if (row) consensusRows.push(row);
      } catch (error) {
        consensusFailed++;
        console.warn(`[PeerCoverage] ${ticker} consensus unavailable: ${String(error?.message ?? error).slice(0, 160)}`);
      }
    }
    // Each checkpoint is durable so an interrupted cohort pass retains useful data.
    if ((index + 1) % CHECKPOINT_SIZE === 0 || index === targets.length - 1) await saveMetrics(merged);
    await sleep(250);
  }

  // Written once at the end rather than per checkpoint: these rows are an
  // append-only observation log keyed by retrieval instant, so a partial pass
  // loses only the names it never reached, and duplicate instants are ignored by
  // the store. A write failure here is loud but must not fail the peer refresh.
  let consensusStored = 0;
  if (consensusRows.length) {
    try {
      ({ inserted: consensusStored } = await saveConsensusSnapshots(consensusRows, { pool }));
    } catch (error) {
      console.error(`[PeerCoverage] consensus snapshot write FAILED (${consensusRows.length} observations lost): ${error?.message ?? error}`);
    }
  }

  const result = {
    state: "completed",
    attempted: targets.length,
    cached,
    failed: failures.length,
    targets,
    failures,
    unresolvedRequests: plan.unresolvedRequests,
    consensusObserved: consensusRows.length,
    consensusStored,
    consensusFailed,
  };
  console.log(`[PeerCoverage] completed ${cached}/${targets.length} requested cohort metric rows (${failures.length} failed); consensus stored ${consensusStored}/${consensusRows.length}.`);
  return result;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runPeerCoverageRefresh().catch((error) => {
    console.error("[PeerCoverage] Failed:", error.message);
    process.exit(1);
  });
}
