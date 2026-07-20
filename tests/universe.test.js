import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseNasdaqListed,
  parseOtherListed,
  mergeCatalog,
  applyQuotes,
  dropJunk,
  selectEnrichmentBatch,
  toScreenerCandidates,
} from "../lib/universe.js";

const NASDAQ_FIXTURE = [
  "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
  "AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N",
  "ZTEST|Test Issue Co|Q|Y|N|100|N|N",
  "QQQ|Invesco QQQ Trust|G|N|N|100|Y|N",
  "ACMEW|Acme Corp - Warrant|Q|N|N|100|N|N",
  "SPAC|Future Acquisition Corp - Common Stock|Q|N|N|100|N|N",
  "BDC|Capital Business Development Company - Common Stock|Q|N|N|100|N|N",
  "DLNQ|Delinquent Corp - Common Stock|Q|N|D|100|N|N",
  "GOOD|Good Software Inc. - Common Stock|Q|N|N|100|N|N",
  "File Creation Time: 0705202519:30|||||||",
].join("\n");

const OTHER_FIXTURE = [
  "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol",
  "IBM|International Business Machines Corporation Common Stock|N|IBM|N|100|N|IBM",
  "SPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY",
  "ABC$B|Some Preferred Series B|N|ABC$B|N|100|N|ABC-B",
  "TSM|Taiwan Semiconductor Manufacturing Company Ltd. American Depositary Shares|N|TSM|N|100|N|TSM",
  "SMLL|Small Cap Industries Common Stock|A|SMLL|N|100|N|SMLL",
  "MLP|Pipeline Partners L.P. Common Units|N|MLP|N|100|N|MLP",
  "REIT|Durable Realty Trust Common Stock|N|REIT|N|100|N|REIT",
  "BATS|Bats Listed Co|Z|BATS|N|100|N|BATS",
  "File Creation Time: 0705202519:30|||||||",
].join("\n");

test("parseNasdaqListed keeps operating common stock, drops test issues, ETFs, warrants, SPACs, BDCs, delinquent", () => {
  const rows = parseNasdaqListed(NASDAQ_FIXTURE);
  assert.deepEqual(rows.map((r) => r.ticker).sort(), ["AAPL", "GOOD"]);
  assert.equal(rows[0].exchange, "NASDAQ");
});

test("parseOtherListed keeps NYSE/NYSE-American operating common stock and REITs, drops ETFs, preferreds, ADRs, MLPs, other venues", () => {
  const rows = parseOtherListed(OTHER_FIXTURE);
  assert.deepEqual(rows.map((r) => r.ticker).sort(), ["IBM", "REIT", "SMLL"]);
  assert.equal(rows.every((r) => r.exchange === "NYSE"), true);
});

test("mergeCatalog keeps enrichment for still-listed names, adds new, drops delisted", () => {
  const existing = {
    AAPL: { t: "AAPL", n: "Apple", x: "NASDAQ", s: "Technology", v: "Tech Hardware", ea: "2026-06-01", mc: 3e12 },
    GONE: { t: "GONE", n: "Delisted Co", x: "NYSE" },
  };
  const listing = [
    { ticker: "AAPL", name: "Apple Inc. - Common Stock", exchange: "NASDAQ" },
    { ticker: "NEWCO", name: "New Co", exchange: "NYSE" },
  ];
  const merged = mergeCatalog(existing, listing);
  assert.equal(merged.AAPL.ea, "2026-06-01"); // enrichment preserved
  assert.equal(merged.AAPL.mc, 3e12);
  assert.ok(merged.NEWCO);
  assert.equal(merged.GONE, undefined);
});

test("applyQuotes computes average daily DOLLAR volume from price × share volume", () => {
  const catalog = { GOOD: { t: "GOOD", n: "Good", x: "NASDAQ" } };
  applyQuotes(catalog, {
    GOOD: { regularMarketPrice: 10, averageDailyVolume3Month: 500_000, marketCap: 2_000_000_000, fiftyTwoWeekChangePercent: 42 },
  });
  assert.equal(catalog.GOOD.advd, 5_000_000);
  assert.equal(catalog.GOOD.mc, 2_000_000_000);
  assert.equal(catalog.GOOD.c52, 42);
  assert.ok(catalog.GOOD.qa);
});

test("dropJunk removes quoted tiny illiquid names but keeps unquoted ones", () => {
  const catalog = {
    JUNK: { t: "JUNK", qa: "2026-07-05", mc: 10_000_000, advd: 50_000 },
    SMOL: { t: "SMOL", qa: "2026-07-05", mc: 10_000_000, advd: 5_000_000 }, // illiquid floor passed
    UNKW: { t: "UNKW" }, // never quoted — not yet judged
  };
  const kept = dropJunk(catalog);
  assert.deepEqual(Object.keys(kept).sort(), ["SMOL", "UNKW"]);
});

test("selectEnrichmentBatch prioritizes never-enriched (largest first), then stalest", () => {
  const now = new Date("2026-07-05T00:00:00Z");
  const catalog = {
    BIGN: { t: "BIGN", mc: 100e9 }, // never enriched, big
    SMLN: { t: "SMLN", mc: 1e9 }, // never enriched, small
    STAL: { t: "STAL", mc: 50e9, ea: "2026-05-01" }, // stale (>30d)
    FRSH: { t: "FRSH", mc: 50e9, ea: "2026-07-01" }, // fresh
  };
  assert.deepEqual(selectEnrichmentBatch(catalog, { perRun: 3, now }), ["BIGN", "SMLN", "STAL"]);
});

test("toScreenerCandidates exposes one shared fact row per listing without requiring sector enrichment", () => {
  const catalog = {
    GOOD: { t: "GOOD", n: "Good", s: "Technology", i: "Software - Application", v: "Software/SaaS", mc: 2e9, advd: 5e6, p: 10, c52: 42, ea: "2026-07-01" },
    UNKW: { t: "UNKW", n: "Unknown" },
  };
  const candidates = toScreenerCandidates(catalog);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].ticker, "GOOD");
  assert.equal(candidates[0].subVertical, "Software/SaaS");
  assert.equal(candidates[0].avgDollarVolume, 5e6);
  assert.equal(candidates[0].fiftyTwoWeekChangePct, 42);
  assert.equal(candidates[1].ticker, "UNKW");
  assert.equal(candidates[1].marketCap, null);
});
