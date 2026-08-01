// Offline Phase 1 control: a canonical inventory of every known proposal-entry
// path. It is intentionally not imported by runtime proposal code. Its purpose
// is to prevent a later compiler/cutover from overlooking a source.

import { INTENT_SOURCES } from "../contracts/pipeline.js";

export const PROPOSAL_SOURCE_INVENTORY_VERSION = "phase1-source-inventory-v1";

export const PROPOSAL_SOURCE_INVENTORY = Object.freeze([
  Object.freeze({
    id: "scheduled-discovery",
    intentSource: "scheduled-discovery",
    surface: "backend",
    entryPoint: "jobs/research-scan.js scheduled candidate loop",
    writer: "lib/redis.js#createProposal",
    lineage: "legacy_allocation_only",
    compilerRouting: "phase5_planned",
  }),
  Object.freeze({
    id: "lab",
    intentSource: "lab",
    surface: "backend/dashboard",
    entryPoint: "jobs/research-scan.js#researchTickerForAgent",
    writer: "lib/redis.js#createProposal (shared candidate-review path)",
    lineage: "legacy_allocation_only",
    compilerRouting: "phase5_planned",
  }),
  Object.freeze({
    id: "exit-monitor",
    intentSource: "exit-signal",
    surface: "backend",
    entryPoint: "jobs/monitor-positions.js",
    writer: "lib/redis.js#createProposal",
    lineage: "legacy_allocation_only",
    compilerRouting: "phase5_planned",
  }),
  Object.freeze({
    id: "intraday-stop",
    intentSource: "alert",
    surface: "backend",
    entryPoint: "jobs/intraday-monitor.js",
    writer: "lib/redis.js#createProposal",
    lineage: "legacy_allocation_only",
    compilerRouting: "phase5_planned",
  }),
  Object.freeze({
    id: "manual-dashboard",
    intentSource: "manual",
    surface: "dashboard",
    entryPoint: "../portfolio-dashboard/app/api/proposals/route.ts",
    writer: "../portfolio-dashboard/lib/proposals.ts#createProposal",
    lineage: "legacy_allocation_only",
    compilerRouting: "phase5_planned",
  }),
]);

export function verifyProposalSourceInventory(inventory = PROPOSAL_SOURCE_INVENTORY) {
  const ids = new Set();
  const knownIntentSources = new Set(INTENT_SOURCES);
  const errors = [];

  for (const source of inventory) {
    if (!source?.id || typeof source.id !== "string") errors.push("source has no string id");
    else if (ids.has(source.id)) errors.push(`duplicate source id: ${source.id}`);
    else ids.add(source.id);
    if (!knownIntentSources.has(source?.intentSource)) errors.push(`unsupported intent source: ${source?.intentSource}`);
    if (!source?.entryPoint || !source?.writer) errors.push(`source ${source?.id ?? "unknown"} lacks entry-point or writer evidence`);
    if (source?.lineage !== "legacy_allocation_only") errors.push(`source ${source?.id ?? "unknown"} has unreviewed lineage state`);
    if (!source?.compilerRouting || typeof source.compilerRouting !== "string") {
      errors.push(`source ${source?.id ?? "unknown"} lacks compiler-routing plan`);
    }
  }

  return { valid: errors.length === 0, errors, sourceCount: inventory.length };
}
