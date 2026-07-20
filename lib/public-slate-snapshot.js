const STRING_FIELDS = [
  "date",
  "status",
  "source",
  "reasonCode",
  "candidateBusVersion",
  "catalogSnapshotId",
  "screenPolicyVersion",
  "attentionPolicyVersion",
  "updatedAt",
];

const NUMBER_FIELDS = [
  "screened",
  "screenedOut",
  "sectorEnriched",
  "cataloged",
  "aiReviewBudget",
];

function finiteCounts(value, keys) {
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(
    keys.map((key) => [key, Number.isFinite(value[key]) && value[key] >= 0 ? value[key] : null])
  );
}

/**
 * Allow-listed public health projection. The Redis snapshot is operational
 * state, but /health must never expose tickers, rationale, or private text even
 * if a future writer adds those fields.
 */
export function toPublicSlateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const publicSnapshot = {};
  for (const key of STRING_FIELDS) {
    if (typeof snapshot[key] === "string" && snapshot[key].trim()) publicSnapshot[key] = snapshot[key];
  }
  for (const key of NUMBER_FIELDS) {
    if (Number.isFinite(snapshot[key]) && snapshot[key] >= 0) publicSnapshot[key] = snapshot[key];
  }
  if (typeof snapshot.degraded === "boolean") publicSnapshot.degraded = snapshot.degraded;

  publicSnapshot.counts = finiteCounts(snapshot.counts, ["holdings", "movers", "ranked", "exploration"]);
  publicSnapshot.census = finiteCounts(snapshot.census, [
    "listed",
    "quoted",
    "classified",
    "marketCapCovered",
    "liquidityCovered",
    "quoteAndLiquidityCovered",
  ]);
  publicSnapshot.ledger = finiteCounts(snapshot.ledger, [
    "totalNames",
    "researchedLast7d",
    "researchedLast14d",
  ]);
  return publicSnapshot;
}
