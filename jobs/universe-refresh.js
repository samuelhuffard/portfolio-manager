import "dotenv/config";
import { fileURLToPath } from "node:url";
import { fetchUsListing, mergeCatalog, applyQuotes, dropJunk, selectEnrichmentBatch } from "../lib/universe.js";
import { fetchQuotes, fetchFundamentals, fetchConsensusTrend } from "../lib/yahoo.js";
import { classifySubVertical } from "../lib/indicators.js";
import { getUniverseCatalog, setUniverseCatalog, setUniverseStatus, getPeerMetrics, setPeerMetrics, getPeerCoverageRequests } from "../lib/redis.js";
import { peerMetricsRow } from "../lib/mandate-metrics.js";
import { fetchCompanyFacts } from "../lib/edgar.js";
import { sendMessage as sendTelegram } from "../lib/telegram.js";
import { selectPeerCoverageRefreshTargets } from "../lib/peer-coverage.js";
import { consensusSnapshotRow } from "../lib/consensus-snapshot.js";
import { consensusStoreConfigured, writeConsensusSnapshots } from "../lib/pg/consensus-snapshots.js";

const QUOTE_CHUNK_SIZE = 200;
const QUOTE_CHUNK_DELAY_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Nightly universe refresh (scheduler.js, weeknights 7:30pm ET — off the 5:15pm
 * scan path). Maintains the Redis catalog the candidate slate draws from:
 *   1. Refresh the full NYSE/NASDAQ common-stock listing (adds IPOs, drops delistings).
 *   2. Bulk-quote the whole universe in chunks — cheap marketCap/ADDV/momentum
 *      signals for pre-ranking, ~30 quote calls total.
 *   3. Sector-enrich UNIVERSE_ENRICH_PER_RUN names/night via paced quoteSummary
 *      calls (never-enriched largest first, then stalest) — full classification
 *      converges over a few weeks and stays fresh thereafter.
 *
 * Failure is loud (Telegram) but never blocks research: the scan keeps using
 * the last good catalog, or falls back to the agent's seed watchlist.
 */
