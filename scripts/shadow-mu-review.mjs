#!/usr/bin/env node
// One-off local shadow review. It deliberately avoids the production generator
// and evaluator wrappers because those record usage telemetry. This script has
// no Redis, Sheets, proposal queue, approval, signature, or execution import.
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { fetchFundamentals, fetchDailyBars, percentChange } from "../lib/yahoo.js";
import { fetchRecentFilings } from "../lib/edgar.js";
import { rsi } from "../lib/indicators.js";
import { buildProposalEvidence, parseRecommendation } from "../lib/ai-overlay.js";
import { parseEvaluatorResponse } from "../lib/evaluator.js";
import { buildTechnicalFactPacket } from "../lib/evidence-quality-policy.js";
import { auditProposalQualityShadow } from "../lib/proposal-quality-shadow.js";

// This local-only script must use the key in this worktree, not an inherited
// desktop-process environment variable from another project/session.
dotenv.config({ override: true });

const ticker = "MU";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim(), maxRetries: 0 });
const generatorModel = process.env.RESEARCH_PROPOSAL_MODEL?.trim() || "claude-opus-4-8";
const evaluatorModel = process.env.EVALUATOR_MODEL?.trim() || "claude-opus-4-8";

function fact(id, label, value, unit, source) {
  return value == null || value === "" || (typeof value === "number" && !Number.isFinite(value))
    ? null
    : { id, kind: "raw_fact", label, value, unit, source };
}

