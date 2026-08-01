// Read-only offline audit. It never imports proposal runtime code and only scans
// the five frozen source-entry files for direct createProposal calls.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROPOSAL_SOURCE_INVENTORY } from "../lib/proposal-source-inventory.js";
import { auditProposalWriterPaths, findDirectProposalWriters } from "../lib/proposal-lineage-v2-audit.js";

const paths = [
  "jobs/research-scan.js",
  "jobs/monitor-positions.js",
  "jobs/intraday-monitor.js",
  "../portfolio-dashboard/app/api/proposals/route.ts",
  "../portfolio-dashboard/lib/proposals.ts",
];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = await Promise.all(paths.map(async (filePath) => ({
  path: filePath,
  content: await readFile(path.resolve(repoRoot, filePath), "utf8"),
})));
const result = auditProposalWriterPaths(findDirectProposalWriters(files), PROPOSAL_SOURCE_INVENTORY);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.valid) process.exitCode = 1;
