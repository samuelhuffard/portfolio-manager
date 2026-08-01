import { createHash } from "node:crypto";
import { BENCH30_GOLDEN_SET } from "../fixtures/bench30-golden-set.js";

export const BENCH30_INTAKE_VERSION = "bench30-evidence-packet-v1";
export const BENCH30_EXPECTED_DISPOSITIONS = Object.freeze([
  "review_ready", "blocked_missing", "blocked_stale", "blocked_conflict", "excluded",
]);

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validTime(value) {
  return Number.isFinite(Date.parse(value));
}

function hash(value) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

/**
 * Validate a locally retained evidence packet. This deliberately accepts no URL
 * or provider fetch path: a receipt must already exist locally and be hashed.
 */
export function validateBench30EvidencePacket(packet, { slots = BENCH30_GOLDEN_SET.slots } = {}) {
  const errors = [];
  const slot = slots.find((candidate) => candidate.id === packet?.slotId);
  if (!packet || packet.version !== BENCH30_INTAKE_VERSION) errors.push("invalid_version");
  if (!slot) errors.push("unknown_slot");
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(String(packet?.security?.ticker ?? ""))) errors.push("invalid_security_ticker");
  if (!String(packet?.security?.shareClass ?? "").trim()) errors.push("share_class_required");
  for (const field of ["decisionTime", "availableAt", "retrievedAt"]) {
    if (!validTime(packet?.[field])) errors.push(`invalid_${field}`);
  }
  if (validTime(packet?.availableAt) && validTime(packet?.decisionTime) && Date.parse(packet.availableAt) > Date.parse(packet.decisionTime)) errors.push("future_fact");
  if (validTime(packet?.retrievedAt) && validTime(packet?.decisionTime) && Date.parse(packet.retrievedAt) > Date.parse(packet.decisionTime)) errors.push("retrieved_after_decision");
  if (!String(packet?.receipt?.path ?? "").trim()) errors.push("receipt_path_required");
  if (!/^[a-f0-9]{64}$/i.test(String(packet?.receipt?.sha256 ?? ""))) errors.push("receipt_hash_required");
  if (!String(packet?.receipt?.retentionNote ?? "").trim()) errors.push("retention_note_required");
  if (!slot?.sourceTier || packet?.sourceTier !== slot.sourceTier) errors.push("source_tier_mismatch");
  if (!Array.isArray(packet?.facts) || !packet.facts.length) errors.push("facts_required");
  if (!Array.isArray(packet?.missingness)) errors.push("missingness_required");
  if (!BENCH30_EXPECTED_DISPOSITIONS.includes(packet?.expectedDisposition)) errors.push("invalid_expected_disposition");
  if (!String(packet?.policyVersion ?? "").trim()) errors.push("policy_version_required");
  if (slot && packet?.policyVersion !== slot.policyVersion) errors.push("policy_version_mismatch");
  if (!String(packet?.eventState?.restatementOrCorporateAction ?? "").trim()) errors.push("event_state_required");
  if (!String(packet?.eventState?.conflictState ?? "").trim()) errors.push("conflict_state_required");
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function buildBench30IntakeReport(packets = [], { slots = BENCH30_GOLDEN_SET.slots } = {}) {
  const seen = new Set();
  const invalid = [];
  for (const packet of packets) {
    const result = validateBench30EvidencePacket(packet, { slots });
    if (seen.has(packet?.slotId)) invalid.push({ slotId: packet?.slotId ?? null, errors: ["duplicate_packet"] });
    else seen.add(packet?.slotId);
    if (!result.valid) invalid.push({ slotId: packet?.slotId ?? null, errors: result.errors });
  }
  const present = slots.filter((slot) => seen.has(slot.id)).map((slot) => slot.id);
  const missing = slots.filter((slot) => !seen.has(slot.id)).map((slot) => ({ id: slot.id, scenario: slot.scenario }));
  return Object.freeze({
    version: "bench30-intake-report-v1",
    manifestFingerprint: hash(slots),
    requiredSlots: slots.length,
    presentSlots: present.length,
    missingSlots: missing.length,
    status: invalid.length ? "invalid" : present.length === slots.length ? "complete" : "held",
    mayCallItBench30: invalid.length === 0 && present.length === slots.length,
    invalid,
    missing,
  });
}
