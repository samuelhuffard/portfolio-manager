import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEvaluatorResponse, resolveFinalVerdict } from "../lib/evaluator.js";

test("parses a valid APPROVE response", () => {
  const result = parseEvaluatorResponse(
    JSON.stringify({ verdict: "APPROVE", critique: ["thesis matches the data"], evidenceSupportCheck: "pass", numericSpotCheck: "pass", suspectEvidence: [] })
  );
  assert.equal(result.verdict, "APPROVE");
  assert.equal(result.parseError, false);
});

test("extracts JSON even when wrapped in commentary", () => {
  const result = parseEvaluatorResponse(
    'Here is my review:\n{"verdict":"REVISE","critique":["kill criteria are vague"],"evidenceSupportCheck":"pass","numericSpotCheck":"pass","suspectEvidence":[]}\nThanks!'
  );
  assert.equal(result.verdict, "REVISE");
  assert.deepEqual(result.critique, ["kill criteria are vague"]);
});

test("fails CLOSED on unparseable output — REJECT, never a pass", () => {
  const result = parseEvaluatorResponse("I think this proposal looks fine overall.");
  assert.equal(result.verdict, "REJECT");
  assert.equal(result.parseError, true);
});

test("fails CLOSED on an invalid verdict value", () => {
  const result = parseEvaluatorResponse(JSON.stringify({ verdict: "STRONG_APPROVE", critique: [] }));
  assert.equal(result.verdict, "REJECT");
  assert.equal(result.parseError, true);
});

test("fails CLOSED on null/empty input (max_tokens truncation path)", () => {
  assert.equal(parseEvaluatorResponse(null).verdict, "REJECT");
  assert.equal(parseEvaluatorResponse("").verdict, "REJECT");
});

test("invalid numericSpotCheck value degrades to fail, not pass", () => {
  const result = parseEvaluatorResponse(JSON.stringify({ verdict: "APPROVE", critique: [], evidenceSupportCheck: "pass", numericSpotCheck: "looks ok" }));
  assert.equal(result.numericSpotCheck, "fail");
  assert.equal(result.verdict, "REJECT");
});

test("contradictory evaluator APPROVE with failed evidence support fails closed", () => {
  const result = parseEvaluatorResponse(JSON.stringify({ verdict: "APPROVE", critique: ["unsupported P/E"], evidenceSupportCheck: "fail", numericSpotCheck: "pass" }));
  assert.equal(result.verdict, "REJECT");
  assert.equal(result.evidenceSupportCheck, "fail");
});

test("missing evidenceSupportCheck cannot approve an unsupported proposal", () => {
  const result = parseEvaluatorResponse(JSON.stringify({ verdict: "APPROVE", critique: [], numericSpotCheck: "pass" }));
  assert.equal(result.verdict, "REJECT");
  assert.equal(result.evidenceSupportCheck, "fail");
});

test("non-string critique/suspectEvidence entries are dropped and capped at 5", () => {
  const result = parseEvaluatorResponse(
    JSON.stringify({ verdict: "REJECT", critique: ["a", 2, "b", "c", "d", "e", "f"], suspectEvidence: [{}, "x"] })
  );
  assert.deepEqual(result.critique, ["a", "b", "c", "d", "e"]);
  assert.deepEqual(result.suspectEvidence, ["x"]);
});

test("resolveFinalVerdict: APPROVE and REJECT pass through with zero revisions", () => {
  assert.equal(resolveFinalVerdict({ verdict: "APPROVE", critique: [] }).verdict, "APPROVE");
  assert.equal(resolveFinalVerdict({ verdict: "APPROVE", critique: [] }).revisions, 0);
  assert.equal(resolveFinalVerdict({ verdict: "REJECT", critique: [] }).verdict, "REJECT");
});

test("resolveFinalVerdict: REVISE then APPROVE is an approval with one revision", () => {
  const final = resolveFinalVerdict({ verdict: "REVISE", critique: ["fix"] }, { verdict: "APPROVE", critique: [] });
  assert.equal(final.verdict, "APPROVE");
  assert.equal(final.revisions, 1);
});

test("resolveFinalVerdict: one revision max — a second REVISE becomes REJECT", () => {
  const final = resolveFinalVerdict({ verdict: "REVISE", critique: ["fix"] }, { verdict: "REVISE", critique: ["still broken"] });
  assert.equal(final.verdict, "REJECT");
  assert.equal(final.revisions, 1);
});

test("resolveFinalVerdict: REVISE with no revision produced fails closed to REJECT", () => {
  const final = resolveFinalVerdict({ verdict: "REVISE", critique: ["fix"] });
  assert.equal(final.verdict, "REJECT");
});

test("resolveFinalVerdict: REVISE then REJECT stays REJECT", () => {
  const final = resolveFinalVerdict({ verdict: "REVISE", critique: [] }, { verdict: "REJECT", critique: ["unsupported"] });
  assert.equal(final.verdict, "REJECT");
});
