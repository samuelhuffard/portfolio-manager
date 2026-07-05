import fs from "node:fs";
import path from "node:path";

// Findings ledger — the system loop's durable memory (docs/SYSTEM-LOOP-PLAN.md §6).
// One markdown file per finding under ops/findings/, git-tracked, keyed by
// fingerprint. Maintained DETERMINISTICALLY (the LLM tiers only annotate).
//
// Lifecycle: open → ack (Sam edits status) → fixed (Sam edits status)
//            fixed → regressed (automatic, when the fingerprint reappears)

const SEV_ORDER = ["P0", "P1", "P2", "P3"];

function bumpSeverity(sev) {
  const i = SEV_ORDER.indexOf(sev);
  return SEV_ORDER[Math.max(0, i - 1)] ?? sev;
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

export function parseFinding(md) {
  const m = String(md).match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (kv) {
      let value = kv[2];
      if (value.startsWith('"')) {
        try { value = JSON.parse(value); } catch { value = value.replace(/^"|"$/g, ""); }
      }
      meta[kv[1]] = value;
    }
  }
  meta.occurrences = Number(meta.occurrences ?? 1);
  return { meta, body: m[2] ?? "" };
}

export function serializeFinding({ meta, body }) {
  const keys = ["id", "fingerprint", "check", "type", "severity", "status", "firstSeen", "lastSeen", "occurrences", "title"];
  const fm = keys.map((k) => `${k}: ${k === "title" ? JSON.stringify(String(meta[k] ?? "")) : meta[k] ?? ""}`).join("\n");
  return `---\n${fm}\n---\n${body}`;
}

export function loadFindings(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f.startsWith("F-"))
    .map((file) => {
      const parsed = parseFinding(fs.readFileSync(path.join(dir, file), "utf8"));
      return parsed ? { file, ...parsed } : null;
    })
    .filter(Boolean);
}

function nextId(findings, year) {
  const seqs = findings
    .map((f) => (f.meta.id?.startsWith(`F-${year}-`) ? Number(f.meta.id.split("-")[2]) : 0))
    .filter(Number.isFinite);
  return `F-${year}-${String(Math.max(0, ...seqs) + 1).padStart(3, "0")}`;
}

/**
 * Deterministically merges today's anomalies into the ledger.
 * Returns { created, updated, regressed } (arrays of finding meta) so the
 * caller can alert on exactly the deltas — never on repeats.
 */
export function upsertFindings(dir, anomalies, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const findings = loadFindings(dir);
  const byFp = new Map(findings.map((f) => [f.meta.fingerprint, f]));
  const nowIso = now.toISOString();
  const created = [], updated = [], regressed = [];

  // Collapse duplicate fingerprints within one run (e.g. two stuck proposals
  // hitting the same seed) into a single occurrence.
  const seen = new Map();
  for (const a of anomalies) if (!seen.has(a.fingerprint)) seen.set(a.fingerprint, a);

  for (const a of seen.values()) {
    const existing = byFp.get(a.fingerprint);
    if (!existing) {
      const id = nextId([...findings, ...created.map((meta) => ({ meta }))], now.getFullYear());
      const meta = {
        id, fingerprint: a.fingerprint, check: a.check, type: a.check, severity: a.severity,
        status: "open", firstSeen: nowIso, lastSeen: nowIso, occurrences: 1, title: a.title,
      };
      const body = `\n# ${a.title}\n\n**Check:** ${a.check} · **Severity:** ${a.severity}\n\n## Evidence\n\n- ${nowIso} — ${a.detail}\n`;
      fs.writeFileSync(path.join(dir, `${id}-${slugify(a.title)}.md`), serializeFinding({ meta, body }));
      created.push(meta);
      continue;
    }

    const { meta } = existing;
    meta.lastSeen = nowIso;
    meta.occurrences += 1;
    if (SEV_ORDER.indexOf(a.severity) < SEV_ORDER.indexOf(meta.severity)) meta.severity = a.severity;
    if (meta.status === "fixed") {
      // A fix that didn't hold is worse than the original problem.
      meta.status = "regressed";
      meta.severity = bumpSeverity(meta.severity);
      regressed.push(meta);
    } else {
      updated.push(meta);
    }
    let body = existing.body;
    const evidenceLines = (body.match(/^- \d{4}-/gm) ?? []).length;
    if (evidenceLines < 10) body += `- ${nowIso} — ${a.detail}\n`;
    fs.writeFileSync(path.join(dir, existing.file), serializeFinding({ meta, body }));
  }

  return { created, updated, regressed };
}

