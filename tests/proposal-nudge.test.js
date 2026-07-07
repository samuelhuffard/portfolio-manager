import { test } from "node:test";
import assert from "node:assert/strict";
import { selectExpiringProposals, formatExpiryNudge } from "../lib/proposal-nudge.js";

const NOW = new Date("2026-07-07T12:00:00.000Z");

function proposal(overrides = {}) {
  return {
    id: "p-1",
    agentId: "agent-1",
    ticker: "GOOD",
    side: "BUY",
    amountDollars: 250,
    status: "Pending",
    expiresAt: "2026-07-08T00:00:00.000Z", // 12h out
    ...overrides,
  };
}

test("selects Pending proposals inside the window, excludes already-expired and far-out ones", () => {
  const picked = selectExpiringProposals(
    [
      proposal({ id: "in-window" }),
      proposal({ id: "already-expired", expiresAt: "2026-07-07T11:00:00.000Z" }),
      proposal({ id: "far-out", expiresAt: "2026-07-09T00:00:00.000Z" }),
    ],
    { now: NOW }
  );
  assert.deepEqual(picked.map((p) => p.id), ["in-window"]);
});

test("non-Pending statuses and missing expiresAt never nudge", () => {
  const picked = selectExpiringProposals(
    [
      proposal({ id: "approved", status: "ApprovedForBrokerReview" }),
      proposal({ id: "expired", status: "Expired" }),
      proposal({ id: "no-expiry", expiresAt: null }),
      null,
    ],
    { now: NOW }
  );
  assert.deepEqual(picked, []);
});

test("windowHours is respected", () => {
  const picked = selectExpiringProposals([proposal()], { now: NOW, windowHours: 6 });
  assert.deepEqual(picked, []); // 12h out, window is 6h
});

test("formatExpiryNudge lists each proposal with hours remaining", () => {
  const msg = formatExpiryNudge([proposal()], NOW);
  assert.match(msg, /1 pending proposal\(s\) expiring soon/);
  assert.match(msg, /agent-1 BUY GOOD \$250 — expires in ~12h/);
});
