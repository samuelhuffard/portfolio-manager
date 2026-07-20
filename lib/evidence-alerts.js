const EVIDENCE_TELEGRAM_THRESHOLD = 3;

function normalizeReason(reasons) {
  return (reasons ?? [])
    .map((reason) => String(reason ?? "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(" | ");
}

/**
 * Return a stable source/root-cause key so one shared prompt problem does not
 * masquerade as many independent incidents merely because every ticker sees it.
 */
export function evidenceFlagRootCause(flag) {
  const kind = String(flag?.kind ?? "evidence").trim().toLowerCase();
  const family = kind.split(":")[0] || "evidence";
  const reason = normalizeReason(flag?.reasons);
  if (/untrusted[- ]memory|durable (?:agent )?memory|persistent memory/.test(reason)) {
    return { key: `${family}:untrusted-memory`, family, label: `${family}:untrusted-memory` };
  }
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
  return flags.some((flag) => String(flag?.kind ?? "").startsWith("evaluator:"))
    || summary.uniqueCount >= EVIDENCE_TELEGRAM_THRESHOLD;
}

export function formatEvidenceFlagSummary(summary) {
  return summary.roots
    .map((root) => `${root.label} (${root.count})`)
    .join(", ");
}
