import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getRedis } from "../lib/redis.js";
import { openFindingsSummary, loadFindings } from "../lib/sysloop/findings.js";
import { acquireRateCap, runClaudeJson, etToday, isoWeek, gitLog, telegramSafe, truncate, REPO_ROOT, OPS, SYSLOOP_MODEL } from "./sysloop-shared.mjs";

// Tier 2 — the Researcher + Skeptic (docs/SYSTEM-LOOP-PLAN.md §2). Sundays on
// the Mac. Reasons over the week's snapshots + findings ledger + commit
// history and produces the durable artifacts:
//   - ops/reports/<isoWeek>-product-health.md
//   - ops/proposed-tests/*.test.js and ops/proposed-patches/*.md (skeptic-gated)
//   - Obsidian vault appends (Projects note + monthly log)
//
// Everything it writes is a PROPOSAL for Sam. It never touches lib/ jobs/
// config/ tests/, never runs git write commands, never deploys.

const RESEARCH_BUDGET_CHARS = 48000; // ≈12k tokens
const ALLOWED_KINDS = new Set(["test", "patch", "doc", "risk-register"]);
const VAULT_DIR = (process.env.SYSLOOP_VAULT_DIR ?? path.join(os.homedir(), "Claude Memory")).trim();

async function gatherWeek(redis) {
  const days = [];
  for (let back = 6; back >= 0; back--) {
    const date = etToday(new Date(Date.now() - back * 86400000));
    const raw = await redis.get(`pm:sysloop:snapshot:${date}`).catch(() => null);
    if (raw) days.push(typeof raw === "string" ? JSON.parse(raw) : raw);
  }
  return days;
}

