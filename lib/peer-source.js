/**
 * Peer source: supplies the industry peer distributions that lib/peer-scoring.js
 * ranks candidates against (Mandate v2).
 *
 * DECISION (2026-07-12): the peer key is Yahoo's 2-level sector/industry, already
 * enriched into the universe catalog (`i` field, see lib/universe.js / jobs/
 * universe-refresh.js). This is coarse (not true GICS sub-industry); the mandate's
 * thin-peer fallback (<~7 comparables → absolute thresholds + `thin_peer_set` flag)
 * carries the risk. The `PeerSource` interface exists so a GICS bulk-data vendor can
 * be dropped in later WITHOUT touching the scoring engine.
 *
 * NOT wired into the live pipeline. See docs/MANDATE-V2-INGESTION.md.
 */

/** Redis key for a precomputed per-industry distribution set (built nightly). */
export const PEER_DIST_KEY = (industry) => `pm:peer-dist:${industry}`;

/**
 * Pure: group a list of names (each { ticker, industry, metrics }) into
 * per-industry, per-metric sorted value arrays — the distribution set that
 * scoreCategoriesPeerRelative consumes.
 *
 * @param names     [{ ticker, industry, metrics: { [metricId]: number|null } }]
 * @param metricIds string[] metrics to build distributions for
 * @returns { [industry]: { [metricId]: number[] } }  (values sorted ascending)
 */
export function buildIndustryDistributions(names, metricIds) {
  const byIndustry = {};
  for (const row of names) {
    const industry = row.industry;
    if (!industry) continue; // unclassified names cannot be peer-ranked
    if (!byIndustry[industry]) {
      byIndustry[industry] = {};
      for (const m of metricIds) byIndustry[industry][m] = [];
    }
    for (const m of metricIds) {
      const v = row.metrics?.[m];
      if (v != null && !Number.isNaN(v)) byIndustry[industry][m].push(v);
    }
  }
  for (const industry of Object.keys(byIndustry)) {
    for (const m of metricIds) byIndustry[industry][m].sort((a, b) => a - b);
  }
  return byIndustry;
}

/**
 * Interface every peer source implements. Kept minimal so the scoring engine is
 * source-agnostic. A GICS vendor implementation would replace only this class.
 */
export class PeerSource {
  /** Peer-set key for a candidate (e.g. its industry). Override. */
  peerKey(_candidate) {
    throw new Error("PeerSource.peerKey not implemented");
  }
  /** Sorted peer values for one industry + metric. Override (async in real impls). */
  async getDistribution(_industryKey, _metricId) {
    throw new Error("PeerSource.getDistribution not implemented");
  }
}

/**
 * Yahoo-industry peer source (default). Reads distributions precomputed by the
 * nightly enrichment job (Phase A W2) from Redis `pm:peer-dist:<industry>`.
 * Skeleton: `redis` is injected so this stays testable and unwired; the nightly
 * writer and the research-scan read path are added in Phase A/B, not here.
 */
export class YahooIndustryPeerSource extends PeerSource {
  constructor({ redis } = {}) {
    super();
    this.redis = redis;
  }

  peerKey(candidate) {
    return candidate?.industry ?? candidate?.raw?.assetProfile?.industry ?? null;
  }

  async getDistribution(industryKey, metricId) {
    if (!industryKey || !this.redis) return [];
    const blob = await this.redis.get(PEER_DIST_KEY(industryKey));
    if (!blob) return [];
    const dist = typeof blob === "string" ? JSON.parse(blob) : blob;
    return Array.isArray(dist?.[metricId]) ? dist[metricId] : [];
  }
}