export async function runUniverseRefresh({
  strictPeerMetrics = false,
  getConsensusTrend = fetchConsensusTrend,
  saveConsensusSnapshots = writeConsensusSnapshots,
  consensusStore = consensusStoreConfigured,
  pool,
  now = () => new Date(),
  // Collaborator seams, matching jobs/peer-coverage-refresh.js. Flags are read
  // from an injected env rather than the module-level constants so a test can
  // exercise the enrichment path without the whole job being live-network-only —
  // an uncovered nightly collection branch is exactly the kind that silently
  // stops running.
  env = process.env,
  getListing = fetchUsListing,
  getQuotes = fetchQuotes,
  getFundamentals = fetchFundamentals,
  getCompanyFacts = fetchCompanyFacts,
} = {}) {
  // Mandate v2.1 Phase A/W2: cache each enriched name's peer-scoring metric vector
  // (off by default). PEER_METRICS_EDGAR additionally fetches SEC companyfacts per
  // name — a separate flag because it adds one paced SEC call each.
  const peerMetricsEnabled = env.PEER_METRICS_ENABLED?.trim() === "1";
  const peerMetricsEdgar = env.PEER_METRICS_EDGAR?.trim() === "1";
  const enrichPerRun = Math.max(1, Number(env.UNIVERSE_ENRICH_PER_RUN?.trim()) || 250);
  try {
    const existing = (await getUniverseCatalog()) ?? {};
    const listing = await getListing();
    if (listing.length < 1000) {
      // A plausible full US listing is thousands of names — a tiny result means a
      // truncated/format-changed source file. Keep the existing catalog instead.
      throw new Error(`Listing suspiciously small (${listing.length} names) — keeping existing catalog.`);
    }
    let catalog = mergeCatalog(existing, listing);
    console.log(`[Universe] Listing refreshed: ${listing.length} common stocks (${Object.keys(existing).length} previously cataloged).`);

    const allTickers = Object.keys(catalog);
    for (let i = 0; i < allTickers.length; i += QUOTE_CHUNK_SIZE) {
      const chunk = allTickers.slice(i, i + QUOTE_CHUNK_SIZE);
      const quotes = await getQuotes(chunk); // logs + returns {} on failure — a missed chunk just stays unquoted
      applyQuotes(catalog, quotes);
      await sleep(QUOTE_CHUNK_DELAY_MS);
    }
    catalog = dropJunk(catalog);

    const coverageRequests = peerMetricsEnabled ? await getPeerCoverageRequests() : {};
    const existingPeer = peerMetricsEnabled ? await getPeerMetrics() : {};
    const priorityTickers = peerMetricsEnabled
      ? selectPeerCoverageRefreshTargets(catalog, coverageRequests, existingPeer).targets
      : [];
    const toEnrich = selectEnrichmentBatch(catalog, { perRun: enrichPerRun, priorityTickers });
    let enriched = 0;
    const peerRows = {}; // ticker → peerMetricsRow, when peerMetricsEnabled
    // Consensus history is only worth collecting if it has somewhere durable to
    // land; without the store the observations would be discarded silently, and a
    // missed night cannot be backfilled.
    const collectConsensus = peerMetricsEnabled && consensusStore({ pool });
    const consensusRows = [];
    let consensusFailed = 0;
    if (peerMetricsEnabled && !collectConsensus) {
      console.warn("[Universe] durable consensus store not configured — consensus history is NOT accumulating.");
    }
    for (const ticker of toEnrich) {
      const f = await getFundamentals(ticker);
      if (!f.error) {
        const entry = catalog[ticker];
        if (entry) {
          entry.s = f.sector ?? null;
          entry.i = f.industry ?? null;
          entry.v = classifySubVertical(f) ?? null;
          entry.ea = new Date().toISOString().slice(0, 10);
          enriched++;
          if (peerMetricsEnabled) {
            const companyfacts = peerMetricsEdgar ? await getCompanyFacts(ticker) : null;
            peerRows[ticker] = peerMetricsRow(f, companyfacts);
            // Consensus accumulates for the SAME names that get a peer row here.
            // jobs/peer-coverage-refresh.js only walks requested cohorts, so
            // without this the broad universe would carry peer metrics with no
            // consensus history behind them — revBeat and estimateRevisions would
            // stay permanently missing for every name nobody happened to request.
            // One extra paced call per enriched name, on the same bounded nightly
            // batch that already makes a fundamentals and an EDGAR call each.
            if (collectConsensus) {
              try {
                const trend = await getConsensusTrend(ticker);
                const row = trend ? consensusSnapshotRow({ ...trend, ticker }, { now }) : null;
                if (row) consensusRows.push(row);
              } catch (consensusErr) {
                consensusFailed++;
                console.warn(`[Universe] ${ticker} consensus unavailable: ${consensusErr.message}`);
              }
            }
          }
        }
      }
      await sleep(250);
    }

    await setUniverseCatalog(catalog);

    // Merge this run's peer-metric vectors into the accumulating store. Isolated:
    // a peer-metrics failure is logged but never fails the catalog refresh.
    if (peerMetricsEnabled && Object.keys(peerRows).length) {
      try {
        await setPeerMetrics({ ...existingPeer, ...peerRows });
        console.log(`[Universe] Peer metrics: cached ${Object.keys(peerRows).length} vectors this run.`);
      } catch (peerErr) {
        console.error("[Universe] Peer-metrics cache failed (catalog refresh unaffected):", peerErr.message);
        // The legacy/direct refresh remains best-effort, but the orchestrated
        // research-data workflow cannot safely build distributions from an
        // unknowably stale cohort after a current-run persistence failure.
        if (strictPeerMetrics) throw peerErr;
      }
    }
    // Written once at the end: these are append-only observations keyed by
    // retrieval instant, so a partial run loses only the names it never reached
    // and duplicate instants are ignored by the store. A write failure is loud
    // but must not fail the catalog refresh, which research depends on.
    let consensusStored = 0;
    if (consensusRows.length) {
      try {
        ({ inserted: consensusStored } = await saveConsensusSnapshots(consensusRows, { pool }));
      } catch (consensusErr) {
        console.error(`[Universe] consensus snapshot write FAILED (${consensusRows.length} observations lost): ${consensusErr.message}`);
      }
    }

    const total = Object.keys(catalog).length;
    const sectorEnriched = Object.values(catalog).filter((e) => e.ea).length;
    const status = {
      state: "ok",
      listed: listing.length,
      cataloged: total,
      sectorEnriched,
      enrichedThisRun: enriched,
      consensusObserved: consensusRows.length,
      consensusStored,
      consensusFailed,
      error: null,
    };
    await setUniverseStatus(status);
    console.log(
      `[Universe] Refresh done: ${total} cataloged, ${sectorEnriched} sector-enriched (${Math.round((sectorEnriched / total) * 100)}%), +${enriched} tonight${priorityTickers.length ? `, ${priorityTickers.length} coverage-priority ticker(s)` : ""}${collectConsensus ? `, consensus stored ${consensusStored}/${consensusRows.length}` : ""}.`
    );
    return status;
  } catch (err) {
    console.error("[Universe] Refresh failed:", err.message);
    await setUniverseStatus({ state: "error", error: err.message });
    try {
      await sendTelegram(`⚠️ Universe refresh failed: ${err.message} — research scans will use the last good catalog (or seed watchlists).`);
    } catch (tgErr) {
      console.error("[Universe] Telegram alert failed:", tgErr.message);
    }
    throw err;
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runUniverseRefresh().catch(() => process.exit(1));
}
