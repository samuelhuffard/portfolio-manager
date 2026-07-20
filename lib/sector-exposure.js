/**
 * Canonical concentration key for all three sector-agnostic v3 mandates.
 * Broad sector is authoritative; the legacy Agent One sub-vertical remains a
 * fallback only for older holdings whose fundamentals lack a sector field.
 */
export function resolveSectorExposureKey(candidate = {}) {
  for (const value of [
    candidate.sector,
    candidate.raw?.assetProfile?.sector,
    candidate.subVertical,
  ]) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (normalized) return normalized;
  }
  return null;
}
