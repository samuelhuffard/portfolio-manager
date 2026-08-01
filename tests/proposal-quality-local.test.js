import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  auditLocalProposalQuality,
  summarizeLocalProposalQuality,
} from "../lib/proposal-quality-local.js";

test("local proposal-quality harness blocks false family and rank-as-fact claims", () => {
  const audit = auditLocalProposalQuality({
    agentId: "agent-1",
    candidate: { ticker: "BANK", sector: "Financial Services", industry: "Banks - Regional" },
    proposal: { action: "BUY", thesis: "BANK is a technology company trading at a 94.6 P/E.", claimedBusinessFamily: "technology", evidenceCitations: [{ claim: "BANK is a technology company trading at a 94.6 P/E.", evidence_ids: ["rank_trailingPE"] }] },
    enriched: { breakdown: { trailingPE: 94.6 }, primaryFacts: [{ id: "raw_pe", value: 28.25 }] },
  });
  assert.equal(audit.disposition, "blocked");
  assert.match(audit.blockers.join(" "), /business_family_mismatch/);
  assert.match(audit.blockers.join(" "), /rank_described_as_raw_metric/);
});

test("fully cited local facts can be review-ready without creating a proposal", () => {
  const audit = auditLocalProposalQuality({
    agentId: "agent-3",
    candidate: { ticker: "FILINGS", sector: "Technology", industry: "Semiconductors" },
    proposal: { action: "BUY", thesis: "FILINGS reported revenue growth of 18%.", claimedBusinessFamily: "technology", evidenceCitations: [{ claim: "FILINGS reported revenue growth of 18%.", evidence_ids: ["raw_revenue_growth"] }] },
    enriched: { primaryFacts: [{ id: "raw_revenue_growth", value: 0.18, source: "local filing" }] },
  });
  assert.equal(audit.disposition, "review_ready");
  assert.deepEqual(summarizeLocalProposalQuality([audit]).totals, {
    audited: 1, reviewReady: 1, blocked: 0, notActionable: 0, addedEvidence: 1,
  });
  assert.equal(audit.label, "synthetic_local_non_promotional");
});

test("harness import closure is local and rejects prohibited runtime dependencies", () => {
  const source = readFileSync(fileURLToPath(new URL("../lib/proposal-quality-local.js", import.meta.url)), "utf8");
  const imports = [...source.matchAll(
    /^\s*import(?:[\s\S]*?\s+from\s+)?\s*["']([^"']+)["']/gm,
  )].map((match) => match[1]);
  assert.deepEqual(imports, []);
});