function isoTimestamp(value) {
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

const now = new Date();
const oneYearAgo = new Date(now);
oneYearAgo.setUTCDate(oneYearAgo.getUTCDate() - 380);
const [fundamentals, bars, filings] = await Promise.all([
  fetchFundamentals(ticker),
  fetchDailyBars(ticker, { period1: oneYearAgo, period2: now }),
  fetchRecentFilings(ticker, { limit: 3 }),
]);
if (fundamentals.error || !fundamentals.raw || bars.length < 30) {
  throw new Error(`Fresh MU shadow input unavailable: ${fundamentals.error ?? "insufficient daily bars"}`);
}

const raw = fundamentals.raw;
const closes = bars.map((bar) => bar.close);
const threeMonths = bars.slice(-64);
const oneMonth = bars.slice(-23);
const technical = buildTechnicalFactPacket({
  bars,
  price: raw.price?.regularMarketPrice ?? null,
  priceTimestamp: isoTimestamp(raw.price?.regularMarketTime),
  asOf: bars.at(-1)?.date?.toISOString?.() ?? null,
});
const factEvidence = [
  fact("raw_current_price", "Current price", raw.price?.regularMarketPrice, "USD", "Yahoo quote"),
  fact("raw_trailing_pe", "Trailing P/E", raw.summaryDetail?.trailingPE, "multiple", "Yahoo fundamentals"),
  fact("raw_forward_pe", "Forward P/E", raw.summaryDetail?.forwardPE, "multiple", "Yahoo fundamentals"),
  fact("raw_revenue_growth", "Revenue growth", raw.financialData?.revenueGrowth, "decimal", "Yahoo fundamentals"),
  fact("raw_earnings_growth", "Earnings growth", raw.financialData?.earningsGrowth, "decimal", "Yahoo fundamentals"),
  fact("raw_profit_margin", "Profit margin", raw.financialData?.profitMargins, "decimal", "Yahoo fundamentals"),
  fact("raw_momentum_3m", "Three-month price return", percentChange(threeMonths), "decimal", "Yahoo daily bars"),
  fact("raw_momentum_1m", "One-month price return", percentChange(oneMonth), "decimal", "Yahoo daily bars"),
  fact("raw_rsi_14", "14-session RSI", rsi(closes), "index_0_to_100", "Yahoo daily bars"),
  technical.currentPrice.status === "available" ? fact("technical_current_price", "Timestamped current price", technical.currentPrice.value, "USD", "Yahoo quote") : null,
  technical.sma200.status === "available" ? fact("technical_sma_200", "200-session simple moving average", technical.sma200.value, "USD", "Yahoo daily bars") : null,
  technical.high52Week.status === "available" ? fact("technical_high_52_week", "52-week high", technical.high52Week.value, "USD", "Yahoo daily bars") : null,
].filter(Boolean);

const packetInput = {
  quantScore: null,
  breakdown: {},
  nextEarningsDate: fundamentals.nextEarningsDate,
  analystTrend: fundamentals.analystTrend,
  insiderActivity: fundamentals.insiderActivity,
  recentFilings: filings,
  factEvidence,
};
const evidencePacket = buildProposalEvidence(packetInput);
const evidenceIds = new Set(evidencePacket.map((entry) => entry.id));
const generatorPrompt = `You are performing a one-off SHADOW-ONLY research review of ${ticker}. This is not an approval, recommendation to trade, or order instruction. Use only the typed evidence ledger below. Do not use memory for facts. A normalized rank is never a raw metric; here no ranks are supplied. Return only JSON:
{
  "action":"BUY"|"SELL"|"HOLD",
  "target_weight_pct":number,
  "thesis":"one or two concise sentences",
  "risks":["..."],
  "kill_criteria":["..."],
  "confidence":number,
  "claimed_business_family":"technology"|"financial_services"|"healthcare"|"consumer"|"industrials"|"energy"|"materials"|"real_estate"|"utilities"|"communications"|"other"|null,
  "evidence_citations":[{"claim":"exact thesis sentence","evidence_ids":["evidence ID"]}],
  "suspect_evidence":[]
}
An actionable thesis needs an exact citation for every sentence. If the supplied evidence cannot support it, return HOLD.

Company classification: sector=${fundamentals.sector ?? "unknown"}; industry=${fundamentals.industry ?? "unknown"}.
EVIDENCE LEDGER:\n${JSON.stringify(evidencePacket, null, 2)}`;
const generatorResponse = await client.messages.create({
  model: generatorModel,
  max_tokens: 700,
  messages: [{ role: "user", content: generatorPrompt }],
});
const generatorText = generatorResponse.content.find((block) => block.type === "text")?.text ?? "";
const proposal = parseRecommendation(generatorText, ticker, evidenceIds);

let evaluator = { verdict: "NOT_RUN", reason: "generator returned HOLD or failed deterministic evidence validation" };
if (proposal.action === "BUY" || proposal.action === "SELL") {
  const evaluatorPrompt = `You are a skeptical investment-committee reviewer. This is SHADOW-ONLY: you cannot approve, queue, sign, or execute anything. Review the proposal against the typed ledger. Return only JSON:
{"verdict":"APPROVE"|"REVISE"|"REJECT","critique":["..."],"evidenceSupportCheck":"pass"|"fail","numericSpotCheck":"pass"|"fail"|"no_numbers_quoted","suspectEvidence":[]}
An APPROVE is allowed only when every factual claim is supported and every quoted number matches the ledger. Do not add facts.

PROPOSAL:\n${JSON.stringify(proposal, null, 2)}\n
EVIDENCE LEDGER:\n${JSON.stringify(evidencePacket, null, 2)}`;
  const evaluatorResponse = await client.messages.create({
    model: evaluatorModel,
    max_tokens: 700,
    messages: [{ role: "user", content: evaluatorPrompt }],
  });
  const evaluatorText = evaluatorResponse.content.find((block) => block.type === "text")?.text ?? "";
  evaluator = parseEvaluatorResponse(evaluatorText);
}

const audit = auditProposalQualityShadow({
  agentId: "agent-3",
  candidate: { ticker, sector: fundamentals.sector, industry: fundamentals.industry },
  proposal,
  baseline: { quantScore: null, breakdown: {} },
  enriched: packetInput,
});
console.log(JSON.stringify({
  mode: "shadow_only",
  writes: { redis: false, sheets: false, proposalQueue: false, approval: false, signature: false, execution: false },
  asOf: now.toISOString(),
  dataAvailability: { dailyBars: bars.length, filings: filings.length, technical },
  proposal: {
    action: proposal.action,
    thesis: proposal.thesis,
    confidence: proposal.confidence,
    evidenceValidation: proposal.evidenceValidation,
    claimedBusinessFamily: proposal.claimedBusinessFamily,
  },
  evaluator,
  deterministicAudit: audit,
}, null, 2));
