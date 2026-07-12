import "dotenv/config";
import { fileURLToPath } from "node:url";
import { buildIndustryDistributions } from "../lib/peer-source.js";
import { METRIC_IDS } from "../config/scoring/mandate-v2.js";
import { getPeerMetrics, setPeerDistributions } from "../lib/redis.js";

/**
 * Peer-distribution builder (Mandate v2, Phase A/W2).
 *
 * Reads the per-name metric vectors accumulated by the enrichment crawl
 * (pm:peer-metrics:*, populated only when PEER_METRICS_ENABLED is set — see
 * jobs/universe-refresh.js), groups them by Yahoo industry, and writes the sorted
 * per-industry distributions (pm:peer-dist:<industry>) that lib/peer-scoring.js
 * ranks candidates against.
 *
 * Deterministic, idempotent, read-mostly. NOT scheduled yet and NOT on any money
 * path — run manually (`npm run peer:dist`) during Phase A validation. Once the
 * peer scores are trusted, this gets scheduled after the nightly universe refresh.
 * See docs/MANDATE-V2-INGESTION.md.
 */
export async function runPeerDistributions() {
  const metricsMap = await getPeerMetrics();
  const tickers = Object.keys(metricsMap);
  if (!tickers.length) {
    console.log("[PeerDist] No peer metrics cached yet — set PEER_METRICS_ENABLED and let the nightly refresh accumulate vectors first.");
    return { built: false, industries: 0, names: 0 };
  }

  const names = tickers.map((ticker) => ({
    ticker,
    industry: metricsMap[ticker]?.industry ?? null,
    metrics: metricsMap[ticker]?.metrics ?? {},
  }));

  const distByIndustry = buildIndustryDistributions(names, METRIC_IDS);
  await setPeerDistributions(distByIndustry);

  const industries = Object.keys(distByIndustry);
  const classified = names.filter((n) => n.industry).length;
  console.log(
    `[PeerDist] Built ${industries.length} industry distributions from ${classified}/${names.length} classified names (${METRIC_IDS.length} metrics).`
  );
  return { built: true, industries: industries.length, names: classified };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runPeerDistributions().catch((e) => {
    console.error("[PeerDist] Failed:", e.message);
    process.exit(1);
  });
}
