/**
 * Replay the current authoritative proposal set into the Neon shadow. This is
 * a bounded, idempotent delivery retry—not a new proposal source and never a
 * write to Redis, Sheets, or a broker.
 */
export async function reconcileProposalShadow({ listProposals, mirrorProposal }) {
  const proposals = await listProposals();
  if (!Array.isArray(proposals)) throw new Error("Authoritative proposal list is unreadable.");

  let mirrored = 0;
  const failures = [];
  for (const proposal of proposals) {
    const result = await mirrorProposal(proposal);
    if (result?.ok) {
      mirrored += 1;
    } else {
      failures.push(String(proposal?.id ?? "unknown"));
    }
  }
  return {
    authoritativeCount: proposals.length,
    mirrored,
    failed: failures.length,
    // Keep the durable receipt aggregate-safe; proposal IDs and private text
    // belong in the authoritative stores, not operational status telemetry.
    ok: failures.length === 0,
  };
}
