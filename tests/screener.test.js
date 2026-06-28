import { test } from "node:test";
import assert from "node:assert/strict";
import { screenUniverse } from "../lib/screener.js";

const LIMITS = { microCapMinAvgDollarVolume: 3_000_000 };

const saasMid = {
  ticker: "SAAS",
  sector: "Technology",
  industry: "Software - Application",
  marketCap: 5_000_000_000,
  avgDollarVolume: 50_000_000,
};

test("passes a mid-cap SaaS name", () => {
  const { passed, rejected } = screenUniverse([saasMid], LIMITS);
  assert.equal(passed.length, 1);
  assert.equal(rejected.length, 0);
  assert.equal(passed[0].subVertical, "Software/SaaS");
});

test("rejects a non-tech name (outside sub-verticals)", () => {
  const { passed, rejected } = screenUniverse(
    [{ ticker: "KO", sector: "Consumer Defensive", industry: "Beverages", marketCap: 4_000_000_000 }],
    LIMITS
  );
  assert.equal(passed.length, 0);
  assert.match(rejected[0].reason, /sub-vertical/);
});

test("rejects a large-cap above the $10B ceiling", () => {
  const { rejected } = screenUniverse([{ ...saasMid, ticker: "BIG", marketCap: 50_000_000_000 }], LIMITS);
  assert.match(rejected[0].reason, /large-cap/);
});

test("rejects a micro-cap below the ADDV floor", () => {
  const { rejected } = screenUniverse(
    [{ ...saasMid, ticker: "TINY", marketCap: 150_000_000, avgDollarVolume: 500_000 }],
    LIMITS
  );
  assert.match(rejected[0].reason, /ADDV/);
});

test("passes a micro-cap above the ADDV floor", () => {
  const { passed } = screenUniverse(
    [{ ...saasMid, ticker: "OKMICRO", marketCap: 200_000_000, avgDollarVolume: 5_000_000 }],
    LIMITS
  );
  assert.equal(passed.length, 1);
});

test("rejects when market cap is unavailable", () => {
  const { rejected } = screenUniverse([{ ...saasMid, ticker: "NOCAP", marketCap: null }], LIMITS);
  assert.match(rejected[0].reason, /market cap unavailable/);
});

test("passes a semiconductor name", () => {
  const { passed } = screenUniverse(
    [{ ticker: "CHIP", sector: "Technology", industry: "Semiconductors", marketCap: 3_000_000_000 }],
    LIMITS
  );
  assert.equal(passed[0].subVertical, "Semiconductors");
});
