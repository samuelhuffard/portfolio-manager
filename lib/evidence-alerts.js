const EVIDENCE_TELEGRAM_THRESHOLD = 3;

function normalizeReason(reasons) {
  return (reasons ?? [])
    .map((reason) => String(reason ?? "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(" | ");
}

/**
 * Returns a stable root-cause key for alert escalation. The raw flag stays in
 * the audit log; this key only prevents one shared prompt/source problem from
 * looking like many independent incidents because it appears for every ticker.
 */
export function evidenceFlagRootCause(flag) {
  const kind = String(flag?.kind ?? "evidence").trim().toLowerCase();
  const family = kind.split(":")[0] || "evidence";
  const reason = normalizeReason(flag?.reasons);

  // Durable memory is global to an agent scan. A model will legitimately
  // report the same fenced memory on each reviewed ticker, so it is one root
  // cause, not one incident per ticker.
  if (/untrusted[- ]memory|durable (?:agent )?memory|persistent memory/.test(reason)) {
    return { key: `${family}:untrusted-memory`, family, label: `${family}:untrusted-memory` };
  }

  // Kinds include ticker names (for example model:NVDA). Pairing the source
  // family with the reason keeps identical source failures together without
  // collapsing genuinely different evidence problems.
  return { key: `${family}:${reason || kind}`, family, label: family };
}

export function summarizeEvidenceFlags(flags = []) {
  const roots = new Map();
  for (const flag of flags) {
    const root = evidenceFlagRootCause(flag);
    const existing = roots.get(root.key) ?? { ...root, count: 0 };
    existing.count += 1;
    roots.set(root.key, existing);
  }
  return {
    rawCount: flags.length,
    roots: [...roots.values()],
    uniqueCount: roots.size,
  };
}

export function shouldTelegramEvidenceFlags(flags = []) {
  const summary = summarizeEvidenceFlags(flags);
  // An independent evaluator seeing suspect evidence remains an immediate
  // escalation, regardless of grouping. Otherwise require several distinct
  // source/root-cause failures rather than repeated per-ticker telemetry.
  return flags.some((flag) => String(flag?.kind ?? "").startsWith("evaluator:"))
    || summary.uniqueCount >= EVIDENCE_TELEGRAM_THRESHOLD;
}

export function formatEvidenceFlagSummary(summary) {
  return summary.roots
    .map((root) => `${root.label} (${root.count})`)
    .join(", ");
}
