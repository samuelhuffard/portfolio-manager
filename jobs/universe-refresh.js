import "dotenv/config";
import { fileURLToPath } from "node:url";
import { fetchUsListing, mergeCatalog, applyQuotes, dropJunk, selectEnrichmentBatch } from "../lib/universe.js";
import { fetchQuotes, fetchFundamentals } from "../lib/yahoo.js";
import { classifySubVertical } from "../lib/indicators.js";
import { getUniverseCatalog, setUniverseCatalog, setUniverseStatus, getPeerMetrics, setPeerMetrics, getPeerCoverageRequests } from "../lib/redis.js";
import { peerMetricsRow } from "../lib/mandate-metrics.js";
import { fetchCompanyFacts } from "../lib/edgar.js";
import { sendMessage as sendTelegram } from "../lib/telegram.js";
import { selectPeerCoverageRefreshTargets } from "../lib/peer-coverage.js";

const QUOTE_CHUNK_SIZE = 200;
const QUOTE_CHUNK_DELAY_MS = 400;
const ENRICH_PER_RUN = Math.max(1, Number(process.env.UNIVERSE_ENRICH_PER_RUN?.trim()) || 250);
// Mandate v2.1 Phase A/W2: when set, cache each enriched name's peer-scoring metric
// vector. Off by default; jobs/peer-distributions.js turns the accumulated vectors into
// industry distributions.
const PEER_METRICS_ENABLED = process.env.PEER_METRICS_ENABLED?.trim() === "1";
// Additionally fetch SEC EDGAR companyfacts per enriched name (the mandated primary
// fundamentals source). Separate flag: it adds one paced SEC call per name.
const PEER_METRICS_EDGAR = process.env.PEER_METRICS_EDGAR?.trim() === "1";

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
export async function runUniverseRefresh({ strictPeerMetrics = false } = {}) {
  try {
    const existing = (await getUniverseCatalog()) ?? {};
    const listing = await fetchUsListing();
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
      const quotes = await fetchQuotes(chunk); // logs + returns {} on failure — a missed chunk just stays unquoted
      applyQuotes(catalog, quotes);
      await sleep(QUOTE_CHUNK_DELAY_MS);
    }
    catalog = dropJunk(catalog);

    const coverageRequests = PEER_METRICS_ENABLED ? await getPeerCoverageRequests() : {};
    const existingPeer = PEER_METRICS_ENABLED ? await getPeerMetrics() : {};
    const priorityTickers = PEER_METRICS_ENABLED
      ? selectPeerCoverageRefreshTargets(catalog, coverageRequests, existingPeer).targets
      : [];
    const toEnrich = selectEnrichmentBatch(catalog, { perRun: ENRICH_PER_RUN, priorityTickers });
    let enriched = 0;
    const peerRows = {}; // ticker → peerMetricsRow, when PEER_METRICS_ENABLED
    for (const ticker of toEnrich) {
      const f = await fetchFundamentals(ticker);
      if (!f.error) {
        const entry = catalog[ticker];
        if (entry) {
          entry.s = f.sector ?? null;
          entry.i = f.industry ?? null;
          entry.v = classifySubVertical(f) ?? null;
          entry.ea = new Date().toISOString().slice(0, 10);
          enriched++;
          if (PEER_METRICS_ENABLED) {
            const companyfacts = PEER_METRICS_EDGAR ? await fetchCompanyFacts(ticker) : null;
            peerRows[ticker] = peerMetricsRow(f, companyfacts);
          }
        }
      }
      await sleep(250);
    }

    await setUniverseCatalog(catalog);

    // Merge this run's peer-metric vectors into the accumulating store. Isolated:
    // a peer-metrics failure is logged but never fails the catalog refresh.
    if (PEER_METRICS_ENABLED && Object.keys(peerRows).length) {
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
    const total = Object.keys(catalog).length;
    const sectorEnriched = Object.values(catalog).filter((e) => e.ea).length;
    const status = {
      state: "ok",
      listed: listing.length,
      cataloged: total,
      sectorEnriched,
      enrichedThisRun: enriched,
      error: null,
    };
    await setUniverseStatus(status);
    console.log(
      `[Universe] Refresh done: ${total} cataloged, ${sectorEnriched} sector-enriched (${Math.round((sectorEnriched / total) * 100)}%), +${enriched} tonight${priorityTickers.length ? `, ${priorityTickers.length} coverage-priority ticker(s)` : ""}.`
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
