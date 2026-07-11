import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyEvaluatorHealth, computeWeeklyScorecard, formatScorecardForPrompt, parseWeeklyLessons } from "../lib/weekly-scorecard.js";
import { mergeWeeklyLessons } from "../lib/agent-memory.js";

const NOW = Date.parse("2026-07-03T22:30:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

function proposal(overrides = {}) {
  return {
    agentId: "agent-1",
    side: "BUY",
    status: "Pending",
    createdAt: daysAgo(2),
    fulfilledAt: null,
    ...overrides,
  };
}

test("counts this week's proposals by status and side, ignoring other agents and older weeks", () => {
  const proposals = [
    proposal({ status: "ApprovedForBrokerReview", fulfilledAt: daysAgo(1) }),
    proposal({ status: "Rejected", side: "SELL" }),
    proposal({ status: "Expired" }),
    proposal(),
    proposal({ agentId: "agent-2" }), // other agent
    proposal({ createdAt: daysAgo(10) }), // older than a week
  ];
  const sc = computeWeeklyScorecard({ agentId: "agent-1", proposals, outcomes: [], now: NOW });
  assert.equal(sc.proposalStats.created, 4);
  assert.equal(sc.proposalStats.accepted, 1);
  assert.equal(sc.proposalStats.rejected, 1);
  assert.equal(sc.proposalStats.expired, 1);
  assert.equal(sc.proposalStats.pending, 1);
  assert.equal(sc.proposalStats.fulfilled, 1);
  assert.equal(sc.proposalStats.buys, 3);
  assert.equal(sc.proposalStats.sells, 1);
});

test("computes week activity from ruleCheck strings and track record from matured horizons", () => {
  const outcomes = [
    { date: daysAgo(1).slice(0, 10), action: "BUY", ruleCheck: "evaluator: APPROVE", hit30: "", confidence: 0.7 },
    { date: daysAgo(2).slice(0, 10), action: "HOLD", ruleCheck: "evaluator_reject: weak bear case", hit30: "" },
    { date: daysAgo(3).slice(0, 10), action: "HOLD", ruleCheck: "data_gate_blocked: stale bars", hit30: "" },
    // Matured 30d outcomes from past months:
    { date: daysAgo(40).slice(0, 10), action: "BUY", ruleCheck: "OK", hit30: "✅", return30: 8, alpha30: 3, confidence: 0.8 },
    { date: daysAgo(45).slice(0, 10), action: "BUY", ruleCheck: "OK", hit30: "❌", return30: -4, alpha30: -6, confidence: 0.6 },
  ];
  const sc = computeWeeklyScorecard({ agentId: "agent-1", proposals: [], outcomes, now: NOW });
  assert.equal(sc.weekActivity.scanned, 3);
  assert.equal(sc.weekActivity.actionable, 1);
  assert.equal(sc.weekActivity.dataGateBlocked, 1);
  assert.equal(sc.weekActivity.evaluatorRejected, 1);
  assert.equal(sc.weekActivity.evaluatorApproved, 1);
  assert.equal(sc.evaluatorHealth.status, "insufficient_sample");
  assert.equal(sc.trackRecord[30].matured, 2);
  assert.equal(sc.trackRecord[30].hitRate, 50);
  assert.equal(sc.trackRecord[30].avgReturnPct, 2);
  assert.equal(sc.trackRecord[90].matured, 0);
  // Calibration: two matured non-HOLD calls with confidence.
  assert.equal(sc.calibration.calls, 2);
  assert.equal(sc.calibration.avgStatedConfidence, 0.7);
  assert.equal(sc.calibration.realizedHitRate, 50);
});

test("formatScorecardForPrompt renders the load-bearing numbers", () => {
  const sc = computeWeeklyScorecard({ agentId: "agent-1", proposals: [proposal()], outcomes: [], now: NOW });
  const text = formatScorecardForPrompt(sc);
  assert.ok(text.includes("agent-1"));
  assert.ok(text.includes("1 created"));
  assert.ok(text.includes("Evaluator health"));
});

test("classifyEvaluatorHealth flags healthy and out-of-band evaluator mixes", () => {
  assert.equal(
    classifyEvaluatorHealth({ evaluatorApproved: 2, evaluatorRejected: 2 }).status,
    "healthy"
  );
  const strict = classifyEvaluatorHealth({ evaluatorApproved: 0, evaluatorRejected: 4 });
  assert.equal(strict.status, "too_strict");
  assert.equal(strict.approvalRatePct, 0);
  const permissive = classifyEvaluatorHealth({ evaluatorApproved: 5, evaluatorRejected: 0 });
  assert.equal(permissive.status, "too_permissive");
  assert.equal(permissive.approvalRatePct, 100);
});

test("classifyEvaluatorHealth escalates the same out-of-band condition two weeks in a row", () => {
  const previous = classifyEvaluatorHealth({ evaluatorApproved: 0, evaluatorRejected: 4 });
  const current = classifyEvaluatorHealth({ evaluatorApproved: 0, evaluatorRejected: 3 }, previous);
  assert.equal(current.status, "critical");
  assert.equal(current.band, "too_strict");
  assert.equal(current.consecutiveOutOfBand, true);
});

test("parseWeeklyLessons caps at 3 lessons and fails closed on garbage", () => {
  const ok = parseWeeklyLessons(JSON.stringify({ lessons: ["a", "b", "c", "d"], retire: ["old"] }));
  assert.deepEqual(ok.lessons, ["a", "b", "c"]);
  assert.deepEqual(ok.retire, ["old"]);
  const bad = parseWeeklyLessons("no json here at all");
  assert.deepEqual(bad, { lessons: [], retire: [], parseError: true });
});

test("mergeWeeklyLessons retires only weekly_review memories and never touches Sam's", () => {
  const existing = [
    { id: "1", text: "Sam prefers concise theses", source: "chat", importance: 5, createdAt: daysAgo(30), updatedAt: daysAgo(30) },
    { id: "2", text: "Semis kill criteria trigger too late", source: "weekly_review", importance: 4, createdAt: daysAgo(14), updatedAt: daysAgo(14) },
  ];
  // Retiring a text that matches BOTH a chat memory and a weekly lesson only removes the weekly one.
  const merged = mergeWeeklyLessons(existing, { lessons: ["New lesson about sizing"], retire: ["Semis kill criteria trigger too late", "Sam prefers concise theses"] }, daysAgo(0));
  assert.ok(merged.find((m) => m.id === "1"), "chat memory must survive retire");
  assert.ok(!merged.find((m) => m.id === "2"), "weekly lesson should be retired");
  const added = merged.find((m) => m.text === "New lesson about sizing");
  assert.equal(added.source, "weekly_review");
  assert.equal(added.importance, 4);
});

test("mergeWeeklyLessons dedupes and caps weekly lessons by evicting the oldest weekly ones", () => {
  const existing = Array.from({ length: 6 }, (_, i) => ({
    id: `w${i}`,
    text: `weekly lesson ${i}`,
    source: "weekly_review",
    importance: 4,
    createdAt: daysAgo(60 - i),
    updatedAt: daysAgo(60 - i),
  }));
  existing.push({ id: "chat", text: "manual memory", source: "manual", importance: 3, createdAt: daysAgo(90), updatedAt: daysAgo(90) });

  const merged = mergeWeeklyLessons(existing, { lessons: ["weekly lesson 5", "brand new lesson"], retire: [] }, daysAgo(0));
  // "weekly lesson 5" already exists → deduped; "brand new lesson" added → 7 weekly → oldest evicted.
  const weekly = merged.filter((m) => m.source === "weekly_review");
  assert.equal(weekly.length, 6);
  assert.ok(!weekly.find((m) => m.id === "w0"), "oldest weekly lesson evicted");
  assert.ok(weekly.find((m) => m.text === "brand new lesson"));
  assert.ok(merged.find((m) => m.id === "chat"), "non-weekly memory untouched by the cap");
});
