#!/usr/bin/env node
import "dotenv/config";
import { closeLegacyTestApproval } from "../lib/redis.js";

const [proposalId, ...rest] = process.argv.slice(2);
const commit = rest.includes("--commit");
const attestationIndex = rest.indexOf("--attestation");
const attestation = attestationIndex >= 0 ? rest[attestationIndex + 1] : null;
const attestedBy = process.env.SAM_EMAIL?.trim() || "system-owner";
if (!proposalId || !attestation) throw new Error("Usage: node scripts/close-legacy-test-approval.js <proposalId> --attestation <text> [--commit]");
if (!commit) {
  console.log(JSON.stringify({ preview: true, proposalId, status: "Rejected", attestedBy, attestation }));
} else {
  const result = await closeLegacyTestApproval({ proposalId, attestedBy, attestation });
  console.log(JSON.stringify({ proposalId, ...result }));
}
