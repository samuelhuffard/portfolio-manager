import "dotenv/config";
import { fileURLToPath } from "node:url";
import { fetchUsListing, mergeCatalog, applyQuotes, dropJunk, selectEnrichmentBatch } from "../lib/universe.js";
import { fetchQuotes, fetchFundamentals } from "../lib/yahoo.js";
import { classifySubVertical } from "../lib/indicators.js";
import { getUniverseCatalog, setUniverseCatalog, setUniverseStatus } from "../lib/redis.js";
import { sendMessage as sendTelegram } from "../lib/telegram.js";

const QUOTE_CHUNK_SIZE = 200;
const QUOTE_CHUNK_DELAY_MS = 400;
const ENRICH_PER_RUN = Math.max(1, Number(process.env.UNIVERSE_ENRICH_PER_RUN?.trim()) || 250);

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
export async function runUniverseRefresh() {
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

    const toEnrich = selectEnrichmentBatch(catalog, { perRun: ENRICH_PER_RUN });
    let enriched = 0;
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
        }
      }
      await sleep(250);
    }

    await setUniverseCatalog(catalog);
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
      `[Universe] Refresh done: ${total} cataloged, ${sectorEnriched} sector-enriched (${Math.round((sectorEnriched / total) * 100)}%), +${enriched} tonight.`
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