function condenseWeek(days) {
  const allAnomalies = new Map();
  for (const d of days) {
    for (const a of d.anomalies ?? []) {
      const e = allAnomalies.get(a.fingerprint);
      if (e) e.days += 1;
      else allAnomalies.set(a.fingerprint, { ...a, days: 1 });
    }
  }
  return {
    snapshotDays: days.map((d) => ({ date: d.date, bySeverity: d.stats?.bySeverity ?? {}, errorClusters: d.stats?.errorClusterCount })),
    distinctAnomalies: [...allAnomalies.values()].map((a) => ({ severity: a.severity, check: a.check, title: a.title, detail: a.detail, daysSeen: a.days, fingerprint: a.fingerprint })),
  };
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

async function main() {
  const force = process.argv.includes("--force");
  const week = isoWeek();

  if (!force && !(await acquireRateCap(`pm:sysloop:weekly:${week}`, 8 * 24 * 3600))) {
    console.log("[Weekly] already ran this ISO week (or Redis down) — skipping");
    return;
  }
  const redis = getRedis();
  if (!redis) throw new Error("Redis not configured");

  const days = await gatherWeek(redis);
  const condensed = condenseWeek(days);
  const open = openFindingsSummary(OPS.findings, 40);
  const findingBodies = loadFindings(OPS.findings)
    .filter((f) => open.some((o) => o.id === f.meta.id))
    .map((f) => `### ${f.meta.id} [${f.meta.severity}/${f.meta.status}] ${f.meta.title}\n${truncate(f.body, 1200)}`)
    .join("\n\n");
  const [backendLog, dashboardLog] = await Promise.all([
    gitLog(REPO_ROOT),
    gitLog(path.resolve(REPO_ROOT, "..", "portfolio-dashboard")),
  ]);

  if (days.length === 0 && open.length === 0) {
    console.log("[Weekly] no snapshots and no open findings — writing a minimal report, no LLM");
    writeReport(week, `# Product health — ${week}\n\nNo sentinel snapshots this week and no open findings. Either the system was perfectly healthy and freshly deployed, or the sentinel is not running — verify \`pm:sysloop:last-run\`.\n`, [], []);
    return;
  }

  // ── Researcher ─────────────────────────────────────────────────────────────
  const researchPrompt = truncate(
    `You are the Researcher tier of Portfolio Manager's system-maintenance loop (docs/SYSTEM-LOOP-PLAN.md).
This is a real-money trading research system: Jetson backend (this repo), Vercel dashboard (../portfolio-dashboard), Mac executor. You have READ-ONLY repo access (Read/Grep/Glob) — verify claims against actual code before making them.

Produce this week's product-health report and durable improvement proposals.

Report requirements (markdown): a short health summary; cron/uptime reliability read from the snapshot stats; findings review (what's new, what's recurring, what regressed); error-cluster trends; and a "Top 3 recommended actions" section. Write for Sam — direct, concrete, no filler.

Proposal rules:
- kinds: "test" (a runnable failing/regression test skeleton for node:test), "patch" (a described fix — unified diff if you are CONFIDENT of exact file contents, otherwise a precise change description), "doc" (doc correction), "risk-register" (new/changed RISK_REGISTER.md entries as a diff-style block).
- Propose a test for ANY finding with daysSeen >= 2 or status regressed.
- Never propose changes that weaken auth, signatures, risk limits, or the approval boundary (docs/INVARIANTS.md). Flag but do not fix money-path issues.
- Max 5 proposals. Fewer, better-verified proposals beat many speculative ones.

Respond with ONLY JSON:
{"report_markdown":"...","proposals":[{"findingId":"F-... or null","kind":"test|patch|doc|risk-register","title":"...","content":"full file/diff/description content","rationale":"why this is worth Sam's review time"}]}

## This week's snapshots (condensed)
${JSON.stringify(condensed, null, 1)}

## Open findings ledger
${findingBodies || "(none)"}

## Recent commits — portfolio-manager
${backendLog}

## Recent commits — portfolio-dashboard
${dashboardLog}`,
    RESEARCH_BUDGET_CHARS
  );

  const research = await runClaudeJson({ prompt: researchPrompt, role: "weekly", model: SYSLOOP_MODEL, maxTurns: 25 });
  if (!research || typeof research.report_markdown !== "string") {
    console.error("[Weekly] Researcher produced no valid output — aborting without artifacts");
    process.exitCode = 1;
    return;
  }
  const proposals = (Array.isArray(research.proposals) ? research.proposals : [])
    .filter((p) => p && ALLOWED_KINDS.has(p.kind) && p.title && p.content)
    .slice(0, 5);

  // ── Skeptic (only when there are proposals — separate call, demote-only) ──
  let verdicts = [];
  if (proposals.length > 0) {
    const invariants = fs.readFileSync(path.join(REPO_ROOT, "docs", "INVARIANTS.md"), "utf8");
    const skepticPrompt = truncate(
      `You are the Skeptic tier of Portfolio Manager's system-maintenance loop — the same role the trade evaluator plays for trade proposals. You review SYSTEM-change proposals before they reach the human. You have READ-ONLY repo access to verify.

For each proposal decide:
- "CONFIRMED": evidence checks out against the actual repo, change is minimal and safe.
- "PLAUSIBLE": reasonable but you could not fully verify.
- "REJECT": wrong, unverifiable AND risky, touches money-path/auth invariants, or bigger than the finding justifies.
You can only demote — never improve or rewrite a proposal.

Respond ONLY with JSON: {"verdicts":[{"index":0,"verdict":"CONFIRMED|PLAUSIBLE|REJECT","reason":"1-2 sentences"}]}

## Invariants (violations = automatic REJECT)
${truncate(invariants, 6000)}

## Proposals
${JSON.stringify(proposals.map((p, index) => ({ index, ...p })), null, 1)}`,
      RESEARCH_BUDGET_CHARS
    );
    const skeptic = await runClaudeJson({ prompt: skepticPrompt, role: "weekly", model: SYSLOOP_MODEL, maxTurns: 20 });
    verdicts = Array.isArray(skeptic?.verdicts) ? skeptic.verdicts : [];
    if (verdicts.length === 0) {
      // Fail closed: no skeptic pass → every proposal is at most PLAUSIBLE.
      console.error("[Weekly] Skeptic produced no verdicts — all proposals marked PLAUSIBLE (unverified)");
      verdicts = proposals.map((_, index) => ({ index, verdict: "PLAUSIBLE", reason: "skeptic pass failed — unverified" }));
    }
  }

  // ── Write artifacts ────────────────────────────────────────────────────────
  const written = [];
  for (const [index, p] of proposals.entries()) {
    const v = verdicts.find((x) => x.index === index) ?? { verdict: "PLAUSIBLE", reason: "no verdict returned" };
    if (v.verdict === "REJECT") {
      console.log(`[Weekly] skeptic REJECTED "${p.title}": ${v.reason}`);
      continue;
    }
    const dir = p.kind === "test" ? OPS.proposedTests : OPS.proposedPatches;
    const ext = p.kind === "test" ? "test.js" : "md";
    const file = path.join(dir, `${week}-${slugify(p.title)}.${ext}`);
    const header = p.kind === "test"
      ? `// PROPOSED by sysloop weekly ${week} — review before moving into tests/\n// Finding: ${p.findingId ?? "n/a"} · Skeptic: ${v.verdict} (${v.reason})\n// Rationale: ${p.rationale}\n\n`
      : `# ${p.title}\n\n> PROPOSED by sysloop weekly ${week} — for Sam's review, not applied.\n> Kind: ${p.kind} · Finding: ${p.findingId ?? "n/a"} · Skeptic: ${v.verdict} (${v.reason})\n> Rationale: ${p.rationale}\n\n`;
    fs.writeFileSync(file, header + p.content + "\n");
    written.push({ ...p, file: path.relative(REPO_ROOT, file), verdict: v.verdict });
  }

  writeReport(week, research.report_markdown, written, open);
  appendToVault(week, research.report_markdown, written, open);

  const summary = `Sysloop weekly ${week}: ${open.length} open findings, ${written.length}/${proposals.length} proposals passed skeptic. Report: ops/reports/${week}-product-health.md`;
  console.log(`[Weekly] ${summary}`);
  await telegramSafe(summary);
}

function writeReport(week, reportMarkdown, written, open) {
  const proposalIndex = written.length
    ? `\n\n## Proposals written this week\n\n${written.map((p) => `- **${p.kind}** [${p.verdict}] ${p.title} → \`${p.file}\``).join("\n")}\n`
    : "\n\n## Proposals written this week\n\n(none)\n";
  const head = `<!-- generated by scripts/sysloop-weekly.mjs on ${new Date().toISOString()} — open findings: ${open.length} -->\n\n`;
  fs.mkdirSync(OPS.reports, { recursive: true });
  fs.writeFileSync(path.join(OPS.reports, `${week}-product-health.md`), head + reportMarkdown + proposalIndex);
  console.log(`[Weekly] wrote ops/reports/${week}-product-health.md`);
}

function appendToVault(week, reportMarkdown, written, open) {
  try {
    if (!fs.existsSync(VAULT_DIR)) {
      console.error(`[Weekly] vault not found at ${VAULT_DIR} — skipping Obsidian update`);
      return;
    }
    const summaryLine = `- ${etToday()} sysloop ${week}: ${open.length} open findings, ${written.length} proposals — see \`portfolio-manager/ops/reports/${week}-product-health.md\``;
    const projectNote = path.join(VAULT_DIR, "Projects", "portfolio-manager.md");
    if (fs.existsSync(projectNote)) {
      let text = fs.readFileSync(projectNote, "utf8");
      if (!text.includes("## Sysloop weekly health")) text += `\n\n## Sysloop weekly health\n`;
      text += `${summaryLine}\n`;
      fs.writeFileSync(projectNote, text);
    }
    const monthLog = path.join(VAULT_DIR, "Logs", `${etToday().slice(0, 7)}.md`);
    if (fs.existsSync(monthLog)) {
      fs.appendFileSync(monthLog, `\n${summaryLine}\n`);
    }
    console.log("[Weekly] vault updated");
  } catch (e) {
    console.error("[Weekly] vault update failed:", e.message);
  }
}

main().catch((e) => {
  console.error("[Weekly] crashed:", e);
  process.exit(1);
});
