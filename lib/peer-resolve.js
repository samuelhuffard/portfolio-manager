/**
 * Peer-set resolution + v3 thin-peer tiering (Mandate v3 §5).
 *
 * The peer-probe (npm run peer:probe) proved Yahoo's industry classification is
 * fine-grained, so raw industry cohorts are frequently < the 8 "true peers" v3 wants
 * for normal peer-relative scoring. This module (a) counts data-complete peers, (b)
 * WIDENS the peer set up the hierarchy (industry → sector) until it clears the
 * threshold, and (c) maps the resulting count to v3's deterministic fallback mode.
 *
 * v3 tiers (per every analyst §5, validated by Agent Four §6):
 *   ≥ 8 true peers → peer_relative
 *   6–7            → blended_50_50   (½ peer-relative + ½ absolute-threshold)
 *   < 6            → absolute        (absolute-threshold table only)
 * thin_peer_set (the latter two) caps conviction at 84 (no Tier 1) absent a recorded
 * human override.
 *
 * Pure. NOT wired live. See docs/MANDATE-V2-INGESTION.md §7/§8/§10.
 */

export const PEER_RELATIVE_MIN = 8; // ≥ this ⇒ normal peer-relative
export const BLENDED_MIN = 6; // 6–7 ⇒ blended_50_50; below ⇒ absolute
export const THIN_PEER_CONVICTION_CAP = 84;

/** Map a peer count to v3's fallback mode. */
export function pickFallbackMode(peerCount) {
  if (peerCount >= PEER_RELATIVE_MIN) return { mode: "peer_relative", thinPeerSet: false, convictionCap: 100 };
  if (peerCount >= BLENDED_MIN) return { mode: "blended_50_50", thinPeerSet: true, convictionCap: THIN_PEER_CONVICTION_CAP };
  return { mode: "absolute", thinPeerSet: true, convictionCap: THIN_PEER_CONVICTION_CAP };
}

/** A peer is "true"/data-complete if it has a value for every core metric. */
export function isDataComplete(row, coreMetrics) {
  const m = row?.metrics ?? {};
  return coreMetrics.every((k) => m[k] != null && !Number.isNaN(m[k]));
}

/**
 * Resolve the peer set for a candidate by widening up the classification hierarchy
 * until it clears PEER_RELATIVE_MIN (or the widest level is reached).
 *
 * @param candidate { ticker, industry, sector }
 * @param names     [{ ticker, industry, sector, metrics }] the full cohort universe
 * @param opts.coreMetrics metrics that must be present for a peer to count
 * @param opts.minPeers    target true-peer count (default PEER_RELATIVE_MIN)
 * @returns { level: "industry"|"sector"|"none", key, peerCount, peers, ...pickFallbackMode() }
 *          peerCount EXCLUDES the candidate itself. peers is the resolved peer rows.
 */
export function resolvePeerSet(candidate, names, { coreMetrics, minPeers = PEER_RELATIVE_MIN } = {}) {
  const levels = [
    { level: "industry", key: candidate.industry, match: (r) => r.industry && r.industry === candidate.industry },
    { level: "sector", key: candidate.sector, match: (r) => r.sector && r.sector === candidate.sector },
  ];

  let widest = { level: "none", key: null, peerCount: 0, peers: [] };
  for (const lvl of levels) {
    if (!lvl.key) continue;
    const peers = names.filter((r) => r.ticker !== candidate.ticker && lvl.match(r) && isDataComplete(r, coreMetrics));
    const resolved = { level: lvl.level, key: lvl.key, peerCount: peers.length, peers };
    if (peers.length >= minPeers) return { ...resolved, ...pickFallbackMode(peers.length) };
    if (peers.length > widest.peerCount) widest = resolved; // remember the best we got
  }
  // Nothing cleared the threshold — use the widest set we found and let the mode reflect it.
  return { ...widest, ...pickFallbackMode(widest.peerCount) };
}

/** Sorted value distribution for a metric across a set of peer rows (for percentile ranking). */
export function distributionFromPeers(peers, metricId) {
  return peers
    .map((r) => r.metrics?.[metricId])
    .filter((v) => v != null && !Number.isNaN(v))
    .sort((a, b) => a - b);
}
