import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProposalEvidence, parseRecommendation, promptBreakdown, promptNumber, validateActionableEvidence } from "../lib/ai-overlay.js";

test("promptNumber never emits NaN or Infinity into prompts", () => {
  assert.equal(promptNumber(72.345), 72.34);
  assert.equal(promptNumber(NaN), "unknown");
  assert.equal(promptNumber(Infinity), "unknown");
  assert.equal(promptNumber(null), "unknown");
});

test("promptBreakdown serializes non-finite metric values as null", () => {
  const breakdown = promptBreakdown({
    revenueGrowth: 82.34,
    profitMargins: NaN,
    freeCashflow: Infinity,
    rsi: null,
  });
  assert.deepEqual(breakdown, {
    revenueGrowth: 82.3,
    profitMargins: null,
    freeCashflow: null,
    rsi: null,
  });
  assert.doesNotMatch(JSON.stringify(breakdown), /NaN|Infinity/);
});

test("proposal evidence ledger labels scores as ranks and preserves typed raw facts", () => {
  const packet = buildProposalEvidence({
    quantScore: 81.2,
    breakdown: { trailingPE: 94.6, rsi: 60 },
    factEvidence: [{ id: "raw_trailing_pe", kind: "raw_fact", label: "Trailing P/E", value: 22.4, unit: "x", source: "Yahoo Finance" }],
  });
  assert.deepEqual(packet.find((entry) => entry.id === "rank_trailingPE"), {
    id: "rank_trailingPE", kind: "normalized_rank", label: "trailingPE score", value: 94.6, unit: "rank_0_to_100", source: "internal cross-sectional scoring",
  });
  assert.equal(packet.find((entry) => entry.id === "raw_trailing_pe").value, 22.4);
  assert.equal(packet.find((entry) => entry.id === "raw_trailing_pe").kind, "raw_fact");
});

test("context-only news remains outside the actionable evidence ledger", () => {
  const packet = buildProposalEvidence({
    quantScore: 81.2,
    breakdown: {},
    news: [
      { title: "promotional", url: "https://example.test/promo", thesisSupport: false },
      { title: "reported result", url: "https://example.test/report", thesisSupport: true },
    ],
  });
  assert.equal(packet.some((entry) => entry.id === "news_1"), false);
  assert.equal(packet.some((entry) => entry.id === "news_2"), true);
});

test("actionable thesis fails closed when an exact sentence lacks an evidence citation", () => {
  const check = validateActionableEvidence({
    action: "BUY",
    thesis: "The quant rank is strong. The company trades at 12x earnings.",
    evidenceCitations: [{ claim: "The quant rank is strong.", evidence_ids: ["quant_score_rank"] }],
    evidenceIds: new Set(["quant_score_rank"]),
    claimedBusinessFamily: "technology",
  });
  assert.equal(check.valid, false);
  assert.match(check.issues.join(" "), /no exact evidence citation/);
});

test("parseRecommendation downgrades an actionable response with invented citation IDs to HOLD", () => {
  const rec = parseRecommendation(JSON.stringify({
    action: "BUY", target_weight_pct: 5, thesis: "The company trades at 12x earnings.", risks: ["Risk."], kill_criteria: ["Kill."], confidence: 0.8, claimed_business_family: "technology",
    evidence_citations: [{ claim: "The company trades at 12x earnings.", evidence_ids: ["invented_pe"] }], suspect_evidence: [],
  }), "TEST", new Set(["quant_score_rank"]));
  assert.equal(rec.action, "HOLD");
  assert.equal(rec.targetWeight, 0);
  assert.equal(rec.evidenceValidation.valid, false);
});

test("parseRecommendation retains an actionable response only when every thesis sentence is cited", () => {
  const thesis = "The normalized quant rank is strong.";
  const rec = parseRecommendation(JSON.stringify({
    action: "BUY", target_weight_pct: 5, thesis, risks: ["Risk."], kill_criteria: ["Kill."], confidence: 0.8, claimed_business_family: "technology",
    evidence_citations: [{ claim: thesis, evidence_ids: ["quant_score_rank"] }], suspect_evidence: [],
  }), "TEST", new Set(["quant_score_rank"]));
  assert.equal(rec.action, "BUY");
  assert.equal(rec.evidenceValidation.valid, true);
  assert.equal(rec.claimedBusinessFamily, "technology");
});

test("BUY/SELL fail closed without a valid claimed business family", () => {
  const thesis = "The normalized quant rank is strong.";
  const rec = parseRecommendation(JSON.stringify({
    action: "BUY", target_weight_pct: 5, thesis, risks: ["Risk."], kill_criteria: ["Kill."], confidence: 0.8,
    evidence_citations: [{ claim: thesis, evidence_ids: ["quant_score_rank"] }], suspect_evidence: [],
  }), "TEST", new Set(["quant_score_rank"]));
  assert.equal(rec.action, "HOLD");
  assert.match(rec.evidenceValidation.issues.join(" "), /claimed_business_family/);
});
