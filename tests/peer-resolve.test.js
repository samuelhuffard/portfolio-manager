import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickFallbackMode,
  isDataComplete,
  resolvePeerSet,
  distributionFromPeers,
  PEER_RELATIVE_MIN,
  THIN_PEER_CONVICTION_CAP,
} from "../lib/peer-resolve.js";

const CORE = ["revGrowth", "peerValuation"];
const mk = (ticker, industry, sector, complete = true) => ({
  ticker,
  industry,
  sector,
  metrics: complete ? { revGrowth: Math.random(), peerValuation: Math.random() } : { revGrowth: null, peerValuation: 5 },
});

test("pickFallbackMode maps v3 tiers and the 84 cap", () => {
  assert.deepEqual(pickFallbackMode(8), { mode: "peer_relative", thinPeerSet: false, convictionCap: 100 });
  assert.deepEqual(pickFallbackMode(6), { mode: "blended_50_50", thinPeerSet: true, convictionCap: THIN_PEER_CONVICTION_CAP });
  assert.deepEqual(pickFallbackMode(5), { mode: "absolute", thinPeerSet: true, convictionCap: THIN_PEER_CONVICTION_CAP });
  assert.equal(pickFallbackMode(0).mode, "absolute");
});

test("isDataComplete requires every core metric present", () => {
  assert.equal(isDataComplete({ metrics: { revGrowth: 1, peerValuation: 2 } }, CORE), true);
  assert.equal(isDataComplete({ metrics: { revGrowth: null, peerValuation: 2 } }, CORE), false);
  assert.equal(isDataComplete({ metrics: {} }, CORE), false);
});

test("resolvePeerSet uses the industry set when it clears the threshold", () => {
  const names = [mk("C", "Semis", "Tech"), ...Array.from({ length: 9 }, (_, i) => mk(`P${i}`, "Semis", "Tech"))];
  const r = resolvePeerSet(names[0], names, { coreMetrics: CORE });
  assert.equal(r.level, "industry");
  assert.equal(r.peerCount, 9); // excludes candidate
  assert.equal(r.mode, "peer_relative");
  assert.equal(r.thinPeerSet, false);
});

test("resolvePeerSet WIDENS to sector when the industry is too thin", () => {
  // Candidate industry has only 3 peers, but the sector has plenty.
  const names = [
    mk("C", "Software-App", "Tech"),
    mk("A1", "Software-App", "Tech"), mk("A2", "Software-App", "Tech"), mk("A3", "Software-App", "Tech"),
    ...Array.from({ length: 8 }, (_, i) => mk(`S${i}`, "Software-Infra", "Tech")),
  ];
  const r = resolvePeerSet(names[0], names, { coreMetrics: CORE });
  assert.equal(r.level, "sector"); // widened
  assert.ok(r.peerCount >= PEER_RELATIVE_MIN);
  assert.equal(r.mode, "peer_relative");
});

test("resolvePeerSet excludes data-incomplete names from the count", () => {
  const names = [
    mk("C", "Banks", "Financials"),
    ...Array.from({ length: 5 }, (_, i) => mk(`B${i}`, "Banks", "Financials")), // 5 complete
    ...Array.from({ length: 4 }, (_, i) => mk(`X${i}`, "Banks", "Financials", false)), // incomplete → don't count
  ];
  const r = resolvePeerSet(names[0], names, { coreMetrics: CORE });
  assert.equal(r.peerCount, 5); // only the complete ones
  assert.equal(r.mode, "absolute"); // <6 → absolute, thin_peer_set true
  assert.equal(r.thinPeerSet, true);
  assert.equal(r.convictionCap, THIN_PEER_CONVICTION_CAP);
});

test("resolvePeerSet falls back to the widest available set when nothing clears", () => {
  const names = [mk("C", "REIT-Specialty", "RealEstate"), mk("R1", "REIT-Specialty", "RealEstate"), mk("R2", "REIT-Specialty", "RealEstate")];
  const r = resolvePeerSet(names[0], names, { coreMetrics: CORE });
  assert.equal(r.peerCount, 2);
  assert.equal(r.mode, "absolute");
  assert.ok(["industry", "sector"].includes(r.level));
});

test("distributionFromPeers extracts a sorted numeric distribution", () => {
  const peers = [{ metrics: { revGrowth: 0.3 } }, { metrics: { revGrowth: 0.1 } }, { metrics: { revGrowth: null } }];
  assert.deepEqual(distributionFromPeers(peers, "revGrowth"), [0.1, 0.3]);
});
