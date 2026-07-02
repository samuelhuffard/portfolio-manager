import "dotenv/config";
import { listOpenApprovedProposals } from "../lib/redis.js";
import { assertApprovedProposalSignature } from "../lib/proposal-signature.js";

// Read-only: prints proposals approved in the dashboard's /approvals queue that
// haven't been matched to a Robinhood fill yet. Used to find what's ready for
// on-demand execution via the robinhood-trading MCP.
//
// Each proposal is annotated with signatureValid — NEVER execute one where
// signatureValid is false; it did not come through the dashboard's approval flow.
const proposals = await listOpenApprovedProposals();
const annotated = proposals.map((p) => {
  try {
    assertApprovedProposalSignature(p);
    return { ...p, signatureValid: true };
  } catch (err) {
    return { ...p, signatureValid: false, signatureError: err.message };
  }
});
const invalid = annotated.filter((p) => !p.signatureValid);
if (invalid.length) {
  console.error(`WARNING: ${invalid.length} proposal(s) FAILED signature verification — do not execute them.`);
}
console.log(JSON.stringify(annotated, null, 2));
