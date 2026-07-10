import { createHash } from "node:crypto";

// Fingerprinting exists so the same problem seen twice is ONE finding with two
// occurrences, not two findings. Everything volatile (timestamps, ids, numbers)
// must normalize away or recurrence detection breaks.

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const ISO_TS_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const DATE_RE = /\d{4}-\d{2}-\d{2}/g;
const CLOCK_RE = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?\b/gi;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX_RE = /\b[0-9a-f]{8,}\b/gi;
const NUM_RE = /(?<![A-Za-z])[-+]?\d+(?:\.\d+)?%?/g;
const LABELED_TICKER_RE = /\b(news|scan|model|ticker)([:=])[A-Z][A-Z0-9.-]{0,9}\b/g;
const FOR_TICKER_RE = /\bfor\s+[A-Z][A-Z0-9.-]{0,9}\b/g;

export function normalizeLine(line) {
  return String(line)
    .replace(ANSI_RE, "")
    .replace(ISO_TS_RE, "<ts>")
    .replace(DATE_RE, "<date>")
    .replace(CLOCK_RE, "<time>")
    .replace(UUID_RE, "<uuid>")
    .replace(HEX_RE, "<hex>")
    .replace(LABELED_TICKER_RE, "$1$2<ticker>")
    .replace(FOR_TICKER_RE, "for <ticker>")
    .replace(NUM_RE, "#")
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprint(text) {
  return createHash("sha1").update(String(text).toLowerCase()).digest("hex").slice(0, 12);
}

export function fingerprintLine(line) {
  return fingerprint(normalizeLine(line));
}

/**
 * Groups raw log lines into clusters keyed by normalized-line fingerprint.
 * Returns [{ fingerprint, exemplar, count }] sorted by count desc.
 * The exemplar is the FIRST raw line seen — kept verbatim for humans, but the
 * LLM tiers only ever receive exemplars (never whole logs).
 */
export function clusterLogLines(lines) {
  const clusters = new Map();
  for (const raw of lines) {
    const line = String(raw).trim();
    if (!line) continue;
    const fp = fingerprintLine(line);
    const existing = clusters.get(fp);
    if (existing) existing.count += 1;
    else clusters.set(fp, { fingerprint: fp, exemplar: line.slice(0, 300), count: 1 });
  }
  return [...clusters.values()].sort((a, b) => b.count - a.count);
}
