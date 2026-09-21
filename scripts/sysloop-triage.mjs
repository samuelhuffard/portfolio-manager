import fs from "node:fs";
import path from "node:path";
import { getRedis } from "../lib/redis.js";
import { upsertFindings, loadFindings, openFindingsSummary, writeFixlist } from "../lib/sysloop/findings.js";
import { abandonRunLease, acquireRunLease, completeRunLease, runClaudeJson, etToday, truncate, OPS } from "./sysloop-shared.mjs";

const PROPOSAL_DIRS = { test: OPS.proposedTests, patch: OPS.proposedPatches };

// Tier 1 — the Analyst (docs/SYSTEM-LOOP-PLAN.md §2). Runs on the Mac daily
// after the Jetson sentinel publishes its snapshot.
//
// Step 1 is DETERMINISTIC and always happens: today's anomalies are merged
// into the git-tracked findings ledger (ops/findings/) by fingerprint.
// Step 2 is the only LLM involvement, and only when something is NEW or
// REGRESSED: one `claude -p` call classifies those findings and annotates the
// ledger. Quiet day = zero LLM calls.
//
// Write surface: ops/findings/*.md and the pm:sysloop:triage:<date> rate-cap
// key. It never alerts (the sentinel already did) and never proposes patches
// (that's the weekly Researcher's job).

const EVIDENCE_BUDGET_CHARS = 16000; // ≈4k tokens
const ALLOWED_TYPES = new Set(["bug", "regression", "stale-surface", "ux", "test-gap", "doc-drift", "infra", "unknown"]);

async function main() {
  const force = process.argv.includes("--force");
  const today = etToday();

  const acquired = await acquireRunLease({
    key: `pm:sysloop:triage:${today}`,
    successTtlSeconds: 26 * 3600,
    lockTtlSeconds: 10 * 60,
    maxAttempts: 2,
    force,
  });
  if (!acquired.lease) {
    console.log(`[Triage] skipping: ${acquired.reason}`);
    return;
  }
  const lease = acquired.lease;
  let succeeded = false;
  try {
  const redis = lease.redis;
  const raw = await redis.get(`pm:sysloop:snapshot:${today}`);
  const snapshot = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
  if (!snapshot) {
    // Jetson silent is the cross-watch's alert, not ours — just don't invent work.
    console.log(`[Triage] no snapshot for ${today} — nothing to triage`);
    return;
  }

  // ── Step 1: deterministic ledger merge ────────────────────────────────────
  const { created, updated, regressed } = upsertFindings(OPS.findings, snapshot.anomalies, new Date());
  console.log(`[Triage] ledger merge: ${created.length} new, ${updated.length} recurring, ${regressed.length} regressed (${snapshot.anomalies.length} anomalies today)`);

  writeFixlist({ findingsDir: OPS.findings, proposalDirs: PROPOSAL_DIRS });

  const needsAnalysis = [...created, ...regressed];
  if (needsAnalysis.length === 0) {
    console.log("[Triage] nothing new or regressed — no LLM call today");
    succeeded = true;
    return;
  }

  // ── Step 2: one claude -p classification call over summarized evidence ────
  const anomalyByFp = new Map(snapshot.anomalies.map((a) => [a.fingerprint, a]));
  const evidence = needsAnalysis.map((meta) => ({
    fingerprint: meta.fingerprint,
    id: meta.id,
    status: meta.status,
    severity: meta.severity,
    check: meta.check,
    title: meta.title,
    detail: anomalyByFp.get(meta.fingerprint)?.detail ?? "",
  }));
  const context = {
    openFindings: openFindingsSummary(OPS.findings, 30).map((f) => `${f.id} [${f.severity}/${f.status}] ${f.title}`),
    topErrorClusters: (snapshot.clusters ?? []).slice(0, 8).map((c) => `${c.count}× ${c.exemplar}`),
    statsBySeverity: snapshot.stats?.bySeverity ?? {},
  };

  const prompt = truncate(
    `You are the Analyst tier of Portfolio Manager's system-maintenance loop (see docs/SYSTEM-LOOP-PLAN.md).
This repo is a real-money trading research backend. You have READ-ONLY repo access (Read/Grep/Glob) to verify hypotheses about the findings below — the deterministic sentinel detected them tonight.

For each finding, classify it and suggest the single most useful next step for the human maintainer.

Rules:
- type must be one of: bug, regression, stale-surface, ux, test-gap, doc-drift, infra, unknown
- You may NOT raise severity. You may suggest lowering it with justification.
- Base notes only on the evidence given plus what you verify in the repo. If you cannot verify, say so — do not speculate confidently.
- Do not propose code changes here; that is the weekly Researcher's job.

Respond with ONLY a JSON object, no prose:
{"classifications":[{"fingerprint":"...","type":"...","note":"1-3 sentences","suggestedNextStep":"one imperative sentence","severitySuggestion":"P0|P1|P2|P3 or null"}]}

## New/regressed findings tonight
${JSON.stringify(evidence, null, 1)}

## Context (do not classify these)
${JSON.stringify(context, null, 1)}`,
    EVIDENCE_BUDGET_CHARS
  );

  const result = await runClaudeJson({ prompt, role: "triage" });
  if (!result || !Array.isArray(result.classifications)) {
    console.error("[Triage] no valid classifications returned — ledger keeps deterministic data only");
    process.exitCode = 1;
    return;
  }

  // ── Apply annotations (validated; unknown fingerprints ignored) ───────────
  const validFps = new Set(needsAnalysis.map((m) => m.fingerprint));
  const findings = loadFindings(OPS.findings);
  let applied = 0;
  for (const c of result.classifications) {
    if (!validFps.has(c.fingerprint)) continue; // model may not invent targets
    const f = findings.find((x) => x.meta.fingerprint === c.fingerprint);
    if (!f) continue;
    const type = ALLOWED_TYPES.has(c.type) ? c.type : "unknown";
    const file = path.join(OPS.findings, f.file);
    let text = fs.readFileSync(file, "utf8");
    text = text.replace(/^type: .*$/m, `type: ${type}`);
    text += `\n## Analyst note (${today})\n\n${String(c.note ?? "").slice(0, 600)}\n\n**Next step:** ${String(c.suggestedNextStep ?? "").slice(0, 300)}\n`;
    if (c.severitySuggestion && c.severitySuggestion !== f.meta.severity) {
      text += `\n**Severity suggestion:** ${c.severitySuggestion} (analyst; deterministic severity ${f.meta.severity} stands until Sam edits it)\n`;
    }
    fs.writeFileSync(file, text);
    applied += 1;
  }
  console.log(`[Triage] annotated ${applied}/${needsAnalysis.length} findings`);
  writeFixlist({ findingsDir: OPS.findings, proposalDirs: PROPOSAL_DIRS }); // pick up analyst next-steps
  succeeded = true;
  } finally {
    if (succeeded) await completeRunLease(lease);
    else await abandonRunLease(lease);
  }
}

main().catch((e) => {
  console.error("[Triage] crashed:", e);
  process.exitCode = 1;
});
