import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runUniverseRefresh } from "../jobs/universe-refresh.js";

/**
 * Incident guard, 2026-09-21.
 *
 * `runUniverseRefresh` had injection seams for every network dependency but NOT
 * for its Redis catalog store, which it imported and called directly. A unit
 * test that stubbed the listing, quotes, fundamentals and consensus therefore
 * still read the LIVE catalog and, at the end of the run, WROTE the fixture over
 * it — whenever the process happened to have a populated .env.
 *
 * That is exactly what happened: a 1,200-name fixture listing replaced the real
 * 4,487-name production catalog and reset sectorEnriched from 405 to 2. The
 * damage was bounded only by luck — Redis stores the catalog in 1,000-entry
 * chunks, so the 1,200-row fixture overwrote chunks 0 and 1 and left chunks 2-4
 * intact, which is what made recovery possible.
 *
 * These tests assert the seams exist and that a run with stores injected touches
 * nothing else. They are cheap; the failure they prevent is not.
 */

const listing = Array.from({ length: 1200 }, (_, i) => ({ ticker: `T${i}`, name: `N${i}`, exchange: "NASDAQ" }));

const args = (overrides = {}) => ({
  env: { UNIVERSE_ENRICH_PER_RUN: "2" },
  getListing: async () => listing,
  getQuotes: async (chunk) => Object.fromEntries(chunk.map((t) => [t, { regularMarketPrice: 10, marketCap: 1e9 }])),
  getFundamentals: async (ticker) => ({ ticker, sector: "Tech", industry: "Software", raw: {} }),
  getFirstTradeDate: async () => null,
  getCompanyFacts: async () => null,
  getConsensusTrend: async () => null,
  consensusStore: () => false,
  now: () => new Date("2026-08-14T12:00:00.000Z"),
  ...overrides,
});

test("the catalog store is injectable, so a test never reaches the live catalog", async () => {
  let read = 0;
  const writes = [];
  const statuses = [];
  const status = await runUniverseRefresh(args({
    readCatalog: async () => { read++; return {}; },
    writeCatalog: async (catalog) => { writes.push(Object.keys(catalog).length); },
    writeStatus: async (s) => { statuses.push(s); },
  }));
  assert.equal(read, 1, "the injected reader was used, not the module-level Redis import");
  assert.equal(writes.length, 1, "the injected writer received the catalog");
  assert.equal(statuses.length, 1);
  assert.equal(status.state, "ok");
  assert.equal(statuses[0].cataloged, status.cataloged);
});

test("an injected run starting from an empty catalog cannot report pre-existing coverage", async () => {
  // The incident's tell: `cataloged` collapsed to the fixture size. Pin that a
  // run seeded with {} reports exactly the fixture, so a future reader can tell
  // a fixture-sized catalog from a real one.
  const status = await runUniverseRefresh(args({
    readCatalog: async () => ({}),
    writeCatalog: async () => {},
    writeStatus: async () => {},
  }));
  assert.equal(status.cataloged, 1200, "fixture-sized, which is precisely why this must never reach production");
  assert.ok(status.sectorEnriched <= 2, "bounded by UNIVERSE_ENRICH_PER_RUN");
});

test("every Redis-backed dependency in the job has a seam", () => {
  const source = readFileSync(new URL("../jobs/universe-refresh.js", import.meta.url), "utf8");
  const signature = source.slice(source.indexOf("export async function runUniverseRefresh"), source.indexOf("} = {}) {"));
  for (const seam of ["readCatalog", "writeCatalog", "writeStatus", "readPeerMetrics", "writePeerMetrics", "readCoverageRequests"]) {
    assert.match(signature, new RegExp(`\\b${seam}\\s*=`), `${seam} must be an injectable parameter`);
  }
  // The body must go through the seams, never the raw imports.
  const body = source.slice(source.indexOf("} = {}) {"));
  for (const direct of ["getUniverseCatalog()", "setUniverseCatalog(", "setUniverseStatus(", "getPeerMetrics()", "setPeerMetrics(", "getPeerCoverageRequests()"]) {
    assert.ok(!body.includes(direct), `job body must not call ${direct} directly — use the seam`);
  }
});
