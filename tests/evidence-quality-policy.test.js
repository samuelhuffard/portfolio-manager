import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessEvidenceQuality,
  buildTechnicalFactPacket,
  classifyEvidenceQuality,
  surfaceFactContradictions,
  technicalClaimStatus,
} from "../lib/evidence-quality-policy.js";

test("promotional and social evidence is context-only rather than thesis support", () => {
  const promotional = classifyEvidenceQuality({
    sourceType: "news",
    title: "This is a once-in-a-lifetime buying opportunity",
    url: "https://example.com/article",
  });
  assert.equal(promotional.support, false);
  assert.equal(promotional.disposition, "context_only");
  assert.match(promotional.reasons[0], /promotional/i);

  const social = classifyEvidenceQuality({ url: "https://www.reddit.com/r/stocks/comments/123" });
  assert.equal(social.support, false);
  assert.match(social.reasons[0], /reddit/i);
});

test("primary and ordinary secondary reporting remain eligible when not promotional", () => {
  assert.equal(classifyEvidenceQuality({ sourceType: "sec_filing", url: "https://www.sec.gov/Archives/x" }).sourceTier, "primary");
  assert.equal(classifyEvidenceQuality({ title: "Company reported quarterly revenue" }).support, true);
  const assessed = assessEvidenceQuality([{ id: "a", title: "Company reported quarterly revenue" }]);
  assert.deepEqual(assessed[0].evidenceId, "a");
});

test("explicit fact disagreements are surfaced without attempting to parse prose", () => {
  const conflicts = surfaceFactContradictions([
    { field: "trailing_pe", value: 22.1, evidenceId: "filing" },
    { field: "trailing_pe", value: 35.4, evidenceId: "article" },
    { field: "revenue_growth", value: 0.14, evidenceId: "filing" },
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, "trailing_pe");
  assert.equal(conflicts[0].facts.length, 2);
});

test("technical facts are explicitly unavailable when source data is incomplete", () => {
  const packet = buildTechnicalFactPacket({ bars: Array.from({ length: 199 }, () => ({ close: 10 })), price: 10 });
  assert.equal(packet.currentPrice.status, "unavailable");
  assert.equal(packet.sma200.status, "unavailable");
  assert.equal(packet.high52Week.status, "unavailable");
  assert.equal(technicalClaimStatus(packet, "200d SMA").status, "unavailable");
  assert.equal(technicalClaimStatus(packet, "unknown metric").status, "unavailable");

  const gapped = buildTechnicalFactPacket({
    bars: Array.from({ length: 252 }, (_, index) => ({ close: index === 100 ? null : 10 })),
    price: 10,
    priceTimestamp: "2026-07-20T20:00:00Z",
  });
  assert.equal(gapped.sma200.status, "unavailable");
  assert.equal(gapped.high52Week.status, "unavailable");
});

test("technical packet computes only from sufficient valid observations and a stamped price", () => {
  const bars = Array.from({ length: 252 }, (_, index) => ({ close: index + 1 }));
  const packet = buildTechnicalFactPacket({
    bars,
    price: 252.5,
    priceTimestamp: "2026-07-20T20:00:00Z",
    asOf: "2026-07-20",
  });
  assert.deepEqual(packet.currentPrice, { status: "available", value: 252.5, reason: null, asOf: "2026-07-20T20:00:00Z" });
  assert.equal(packet.sma50.status, "available");
  assert.equal(packet.sma200.status, "available");
  assert.equal(packet.sma200.value, 152.5);
  assert.equal(packet.high52Week.value, 252);
  assert.equal(technicalClaimStatus(packet, "52-week high").status, "available");
});

test("provided Yahoo summaryDetail averages are used even when bar history is insufficient", () => {
  // This is the exact real-world case that was broken: fewer than 200/252 daily
  // bars (e.g. from a too-short lookback window), but Yahoo's own summaryDetail
  // already reports the moving averages for free in the same fundamentals call.
  const packet = buildTechnicalFactPacket({
    bars: Array.from({ length: 100 }, () => ({ close: 10 })),
    price: 12,
    priceTimestamp: "2026-07-20T20:00:00Z",
    providedSma50: 11.5,
    providedSma200: 10.75,
    providedHigh52Week: 15,
    providedAsOf: "2026-07-20T20:00:00Z",
  });
  assert.equal(packet.sma50.status, "available");
  assert.equal(packet.sma50.value, 11.5);
  assert.equal(packet.sma50.source, "yahoo_summary_detail");
  assert.equal(packet.sma200.status, "available");
  assert.equal(packet.sma200.value, 10.75);
  assert.equal(packet.high52Week.status, "available");
  assert.equal(packet.high52Week.value, 15);
  assert.equal(technicalClaimStatus(packet, "sma_50").value, 11.5);

  // Without a provided value, insufficient bars still correctly fall back to
  // unavailable — 100 bars covers the 50-day reconstruction but not 200/252.
  const noProvided = buildTechnicalFactPacket({
    bars: Array.from({ length: 100 }, () => ({ close: 10 })),
    price: 12,
    priceTimestamp: "2026-07-20T20:00:00Z",
  });
  assert.equal(noProvided.sma50.status, "available");
  assert.equal(noProvided.sma200.status, "unavailable");
  assert.equal(noProvided.high52Week.status, "unavailable");
});
