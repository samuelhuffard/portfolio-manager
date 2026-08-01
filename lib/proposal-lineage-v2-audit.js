import { createHash } from "node:crypto";

export const PROPOSAL_LINEAGE_V2_AUDIT_VERSION = "proposal-lineage-v2-audit-v1";
export const V2_FIELDS = Object.freeze([
  "id", "status", "agentId", "ticker", "side", "amountDollars", "maxPrice",
  "decidedAt", "decidedByUserId", "strategyProposalFingerprint", "signatureVersion",
]);

function value(field, input) {
  const raw = input?.[field];
  if (raw == null && ["maxPrice", "decidedAt", "decidedByUserId"].includes(field)) return "";
  if (raw == null) throw new TypeError(`${field} is required for the v2 fixture payload`);
  const text = String(raw);
  if (text.includes("|")) throw new TypeError(`${field} contains an unescaped pipe and is not serializable in v2`);
  return text;
}

/** Pure fixture-only serializer. It does not sign, write, approve, or execute. */
export function buildV2FixturePayload(input) {
  if (input?.signatureVersion !== "v2") throw new TypeError("signatureVersion must be v2");
  if (!/^[a-f0-9]{64}$/i.test(String(input?.strategyProposalFingerprint ?? ""))) {
    throw new TypeError("strategyProposalFingerprint must be a sha256 hex digest");
  }
  return V2_FIELDS.map((field) => value(field, input)).join("|");
}

export function fixtureDigest(input) {
  return createHash("sha256").update(buildV2FixturePayload(input)).digest("hex");
}

/**
 * Finds proposal writers in supplied static source text. Callers must compare the
 * result to the frozen inventory; this is deliberately not a runtime guard.
 */
export function findDirectProposalWriters(files = []) {
  return files
    .filter((file) => /\bcreateProposal\s*\(/.test(String(file?.content ?? "")))
    .map((file) => String(file.path));
}

export function auditProposalWriterPaths(foundPaths, declaredSources) {
  const declared = new Set((declaredSources ?? []).flatMap((source) => [
    String(source.entryPoint).split(" ")[0],
    String(source.writer).split("#")[0].split(" ")[0],
  ]));
  const undeclared = (foundPaths ?? []).filter((path) => ![...declared].some((entry) => path.endsWith(entry)));
  return Object.freeze({
    version: PROPOSAL_LINEAGE_V2_AUDIT_VERSION,
    foundPaths: [...foundPaths].sort(),
    undeclared: undeclared.sort(),
    valid: undeclared.length === 0,
  });
}
