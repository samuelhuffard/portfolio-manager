import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getOperationalLedgerSecret } from "./operational-ledger.js";

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

export function assertPhase0Observation(record, secret = getOperationalLedgerSecret()) {
  if (!record?.rowHmac || !record?.contentHash) throw new Error("Phase 0 observation is unsigned.");
  const expectedHash = computePhase0ContentHash(record);
  if (record.contentHash !== expectedHash) throw new Error("Phase 0 observation content hash mismatch.");
  const expected = Buffer.from(computePhase0ObservationHmac(record, secret), "hex");
  const provided = Buffer.from(String(record.rowHmac), "hex");
  if (provided.length !== expected.length || provided.length === 0 || !timingSafeEqual(provided, expected)) {
    throw new Error("Phase 0 observation HMAC mismatch.");
  }
  return record;
}
