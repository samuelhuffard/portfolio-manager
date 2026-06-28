import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rsi,
  macd,
  atr,
  weeklyVolatility,
  volAdjustedDeclineTriggered,
  avgDailyDollarVolume,
  relativeStrength,
  classifySubVertical,
} from "../lib/indicators.js";

test("rsi returns 100 when prices only ever rise", () => {
  const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
  assert.equal(rsi(closes, 14), 100);
});

test("rsi is below 50 on a downtrend and above 50 on an uptrend", () => {
  const down = Array.from({ length: 30 }, (_, i) => 100 - i * 0.5);
  const up = Array.from({ length: 30 }, (_, i) => 100 + i * 0.5);
  assert.ok(rsi(down, 14) < 50);
  assert.ok(rsi(up, 14) > 50);
});

test("rsi returns null without enough data", () => {
  assert.equal(rsi([1, 2, 3], 14), null);
});

test("macd flags a confirmed bearish crossover after a trend rolls over", () => {
  // 40 up sessions then 10 sharp down sessions -> MACD should be below signal at the end.
  const closes = [
    ...Array.from({ length: 40 }, (_, i) => 100 + i),
    ...Array.from({ length: 10 }, (_, i) => 140 - i * 4),
  ];
  const m = macd(closes);
  assert.ok(m);
  assert.equal(m.bearishCrossoverConfirmed, true);
  assert.ok(m.histogram < 0);
});

test("atr is positive for bars with real ranges and null when too short", () => {
  const bars = Array.from({ length: 20 }, (_, i) => ({
    high: 102 + i,
    low: 98 + i,
    close: 100 + i,
  }));
  assert.ok(atr(bars, 14) > 0);
  assert.equal(atr(bars.slice(0, 5), 14), null);
});

test("volAdjustedDeclineTriggered fires only on a drop beyond the vol band", () => {
  // Calm name: tiny weekly moves, then a sharp final-week drop.
  const calm = [];
  for (let w = 0; w < 14; w++) {
    for (let d = 0; d < 5; d++) calm.push(100 + w * 0.2 + d * 0.01);
  }
  const before = calm[calm.length - 1];
  // Force a final-week decline far beyond normal weekly vol.
  for (let d = 0; d < 5; d++) calm.push(before * (1 - 0.1 * (d + 1) / 5));
  const res = volAdjustedDeclineTriggered(calm, { multiple: 1.75 });
  assert.ok(res);
  assert.equal(res.triggered, true);
  assert.ok(res.weekReturn < 0);
});

test("avgDailyDollarVolume multiplies close by volume", () => {
  const bars = Array.from({ length: 30 }, () => ({ close: 10, volume: 1_000_000 }));
  assert.equal(avgDailyDollarVolume(bars, 30), 10_000_000);
});

test("relativeStrength detects 3+ weeks of underperformance", () => {
  // Benchmark flat, name steadily losing ground week over week.
  const days = 6 * 5;
  const bench = Array.from({ length: days }, () => 100);
  const name = Array.from({ length: days }, (_, i) => 100 - i * 0.5);
  const rs = relativeStrength(name, bench, { weeks: 4 });
  assert.ok(rs);
  assert.ok(rs.consecutiveDecliningWeeks >= 3);
  assert.equal(rs.weakening, true);
});

test("classifySubVertical maps semis and software, rejects the rest", () => {
  assert.equal(classifySubVertical({ sector: "Technology", industry: "Semiconductors" }), "Semiconductors");
  assert.equal(classifySubVertical({ sector: "Technology", industry: "Software—Application" }), "Software/SaaS");
  assert.equal(classifySubVertical({ sector: "Consumer Cyclical", industry: "Apparel Retail" }), null);
});
