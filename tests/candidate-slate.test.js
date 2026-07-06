import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSlate, formatSlateCounts } from "../lib/candidate-slate.js";

const NOW = new Date("2026-07-05T21:15:00.000Z");

function screenedName(ticker, { marketCap = 5e9, mom = 10 } = {}) {
  return { ticker, marketCap, fiftyTwoWeekChangePct: mom };
}

test("holdings and movers always make the slate, before ranked names", () => {
  const { slate, counts } = buildSlate({
    screened: [screenedName("RNK1", { mom: 99 })],
    holdings: ["HELD"],
    scanTickers: ["MOVR"],
    ledger: {},
    config: { slateSize: 10, explorationSlots: 0 },
    now: NOW,
  });
  assert.deepEqual(slate.slice(0, 2).map((s) => s.ticker), ["HELD", "MOVR"]);
  assert.equal(counts.holdings, 1);
  assert.equal(counts.movers, 1);
  assert.equal(counts.ranked, 1);
});

test("ranked bucket prefers the small/mid-cap band, then momentum", () => {
  const { slate } = buildSlate({
    screened: [
      screenedName("MEGA", { marketCap: 3e12, mom: 80 }),
      screenedName("MIDA", { marketCap: 5e9, mom: 20 }),
      screenedName("MIDB", { marketCap: 5e9, mom: 60 }),
    ],
    holdings: [],
    scanTickers: [],
    ledger: {},
    config: { slateSize: 10, explorationSlots: 0 },
    now: NOW,
  });
  assert.deepEqual(slate.map((s) => s.ticker), ["MIDB", "MIDA", "MEGA"]);
});

test("research cooldown suppresses recently-reviewed names from ranked, but never holdings", () => {
  const ledger = {
    COOL: { lastResearchedAt: "2026-07-01T00:00:00.000Z" }, // 4 days ago < 14d cooldown
    HELD: { lastResearchedAt: "2026-07-04T00:00:00.000Z" },
    OLDN: { lastResearchedAt: "2026-05-01T00:00:00.000Z" }, // past cooldown
  };
  const { slate } = buildSlate({
    screened: [screenedName("COOL"), screenedName("OLDN")],
    holdings: ["HELD"],
    scanTickers: [],
    ledger,
    config: { slateSize: 10, researchCooldownDays: 14, explorationSlots: 0 },
    now: NOW,
  });
  const tickers = slate.map((s) => s.ticker);
  assert.ok(tickers.includes("HELD"));
  assert.ok(tickers.includes("OLDN"));
  assert.ok(!tickers.includes("COOL"));
});

test("exploration slots are reserved for never-researched names even when ranked would fill the slate", () => {
  const screened = Array.from({ length: 30 }, (_, i) => screenedName(`RK${String(i).padStart(2, "0")}`, { mom: 100 - i }));
  const ledger = {};
  for (let i = 10; i < 30; i++) ledger[`RK${i}`] = { lastResearchedAt: "2026-05-01T00:00:00.000Z" }; // researched long ago
  const { slate, counts } = buildSlate({
    screened,
    holdings: [],
    scanTickers: [],
    ledger,
    config: { slateSize: 8, explorationSlots: 3, researchCooldownDays: 14 },
    now: NOW,
  });
  assert.equal(slate.length, 8);
  assert.equal(counts.exploration, 3);
  for (const s of slate.filter((x) => x.bucket === "exploration")) {
    assert.equal(ledger[s.ticker], undefined); // exploration picks were never researched
  }
});

test("exploration rotation is deterministic for a given day and shifts on the next day", () => {
  const screened = Array.from({ length: 10 }, (_, i) => screenedName(`EX${i}`));
  const args = { screened, holdings: [], scanTickers: [], ledger: {}, config: { slateSize: 3, explorationSlots: 3 } };
  const dayOne = buildSlate({ ...args, now: NOW });
  const dayOneAgain = buildSlate({ ...args, now: NOW });
  const dayTwo = buildSlate({ ...args, now: new Date(NOW.getTime() + 24 * 3600 * 1000) });
  assert.deepEqual(dayOne.slate, dayOneAgain.slate);
  assert.notDeepEqual(dayOne.slate, dayTwo.slate);
});

test("slate size caps total picks and duplicate tickers collapse", () => {
  const { slate } = buildSlate({
    screened: [screenedName("HELD"), screenedName("A"), screenedName("B")],
    holdings: ["HELD"],
    scanTickers: ["HELD", "A"],
    ledger: {},
    config: { slateSize: 2, explorationSlots: 0 },
    now: NOW,
  });
  assert.equal(slate.length, 2);
  assert.deepEqual(slate.map((s) => s.ticker), ["HELD", "A"]);
});

test("formatSlateCounts renders the log summary", () => {
  assert.equal(
    formatSlateCounts({ holdings: 4, movers: 3, ranked: 10, exploration: 3 }),
    "4 holdings + 3 movers + 10 ranked + 3 exploration"
  );
});
