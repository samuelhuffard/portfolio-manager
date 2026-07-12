/**
 * Peer-scoring reality probe (Mandate v3, Phase A diagnostic).
 *
 * Answers the question every downstream step depends on: across REAL industries, how
 * many data-complete peers does a candidate actually have? That decides whether v3's
 * thin-peer tiers (≥8 → peer_relative · 6–7 → blended_50_50 · <6 → absolute) put most
 * names on the peer path or the absolute-threshold path.
 *
 * COST: $0 in LLM/API tokens. Uses only the FREE SEC EDGAR + yfinance HTTP APIs and
 * the pure deterministic scoring engine. No Claude/Sonnet/Opus call anywhere. Safe to
 * run repeatedly. ~60 paced HTTP calls, ~20–30s.
 *
 * Run: `npm run peer:probe`
 */
import { fetchFundamentals } from "../lib/yahoo.js";
import { fetchCompanyFacts } from "../lib/edgar.js";
import { peerMetricsRow } from "../lib/mandate-metrics.js";
import { buildIndustryDistributions } from "../lib/peer-source.js";
import { scoreCategoriesPeerRelative } from "../lib/peer-scoring.js";
import { METRIC_IDS, AGENT_SCORING } from "../config/scoring/mandate-v2.js";

// Representative cohorts (well-known members of a few sectors). We group by the
// industry yfinance actually returns — not our assumption — so classification
// granularity shows up honestly (e.g. Software split into Application vs Infrastructure).
const SAMPLE = [
  "MSFT", "ORCL", "CRM", "ADBE", "NOW", "SNOW", "DDOG", "NET", "CRWD", "ZS", "PANW", "WDAY",
  "NVDA", "AMD", "INTC", "AVGO", "QCOM", "TXN", "MU", "ADI", "NXPI", "MCHP", "ON", "MPWR",
  "JPM", "BAC", "WFC", "C", "USB", "PNC", "TFC", "COF", "GS", "MS", "SCHW", "FITB",
  "PLD", "AMT", "EQIX", "PSA", "O", "SPG", "WELL", "DLR", "VICI", "AVB", "EQR", "EXR",
];

const modeForCount = (n) => (n >= 8 ? "peer_relative" : n >= 6 ? "blended_50_50" : "absolute");

async function main() {
  console.log(`\nPeer-probe: ${SAMPLE.length} tickers · FREE data · $0 tokens\n`);
  const t0 = Date.now();
  const rows = [];
  let edgarOk = 0;

  for (const ticker of SAMPLE) {
    const f = await fetchFundamentals(ticker);
    if (f.error) { console.log(`  ${ticker}: yahoo error (${f.error})`); continue; }
    const cf = await fetchCompanyFacts(ticker);
    if (cf) edgarOk++;
    const row = peerMetricsRow(f, cf);
    rows.push({ ticker, industry: row.industry ?? "(unclassified)", metrics: row.metrics, src: row.src });
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\nFetched ${rows.length}/${SAMPLE.length} · EDGAR facts for ${edgarOk} · ${secs}s\n`);

  // Group by industry, count data-complete peers PER metric.
  const byIndustry = {};
  for (const r of rows) (byIndustry[r.industry] ??= []).push(r);

  console.log("=== Industry cohorts (classification granularity) ===");
  for (const [ind, members] of Object.entries(byIndustry).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${members.length.toString().padStart(2)}  ${ind}  [${members.map((m) => m.ticker).join(", ")}]`);
  }

  console.log("\n=== Data-complete peer_count per metric, per industry ===");
  console.log("(this is what v3's ≥8 / 6–7 / <6 tiering keys off — 'mode' shows what most names would get)\n");
  for (const [ind, members] of Object.entries(byIndustry)) {
    if (members.length < 2) continue;
    const line = METRIC_IDS.map((m) => {
      const n = members.filter((r) => r.metrics[m] != null).length;
      return `${m}:${n}`;
    });
    // Headline: how many peers have ALL EDGAR-scored metrics present (the binding constraint).
    const coreMetrics = ["revGrowth", "epsTrajectory", "marginTrend", "balanceSheet", "peerValuation"];
    const complete = members.filter((r) => coreMetrics.every((m) => r.metrics[m] != null)).length;
    console.log(`  ${ind} (n=${members.length})`);
    console.log(`     core-complete peers: ${complete} → mode: ${modeForCount(complete)}`);
    console.log(`     per-metric: ${line.join("  ")}`);
  }

  // A couple of end-to-end sample scores against the real distribution.
  console.log("\n=== Sample end-to-end scores (agent-1 config) ===");
  const bigIndustry = Object.entries(byIndustry).sort((a, b) => b[1].length - a[1].length)[0];
  if (bigIndustry && bigIndustry[1].length >= 3) {
    const [ind, members] = bigIndustry;
    const dist = buildIndustryDistributions(members.map((r) => ({ ticker: r.ticker, industry: ind, metrics: r.metrics })), METRIC_IDS)[ind];
    for (const r of members.slice(0, 3)) {
      const res = scoreCategoriesPeerRelative(r.metrics, dist, AGENT_SCORING["agent-1"]);
      console.log(`  ${r.ticker.padEnd(6)} score=${res.total.toFixed(0).padStart(3)} basis=${res.basis} thinPeer=${res.thinPeerSet} (missing: ${res.missingMetrics.join(",") || "none"})`);
    }
  }
  console.log("");
}

main().catch((e) => { console.error("[peer-probe] failed:", e.message); process.exit(1); });
