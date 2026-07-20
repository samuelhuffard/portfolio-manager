import { test } from "node:test";
import assert from "node:assert/strict";
import { auditProposalQualityShadow, buildShadowThesisPacket, summarizeProposalQualityShadow } from "../lib/proposal-quality-shadow.js";

test("shadow packet excludes promotional context and counts supplied primary facts", () => {
  const packet = buildShadowThesisPacket({
    quantScore: 80,
    news: [{ title: "A once-in-a-lifetime buying opportunity", url: "https://example.test" }],
    primaryFacts: [{ id: "filing_revenue", label: "Revenue", value: 100, unit: "USD", source: "company filing" }],
  });
  assert.equal(packet.contextOnlyNews.length, 1);
  assert.equal(packet.primaryFactCount, 1);
  assert.equal(packet.evidence.some((entry) => entry.id === "news_1"), false);
});

test("shadow replay blocks a false business-family and rank-as-raw valuation claim", () => {
  const audit = auditProposalQualityShadow({
    agentId: "agent-1",
    candidate: { ticker: "DAVE", sector: "Financial Services", industry: "Banks - Regional" },
    proposal: {
      action: "BUY",
      thesis: "DAVE is a technology company trading at a 94.6 P/E.",
      claimedBusinessFamily: "technology",
      evidenceCitations: [{ claim: "DAVE is a technology company trading at a 94.6 P/E.", evidence_ids: ["rank_trailingPE"] }],
    },
    enriched: { breakdown: { trailingPE: 94.6 } },
  });
  assert.equal(audit.disposition, "blocked");
  assert.match(audit.blockers.join(" "), /business_family_claim_mismatch/);
  assert.match(audit.blockers.join(" "), /normalized rank is described as a raw metric/);
});

test("shadow replay marks a fully cited, correctly classified proposal review-ready without promoting it", () => {
  const thesis = "The filing reports revenue growth of 18%.";
  const audit = auditProposalQualityShadow({
    agentId: "agent-3",
    candidate: { ticker: "MU", sector: "Technology", industry: "Semiconductors" },
    proposal: {
      action: "BUY",
      thesis,
      claimedBusinessFamily: "technology",
      evidenceCitations: [{ claim: thesis, evidence_ids: ["raw_revenue_growth"] }],
    },
    enriched: {
      primaryFacts: [{ id: "raw_revenue_growth", label: "Revenue growth", value: 0.18, unit: "decimal", source: "company filing" }],
    },
  });
  assert.equal(audit.disposition, "review_ready");
  assert.equal(audit.reviewReady, true);
  const summary = summarizeProposalQualityShadow([audit]);
  assert.deepEqual(summary.totals, {
    audited: 1, actionable: 1, reviewReady: 1, blocked: 0, notActionable: 0, addedEvidence: 1, contextOnlyNews: 0,
  });
});

test("a HOLD is not reported as rank misuse because no actionable claim can proceed", () => {
  const audit = auditProposalQualityShadow({
    agentId: "agent-2",
    candidate: { ticker: "SNDK", sector: "Technology", industry: "Semiconductors" },
    proposal: {
      action: "HOLD",
      thesis: "Momentum rank is 91 but the raw return is unavailable.",
      evidenceCitations: [{ claim: "Momentum rank is 91 but the raw return is unavailable.", evidence_ids: ["rank_momentum"] }],
    },
    enriched: { breakdown: { momentum: 91 } },
  });
  assert.equal(audit.disposition, "not_actionable");
  assert.deepEqual(audit.rankMisuse, []);
});
