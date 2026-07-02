import { randomBytes } from "node:crypto";

/**
 * Untrusted-evidence handling for LLM prompts (LOOP-DESIGN.md §6).
 *
 * Everything fetched from the public internet (Tavily news text, Robinhood scan
 * notes) is DATA, never instructions. Injection can't trigger actions here —
 * the research model has no tools and its output passes a downgrade-only risk
 * engine plus human approval — but it could bias a persuasive bad proposal, so
 * we fence it, scan for instruction-shaped content deterministically, and
 * exclude anything suspicious before the model ever sees it.
 *
 * All functions are pure except makeBoundaryToken (crypto randomness).
 */

// One token per research-scan run: constant within a run so the cached system
// block (which explains the fence format) stays cache-valid across tickers.
export function makeBoundaryToken() {
  return randomBytes(8).toString("hex");
}

const INJECTION_PATTERNS = [
  [/ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|context|prompts?)/i, "ignore-previous-instructions phrasing"],
  [/disregard\s+(?:the\s+)?(?:previous|prior|above|system)/i, "disregard-prior phrasing"],
  [/\byou\s+are\s+now\b/i, "role-reassignment phrasing"],
  [/\bnew\s+instructions?\s*:/i, "inline new-instructions block"],
  [/\bsystem\s*prompt\b/i, "system-prompt reference"],
  [/<\/?\s*(?:system|assistant|instructions?)\s*>/i, "chat-role/instruction tags"],
  [/\bBEGIN\s+(?:SYSTEM|INSTRUCTIONS|PROMPT)\b/i, "BEGIN SYSTEM/INSTRUCTIONS marker"],
  [/\b(?:dear|hey|hello)\s+(?:ai|assistant|claude|model|agent)\b/i, "direct address to the AI"],
  [/\b(?:as\s+an?\s+ai|if\s+you\s+are\s+an?\s+(?:ai|llm|model))\b/i, "AI-conditional phrasing"],
  [/\brespond\s+with\s+only\b/i, "output-format override attempt"],
  [/\byou\s+must\s+(?:recommend|propose|output|say)\b/i, "imperative aimed at the recommendation"],
  [/[A-Za-z0-9+/]{160,}={0,2}/, "long base64-like blob"],
];

/** Returns a list of human-readable reasons this text looks instruction-shaped (empty = clean). */
export function detectInjectionSignals(text) {
  if (!text || typeof text !== "string") return [];
  const reasons = [];
  for (const [pattern, reason] of INJECTION_PATTERNS) {
    if (pattern.test(text)) reasons.push(reason);
  }
  return reasons;
}

/** Wraps untrusted text in per-run boundary markers the system prompt declares as data-only. */
export function fenceUntrusted(label, text, token) {
  return `<<<UNTRUSTED-${label}-${token}>>>\n${text}\n<<<END-UNTRUSTED-${label}-${token}>>>`;
}

const EXCLUDED_PLACEHOLDER = "[excluded: instruction-like content detected in this source — see scan logs]";

/**
 * Scans a list of evidence items (each with free-text fields) and redacts any
 * whose text trips the injection patterns. Returns { items, flags } where
 * flags[] describes what was redacted so the job layer can log/Telegram it.
 * `textFields` names the properties to scan and redact on each item.
 */
export function sanitizeEvidenceItems(items, { kind = "evidence", textFields = ["title", "content"] } = {}) {
  const flags = [];
  const sanitized = (items ?? []).map((item, index) => {
    const combined = textFields.map((f) => item?.[f] ?? "").join("\n");
    const reasons = detectInjectionSignals(combined);
    if (!reasons.length) return item;
    flags.push({ kind, index, reasons, excerpt: combined.slice(0, 120) });
    const redacted = { ...item };
    for (const f of textFields) {
      if (redacted[f] != null) redacted[f] = EXCLUDED_PLACEHOLDER;
    }
    return redacted;
  });
  return { items: sanitized, flags };
}
