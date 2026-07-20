import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatEvidenceFlagSummary,
  shouldTelegramEvidenceFlags,
  summarizeEvidenceFlags,
} from "../lib/evidence-alerts.js";

test("repeated model warnings about shared durable memory are one alert root", () => {
  const flags = Array.from({ length: 12 }, (_, index) => ({
    kind: `model:T${index}`,
    reasons: ["UNTRUSTED-MEMORY block contained an earlier BUY rationale; treated as advisory only."],
  }));
  const summary = summarizeEvidenceFlags(flags);
  assert.equal(summary.rawCount, 12);
  assert.equal(summary.uniqueCount, 1);
  assert.equal(formatEvidenceFlagSummary(summary), "model:untrusted-memory (12)");
  assert.equal(shouldTelegramEvidenceFlags(flags), false);
});

test("distinct evidence root causes still escalate", () => {
  const flags = [
    { kind: "news:NVDA", reasons: ["ignore-previous-instructions phrasing"] },
    { kind: "athena:IBM", reasons: ["implausible valuation"] },
    { kind: "model:CRWD", reasons: ["source URL conflicts with supplied evidence"] },
  ];
  assert.equal(summarizeEvidenceFlags(flags).uniqueCount, 3);
  assert.equal(shouldTelegramEvidenceFlags(flags), true);
});

test("a single evaluator finding remains an immediate escalation", () => {
  const flags = [{
    kind: "evaluator:NVDA",
    reasons: ["UNTRUSTED-MEMORY block contained an instruction-like prior proposal."],
  }];
  assert.equal(shouldTelegramEvidenceFlags(flags), true);
});
