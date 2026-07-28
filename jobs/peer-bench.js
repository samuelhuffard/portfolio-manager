import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS } from "../config/agents.js";
import { getPeerMetrics, getUniverseCatalog, requestPeerCoverage } from "../lib/redis.js";
import { assessPeerCoverage, scorePeerFundamentals } from "../lib/peer-coverage.js";
import { buildLiveResearchCandidateBus } from "../lib/research-candidate-bus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PER_AGENT = 36;
const CAPACITY_TARGET = 18;

function loadConfigs() {
  return Object.fromEntries(AGENTS.map(({ id }) => [id, {
    riskLimits: JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "agents", id, "risk-limits.json"), "utf8")),
  }]));
}

export function buildPeerBench({ catalog, agentConfigs, perAgent = DEFAULT_PER_AGENT } = {}) {
  const bus = buildLiveResearchCandidateBus({ catalog, agentConfigs });
  return Object.fromEntries(AGENTS.map(({ id }) => [id, (bus.agents[id]?.eligible ?? []).slice(0, perAgent)]));
}

export function peerBenchCapacity(bench = {}, peerMetrics = {}) {
  const agents = {};
  for (const [agentId, candidates] of Object.entries(bench)) {
    let ready = 0;
    for (const candidate of candidates) {
      const coverage = assessPeerCoverage({ ...candidate, peerMetrics });
      if (coverage.ready && scorePeerFundamentals({ candidate: { ...candidate, quant: peerMetrics[candidate.ticker]?.quant }, peers: coverage.peers })) ready++;
    }
    agents[agentId] = { bench: candidates.length, ready, target: CAPACITY_TARGET, sufficient: ready >= CAPACITY_TARGET };
  }
  return { agents, sufficient: Object.values(agents).every((agent) => agent.sufficient) };
}

/** Data-only pre-scan pool. It queues likely candidates and their cohorts before 5:15. */
export async function runPeerBench({
  perAgent = Math.max(1, Number(process.env.PEER_BENCH_PER_AGENT) || DEFAULT_PER_AGENT),
  refreshRequests = true,
  getCatalog = getUniverseCatalog,
  getMetrics = getPeerMetrics,
  requestCoverage = requestPeerCoverage,
  agentConfigs = loadConfigs(),
} = {}) {
  const [catalog, peerMetrics] = await Promise.all([getCatalog(), getMetrics()]);
  if (!catalog || !Object.keys(catalog).length) throw new Error("Peer bench requires a universe catalog.");
  const bench = buildPeerBench({ catalog, agentConfigs, perAgent });
  let requested = 0;
  if (refreshRequests) {
    for (const [agentId, candidates] of Object.entries(bench)) {
      for (const candidate of candidates) {
        await requestCoverage({ ticker: candidate.ticker, industry: candidate.industry, sector: candidate.sector, source: `peer_bench:${agentId}` });
        requested++;
      }
    }
  }
  const capacity = peerBenchCapacity(bench, peerMetrics);
  console.log(`[PeerBench] queued ${requested} requests; ${capacity.sufficient ? "capacity sufficient" : "capacity below target"}.`);
  return { state: "completed", requested, capacity };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runPeerBench().catch((error) => { console.error("[PeerBench] Failed:", error.message); process.exit(1); });
}
