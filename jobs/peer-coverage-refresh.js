import "dotenv/config";
import { fileURLToPath } from "node:url";
import { fetchFundamentals } from "../lib/yahoo.js";
import { fetchCompanyFacts } from "../lib/edgar.js";
import { getPeerCoverageRequests, getPeerMetrics, getUniverseCatalog, setPeerMetrics } from "../lib/redis.js";
import { peerMetricsRow } from "../lib/mandate-metrics.js";
import { selectPeerCoverageRefreshTargets } from "../lib/peer-coverage.js";

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

  const merged = { ...(existing ?? {}) };
  const failures = [];
  let cached = 0;
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
    // Each checkpoint is durable so an interrupted cohort pass retains useful data.
    if ((index + 1) % CHECKPOINT_SIZE === 0 || index === targets.length - 1) await saveMetrics(merged);
    await sleep(250);
  }
  const result = { state: "completed", attempted: targets.length, cached, failed: failures.length, targets, failures, unresolvedRequests: plan.unresolvedRequests };
  console.log(`[PeerCoverage] completed ${cached}/${targets.length} requested cohort metric rows (${failures.length} failed).`);
  return result;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runPeerCoverageRefresh().catch((error) => {
    console.error("[PeerCoverage] Failed:", error.message);
    process.exit(1);
  });
}
