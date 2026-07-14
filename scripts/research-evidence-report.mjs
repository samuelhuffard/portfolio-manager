#!/usr/bin/env node
// Read-only renderer; it never matures outcomes, writes rows, or contacts any market service.
import { pgConfigured, getPool, closePool } from "../lib/pg/client.js";
import { readResearchEvidenceRows } from "../lib/pg/research-outcomes.js";
import { buildResearchEvidenceReport } from "../lib/research-evidence-report.js";

const args = new Set(process.argv.slice(2));
const format = args.has("--markdown") ? "markdown" : "json";
if (![...args].every((value) => ["--json", "--markdown"].includes(value)) || (args.has("--json") && args.has("--markdown"))) throw new Error("Usage: node scripts/research-evidence-report.mjs [--json|--markdown]");
if (!pgConfigured()) throw new Error("not_configured: DATABASE_URL is required for the read-only research evidence report.");
try {
  const rows = await readResearchEvidenceRows({ pool: getPool() });
  const timestamps = [...rows.outcomes.map((row) => row.asOf), ...rows.observations.map((row) => row.observedAt ?? row.observed_at)].filter((value) => Number.isFinite(Date.parse(value)));
  const latestTimestamp = timestamps.reduce((latest, value) => Math.max(latest, Date.parse(value)), Number.NEGATIVE_INFINITY);
  const asOf = Number.isFinite(latestTimestamp) ? new Date(latestTimestamp).toISOString() : null;
  const built = buildResearchEvidenceReport({ metadata: { version: "research-evidence-report-v1", asOf, q007CostStatus: "not_configured" }, ...rows });
  process.stdout.write(format === "markdown" ? `${built.markdown}Content hash: ${built.contentHash}\n` : `${JSON.stringify({ report: built.report, contentHash: built.contentHash })}\n`);
} finally { await closePool(); }
