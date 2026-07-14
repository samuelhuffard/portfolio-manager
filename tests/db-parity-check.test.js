import test from "node:test";
import assert from "node:assert/strict";
import { parityStatusPayload } from "../jobs/db-parity-check.js";

test("daily parity status preserves aggregate valuation classification without inventories", () => {
  const payload = parityStatusPayload({
    ok: true,
    comparedAt: "2026-07-14T20:00:00.000Z",
    matched: ["positions"],
    divergences: [],
    valuation: {
      status: "NON_COMPARABLE",
      comparable: false,
      reason: "versioned quote provenance unavailable",
      authoritative: { inventory: { count: 1, digest: "private-a" }, marketValue: 15.37 },
      postgres: { inventory: { count: 1, digest: "private-b" }, marketValue: 15.39 },
    },
  });

  assert.deepEqual(payload.valuation, {
    status: "NON_COMPARABLE",
    comparable: false,
    reason: "versioned quote provenance unavailable",
  });
  assert.doesNotMatch(JSON.stringify(payload), /private-a|private-b|15\.37|15\.39/);
});

test("daily parity status is explicit when valuation classification is absent", () => {
  assert.equal(parityStatusPayload({ ok: false }).valuation, null);
});
