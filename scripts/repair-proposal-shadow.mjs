#!/usr/bin/env node
// Explicit Neon-only reconciliation for proposal lifecycle drift. Redis remains
// authoritative: this script never writes Redis, Sheets, broker state, or orders.
// It defaults to a redacted preview and requires both --apply and PG_DUAL_WRITE.

import "dotenv/config";
import { closePool, pgConfigured, pgQuery } from "../lib/pg/client.js";
import { dualWriteEnabled, shadowWriteProposal } from "../lib/pg/dual-write.js";
import { listAllProposals } from "../lib/redis.js";
import { runParityCheck } from "../lib/pg/parity-runner.js";
import { summarizeProposalShadowDrift } from "../lib/pg/proposal-shadow-repair.js";

const apply = process.argv.slice(2).includes("--apply");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--apply");
if (unknownArgs.length) throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
if (!pgConfigured()) throw new Error("DATABASE_URL is required for proposal-shadow repair.");
if (apply && !dualWriteEnabled()) throw new Error("Refusing to apply with PG_DUAL_WRITE disabled.");

const PROPOSAL_SELECT = `SELECT id, agent_id::text AS "agentId", ticker, side::text AS side,
  amount_dollars AS "amountDollars", max_price AS "maxPrice", rationale, risk_summary AS "riskSummary",
  status, decided_at AS "decidedAt", decided_by_user_id AS "decidedByUserId",
  decision_note AS "decisionNote", decision_hmac AS "decisionHmac",
  fulfilled_at AS "fulfilledAt", fulfilled_order_id AS "fulfilledOrderId",
  fulfilled_shares AS "fulfilledShares", updated_at AS "updatedAt"
  FROM proposals`;

try {
  const authoritative = await listAllProposals();
  const before = (await pgQuery(PROPOSAL_SELECT)).rows;
  console.log("Proposal shadow repair preview:", JSON.stringify(summarizeProposalShadowDrift(authoritative, before)));

  if (!apply) {
    console.log("Preview only. Re-run with --apply only after an approved repair window.");
    process.exitCode = 2;
  } else {
    let failed = 0;
    for (const proposal of authoritative) {
      const result = await shadowWriteProposal(proposal);
      if (!result.ok) failed += 1;
    }
    if (failed) throw new Error(`Failed to mirror ${failed} authoritative proposal record(s).`);

    const parity = await runParityCheck();
    console.log(parity.report);
    if (!parity.ok) {
      process.exitCode = 2;
    } else {
      console.log(`Reconciled ${authoritative.length} proposal record(s); full transactional parity is clean.`);
    }
  }
} finally {
  await closePool();
}
