import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSlate, formatSlateCounts, rankScreenedCandidates } from "../lib/candidate-slate.js";

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

test("attributed holdings remain protected beyond the nominal discovery slate size", () => {
  const holdings = Array.from({ length: 22 }, (_, index) => `H${index}`);
  const { slate, counts } = buildSlate({
    screened: [],
    holdings,
    config: { slateSize: 20, explorationSlots: 3 },
    now: NOW,
  });
  assert.equal(slate.length, 22);
  assert.equal(counts.holdings, 22);
  assert.equal(slate.every((item) => item.bucket === "holdings"), true);
});

test("formatSlateCounts renders the log summary", () => {
  assert.equal(
    formatSlateCounts({ holdings: 4, movers: 3, ranked: 10, exploration: 3 }),
    "4 holdings + 3 movers + 10 ranked + 3 exploration"
  );
});

test("mandate attention policies rank the same eligible facts differently without changing them", () => {
  const facts = [
    { ticker: "FAST", marketCap: 2e9, avgDollarVolume: 20e6, fiftyTwoWeekChangePct: 80 },
    { ticker: "GIANT", marketCap: 500e9, avgDollarVolume: 500e6, fiftyTwoWeekChangePct: 20 },
    { ticker: "MID", marketCap: 10e9, avgDollarVolume: 100e6, fiftyTwoWeekChangePct: 40 },
  ];
  assert.deepEqual(rankScreenedCandidates(facts, { agentId: "agent-2" }).map((row) => row.ticker), ["FAST", "MID", "GIANT"]);
  assert.deepEqual(rankScreenedCandidates(facts, { agentId: "agent-3" }).map((row) => row.ticker), ["GIANT", "MID", "FAST"]);
  assert.deepEqual(facts.map((row) => row.ticker), ["FAST", "GIANT", "MID"]);
});

test("each mandate attention comparator sorts strongest supported facts first and missing facts last", () => {
  const facts = [
    { ticker: "LOW", marketCap: 1e9, avgDollarVolume: 20e6, fiftyTwoWeekChangePct: 10 },
    { ticker: "HIGH", marketCap: 20e9, avgDollarVolume: 200e6, fiftyTwoWeekChangePct: 90 },
    { ticker: "MISS", marketCap: null, avgDollarVolume: null, fiftyTwoWeekChangePct: null },
  ];
  assert.deepEqual(
    rankScreenedCandidates(facts, { agentId: "agent-1" }).map((row) => row.ticker),
    ["HIGH", "LOW", "MISS"]
  );
  assert.deepEqual(
    rankScreenedCandidates(facts, { agentId: "agent-2" }).map((row) => row.ticker),
    ["HIGH", "LOW", "MISS"]
  );
  assert.deepEqual(
    rankScreenedCandidates(facts, { agentId: "agent-3" }).map((row) => row.ticker),
    ["HIGH", "LOW", "MISS"]
  );
});

test("all three agents get the same holding, mover, cooldown, and rotating exploration mechanics", () => {
  const screened = Array.from({ length: 8 }, (_, index) => ({
    ticker: `N${index}`,
    marketCap: (index + 1) * 1e9,
    avgDollarVolume: (index + 1) * 10e6,
    fiftyTwoWeekChangePct: index * 10,
  }));
  for (const agentId of ["agent-1", "agent-2", "agent-3"]) {
    const dayOne = buildSlate({
      screened,
      holdings: ["HELD"],
      scanTickers: ["EVENT"],
      ledger: { N0: { lastResearchedAt: "2026-07-04T00:00:00.000Z" } },
      config: { agentId, slateSize: 6, explorationSlots: 2, researchCooldownDays: 14 },
      now: NOW,
    });
    const dayTwo = buildSlate({
      screened,
      holdings: ["HELD"],
      scanTickers: ["EVENT"],
      ledger: { N0: { lastResearchedAt: "2026-07-04T00:00:00.000Z" } },
      config: { agentId, slateSize: 6, explorationSlots: 2, researchCooldownDays: 14 },
      now: new Date(NOW.getTime() + 24 * 3600 * 1000),
    });
    assert.deepEqual(dayOne.slate.slice(0, 2), [
      { ticker: "HELD", bucket: "holdings" },
      { ticker: "EVENT", bucket: "movers" },
    ]);
    assert.equal(dayOne.counts.exploration, 2);
    assert.equal(dayTwo.counts.exploration, 2);
    assert.ok(!dayOne.slate.some((item) => item.ticker === "N0" && item.bucket === "ranked"));
    assert.notDeepEqual(
      dayOne.slate.filter((item) => item.bucket === "exploration"),
      dayTwo.slate.filter((item) => item.bucket === "exploration")
    );
  }
});
