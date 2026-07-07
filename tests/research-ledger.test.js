import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeResearchRecords, formatResearchHistoryForPrompt, summarizeResearchLedger } from "../lib/research-ledger.js";

const NOW = "2026-07-05T21:15:00.000Z";

test("mergeResearchRecords adds new entries and increments timesResearched on repeats", () => {
  const first = mergeResearchRecords({}, [{ ticker: "GOOD", action: "BUY", quantScore: 80, confidence: 0.7, thesis: "Strong growth." }], NOW);
  assert.equal(first.GOOD.timesResearched, 1);
  assert.equal(first.GOOD.lastAction, "BUY");

  const second = mergeResearchRecords(first, [{ ticker: "GOOD", action: "HOLD", quantScore: 60, thesis: "Cooled off." }], "2026-07-08T21:15:00.000Z");
  assert.equal(second.GOOD.timesResearched, 2);
  assert.equal(second.GOOD.lastAction, "HOLD");
  assert.equal(second.GOOD.lastResearchedAt, "2026-07-08T21:15:00.000Z");
});

test("mergeResearchRecords truncates thesis snippets and skips blank tickers", () => {
  const merged = mergeResearchRecords({}, [
    { ticker: "GOOD", action: "HOLD", thesis: `x${"y".repeat(400)}` },
    { ticker: null, action: "BUY" },
  ], NOW);
  assert.equal(Object.keys(merged).length, 1);
  assert.equal(merged.GOOD.thesisSnippet.length, 200);
});

test("mergeResearchRecords evicts the oldest entries beyond the cap", () => {
  const existing = {};
  for (let i = 0; i < 500; i++) {
    const t = `T${String(i).padStart(3, "0")}`;
    existing[t] = { ticker: t, lastResearchedAt: `2026-01-01T00:${String(i % 60).padStart(2, "0")}:00.000Z`, timesResearched: 1 };
  }
  existing.T000.lastResearchedAt = "2025-01-01T00:00:00.000Z"; // clearly oldest
  const merged = mergeResearchRecords(existing, [{ ticker: "NEWT", action: "BUY" }], NOW);
  assert.equal(Object.keys(merged).length, 500);
  assert.equal(merged.T000, undefined);
  assert.ok(merged.NEWT);
});

test("formatResearchHistoryForPrompt summarizes prior research and handles first-timers", () => {
  assert.match(formatResearchHistoryForPrompt(null), /not researched/);
  const line = formatResearchHistoryForPrompt({
    lastResearchedAt: "2026-06-20T21:15:00.000Z",
    lastAction: "HOLD",
    lastQuantScore: 62,
    lastConfidence: 0.5,
    timesResearched: 3,
    thesisSnippet: "Wait for margin inflection.",
  });
  assert.match(line, /2026-06-20/);
  assert.match(line, /action HOLD/);
  assert.match(line, /quant 62\/100/);
  assert.match(line, /3 times/);
  assert.match(line, /margin inflection/);
});

test("summarizeResearchLedger counts total and trailing-window coverage", () => {
  const now = new Date("2026-07-07T12:00:00.000Z");
  const summary = summarizeResearchLedger(
    {
      FRESH: { ticker: "FRESH", lastResearchedAt: "2026-07-05T00:00:00.000Z" },
      WEEKOLD: { ticker: "WEEKOLD", lastResearchedAt: "2026-06-28T00:00:00.000Z" },
      STALE: { ticker: "STALE", lastResearchedAt: "2026-05-01T00:00:00.000Z" },
      BROKEN: { ticker: "BROKEN", lastResearchedAt: "not-a-date" },
    },
    now
  );
  assert.equal(summary.totalNames, 4);
  assert.equal(summary.researchedLast7d, 1);
  assert.equal(summary.researchedLast14d, 2);
});

test("summarizeResearchLedger handles an empty or missing ledger", () => {
  assert.deepEqual(summarizeResearchLedger({}), { totalNames: 0, researchedLast7d: 0, researchedLast14d: 0 });
  assert.deepEqual(summarizeResearchLedger(), { totalNames: 0, researchedLast7d: 0, researchedLast14d: 0 });
});