export function openFindingsSummary(dir, limit = 50) {
  return loadFindings(dir)
    .filter((f) => f.meta.status === "open" || f.meta.status === "regressed" || f.meta.status === "ack")
    .sort((a, b) => SEV_ORDER.indexOf(a.meta.severity) - SEV_ORDER.indexOf(b.meta.severity))
    .slice(0, limit)
    .map((f) => ({ ...f.meta, file: f.file }));
}

// ── FIXLIST.md — the single human/agent-readable view of the ledger ─────────
// Sam reads this file to see everything the loop wants fixed; Claude Code
// sessions read it (pointer in CLAUDE.md) to judge whether items need fixing.
// Always regenerated from the finding files — never edited directly.

function nextStepFrom(body) {
  const matches = [...String(body).matchAll(/\*\*Next step:\*\* (.+)/g)];
  return matches.length ? matches[matches.length - 1][1].trim() : null;
}

export function renderFixlist({ findingsDir, proposalDirs = {} }) {
  const findings = loadFindings(findingsDir);
  const bySev = (a, b) =>
    SEV_ORDER.indexOf(a.meta.severity) - SEV_ORDER.indexOf(b.meta.severity) ||
    String(a.meta.id).localeCompare(String(b.meta.id));
  const needsAttention = findings.filter((f) => f.meta.status === "open" || f.meta.status === "regressed").sort(bySev);
  const acked = findings.filter((f) => f.meta.status === "ack").sort(bySev);
  const fixed = findings
    .filter((f) => f.meta.status === "fixed")
    .sort((a, b) => String(b.meta.lastSeen).localeCompare(String(a.meta.lastSeen)))
    .slice(0, 10);

  const line = (f, checkbox = true) => {
    const m = f.meta;
    const flag = m.status === "regressed" ? " **REGRESSED**" : "";
    const step = nextStepFrom(f.body);
    return (
      `- ${checkbox ? "[ ] " : ""}**${m.severity}**${flag} \`${m.id}\` [${m.type}] ${m.title}` +
      ` — seen ${m.occurrences}×, ${String(m.firstSeen).slice(0, 10)} → ${String(m.lastSeen).slice(0, 10)}` +
      (step ? `\n  - Next step: ${step}` : "") +
      `\n  - Details: \`ops/findings/${f.file}\``
    );
  };

  const proposalLines = [];
  for (const [label, dir] of Object.entries(proposalDirs)) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((x) => !x.startsWith("."))) {
      proposalLines.push(`- **${label}** \`${path.join(path.basename(path.dirname(path.join(dir, file))), file)}\` — review, then move into tests/ or apply, or delete to reject`);
    }
  }

  return `<!-- AUTO-GENERATED by lib/sysloop/findings.js — do NOT edit this file by hand.
     To change an item's status, edit the "status:" line in its ops/findings/*.md file
     (open → ack → fixed), then run: npm run sysloop:fixlist -->

# Portfolio Manager — Fix List

_Regenerated ${new Date().toISOString()} · ${needsAttention.length} need attention · ${acked.length} acknowledged · ${fixed.length} recently fixed_

**For Claude Code sessions:** these are system-loop findings (docs/SYSTEM-LOOP-PLAN.md), detected by deterministic checks and deduped by fingerprint. For each item under "Needs attention", judge whether it warrants fixing in your current session: read the linked finding file for evidence, verify against live state before acting (checks are point-in-time), and respect docs/INVARIANTS.md on anything money-path. When you fix one: set its \`status: fixed\`, note the fix in the finding file, run \`npm run sysloop:fixlist\`. If a fixed item's fingerprint reappears, the loop auto-escalates it to regressed.

## Needs attention

${needsAttention.length ? needsAttention.map((f) => line(f)).join("\n") : "(none — clean)"}

## Acknowledged (known, deliberately not fixed yet)

${acked.length ? acked.map((f) => line(f, false)).join("\n") : "(none)"}

## Proposed fixes awaiting review

${proposalLines.length ? proposalLines.join("\n") : "(none yet — the weekly Researcher writes these on Sundays)"}

## Recently fixed (watching for regression)

${fixed.length ? fixed.map((f) => line(f, false)).join("\n") : "(none yet)"}
`;
}

export function writeFixlist({ findingsDir, proposalDirs, outFile }) {
  const target = outFile ?? path.join(path.dirname(findingsDir), "FIXLIST.md");
  fs.writeFileSync(target, renderFixlist({ findingsDir, proposalDirs }));
  return target;
}
