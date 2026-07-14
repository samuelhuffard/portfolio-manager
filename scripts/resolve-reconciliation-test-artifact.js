#!/usr/bin/env node
import "dotenv/config";
import { resolveReconciliationTestArtifact } from "../lib/redis.js";

const [orderId, ...rest] = process.argv.slice(2);
const commit = rest.includes("--commit");
const legacySmoke = rest.includes("--legacy-smoke");
const attestationIndex = rest.indexOf("--attestation");
const attestation = attestationIndex >= 0 ? rest[attestationIndex + 1] : null;
const attestedBy = process.env.SAM_EMAIL?.trim() || "system-owner";
if (!orderId || !attestation) throw new Error("Usage: node scripts/resolve-reconciliation-test-artifact.js <orderId> --attestation <text> [--commit]");
if (!commit) {
  console.log(JSON.stringify({ preview: true, orderId, resolution: legacySmoke ? "legacy_smoke_quarantine" : "test_artifact", attestedBy, attestation }));
} else {
  const result = await resolveReconciliationTestArtifact({ orderId, attestedBy, attestation, allowLegacySmoke: legacySmoke });
  console.log(JSON.stringify({ orderId, ...result }));
}
