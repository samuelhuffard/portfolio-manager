import { writeFixlist } from "../lib/sysloop/findings.js";
import { OPS } from "./sysloop-shared.mjs";

// Regenerates ops/FIXLIST.md from the findings ledger. Run after editing any
// finding's status: field (open → ack → fixed). Also runs automatically after
// every triage and weekly pass.
const target = writeFixlist({
  findingsDir: OPS.findings,
  proposalDirs: { test: OPS.proposedTests, patch: OPS.proposedPatches },
});
console.log(`[Fixlist] regenerated ${target}`);
