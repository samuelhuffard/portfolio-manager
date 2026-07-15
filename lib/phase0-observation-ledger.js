import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getOperationalLedgerSecret, getOperationalLedgerVerificationSecrets } from "./operational-ledger.js";

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function unsignedRecord(record) {
  const { rowHmac: _rowHmac, contentHash: _contentHash, ...fields } = record ?? {};
  return fields;
}

export function computePhase0ContentHash(record) {
  return createHash("sha256").update(stableJson(unsignedRecord(record))).digest("hex");
}

export function computePhase0ObservationHmac(record, secret = getOperationalLedgerSecret()) {
  const contentHash = computePhase0ContentHash(record);
  return createHmac("sha256", secret)
    .update(stableJson({ kind: "phase0-observation", contentHash, record: unsignedRecord(record) }))
    .digest("hex");
}

export function signPhase0Observation(record, secret = getOperationalLedgerSecret()) {
  const unsigned = unsignedRecord(record);
  const contentHash = computePhase0ContentHash(unsigned);
  return { ...unsigned, contentHash, rowHmac: computePhase0ObservationHmac(unsigned, secret) };
}

export function assertPhase0Observation(record, secret = null) {
  if (!record?.rowHmac || !record?.contentHash) throw new Error("Phase 0 observation is unsigned.");
  const expectedHash = computePhase0ContentHash(record);
  if (record.contentHash !== expectedHash) throw new Error("Phase 0 observation content hash mismatch.");
  // Signing uses the primary secret; verification accepts any configured
  // secret so records signed before a dedicated OPERATIONAL_LEDGER_HMAC_SECRET
  // was introduced remain verifiable. No configured secret = fail closed.
  const candidates = [...new Set([...(secret ? [secret] : []), ...getOperationalLedgerVerificationSecrets()])];
  if (!candidates.length) throw new Error("Phase 0 observation verification requires a configured signing secret.");
  const provided = Buffer.from(String(record.rowHmac), "hex");
  const matches = candidates.some((candidate) => {
    const expected = Buffer.from(computePhase0ObservationHmac(record, candidate), "hex");
    return provided.length === expected.length && provided.length > 0 && timingSafeEqual(provided, expected);
  });
  if (!matches) throw new Error("Phase 0 observation HMAC mismatch.");
  return record;
}
