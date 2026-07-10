import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../jobs/intraday-monitor.js", import.meta.url), "utf8");

test("price alerts enter the canonical research pipeline instead of creating proposals directly", () => {
  const alertSection = source.slice(
    source.indexOf("// ── 1. Price alerts"),
    source.indexOf("// ── 2. Intraday ATR")
  );
  assert.match(alertSection, /researchTickerForAgent\(alert\.agentId, alert\.ticker\)/);
  assert.doesNotMatch(alertSection, /createProposal\(/);
});

test("failed alert research keeps the alert active for retry", () => {
  const removal = source.indexOf("await removePriceAlert(alert.id)");
  const research = source.indexOf("await researchTickerForAgent(alert.agentId, alert.ticker)");
  assert.ok(removal > research);
  assert.match(source, /keeping alert active for retry/);
});
