/**
 * Deterministic evidence-quality policy for proposal generation.
 *
 * This module deliberately does not infer financial facts from prose.  It labels
 * evidence that is unsuitable as thesis support, exposes supplied fact conflicts,
 * and emits an explicit technical-fact packet.  Callers can safely give the packet
 * to a model: absent technical data is represented as `unavailable`, never as a
 * plausible-looking estimated number.
 */

const PRIMARY_SOURCE_TYPES = new Set([
  "sec_filing",
  "company_filing",
  "company_ir",
  "earnings_transcript",
  "exchange",
  "regulator",
]);

const CONTEXT_ONLY_SOURCE_TYPES = new Set([
  "opinion",
  "newsletter",
  "blog",
  "social",
  "aggregator",
  "promotional",
]);

const CONTEXT_ONLY_DOMAINS = new Set([
  "reddit.com",
  "x.com",
  "twitter.com",
  "stocktwits.com",
]);

// These are deliberately narrow: ordinary reporting which merely mentions an
// analyst rating remains usable.  The policy only removes language that is itself
// a recommendation, hype, or sponsored promotion.
const PROMOTIONAL_PATTERNS = [
  [/\b(?:sponsored|advertisement|paid\s+(?:post|placement|content))\b/i, "sponsored or paid promotion"],
  [/\b(?:top|best)\s+(?:stocks?|shares?)\s+to\s+buy\b/i, "listicle buy recommendation"],
  [/\b(?:buying|once-in-a-lifetime|can't-miss)\s+(?:opportunity|window|chance)\b/i, "promotional recommendation"],
  [/\b(?:could|set to|poised to)\s+(?:soar|skyrocket|explode)\b/i, "promotional price language"],
  [/\b(?:hot|must-own)\s+stock\b/i, "promotional stock language"],
];

function normaliseType(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[ -]/g, "_") : "";
}

function hostname(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function textFromEvidence(item) {
  return [item?.title, item?.summary, item?.content, item?.excerpt]
    .filter((part) => typeof part === "string")
    .join("\n");
}

/**
 * Labels one evidence item. `support: false` means the item must not be cited as
 * proof of an investment claim, although callers may still show it as context.
 */
export function classifyEvidenceQuality(item = {}) {
  const sourceType = normaliseType(item.sourceType ?? item.source_type ?? item.kind);
  const domain = hostname(item.url ?? item.sourceUrl ?? item.source_url);
  const reasons = [];

  if (CONTEXT_ONLY_SOURCE_TYPES.has(sourceType)) reasons.push(`context-only source type: ${sourceType}`);
  if (CONTEXT_ONLY_DOMAINS.has(domain)) reasons.push(`context-only domain: ${domain}`);
  for (const [pattern, reason] of PROMOTIONAL_PATTERNS) {
    if (pattern.test(textFromEvidence(item))) reasons.push(reason);
  }

  const support = reasons.length === 0;
  return {
    support,
    disposition: support ? "eligible" : "context_only",
    sourceTier: PRIMARY_SOURCE_TYPES.has(sourceType) || domain === "sec.gov" ? "primary" : "secondary",
    sourceType: sourceType || null,
    domain: domain || null,
    reasons,
  };
}

/** Returns policy labels without mutating the supplied evidence records. */
export function assessEvidenceQuality(items) {
  return (items ?? []).map((item, index) => ({
    index,
    evidenceId: item?.id ?? item?.evidenceId ?? null,
    ...classifyEvidenceQuality(item),
  }));
}

function comparableValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return { kind: "number", value };
  if (typeof value === "string" && value.trim()) return { kind: "string", value: value.trim().toLowerCase() };
  if (typeof value === "boolean") return { kind: "boolean", value };
  return null;
}

/**
 * Finds incompatible explicit facts.  Facts must have `{ field, value }`; no prose
 * parsing occurs, so a conflict is auditable rather than an LLM judgement.
 */
export function surfaceFactContradictions(facts) {
  const byField = new Map();
  for (const fact of facts ?? []) {
    const field = typeof fact?.field === "string" ? fact.field.trim() : "";
    const value = comparableValue(fact?.value);
    if (!field || !value) continue;
    const key = field.toLowerCase();
    const existing = byField.get(key) ?? [];
    existing.push({
      evidenceId: fact.evidenceId ?? fact.evidence_id ?? null,
      field,
      value: fact.value,
      asOf: fact.asOf ?? fact.as_of ?? null,
    });
    byField.set(key, existing);
  }

  const conflicts = [];
  for (const [field, entries] of byField) {
    const distinct = new Map();
    for (const entry of entries) {
      const value = comparableValue(entry.value);
      const key = `${value.kind}:${String(value.value)}`;
      if (!distinct.has(key)) distinct.set(key, entry);
    }
    if (distinct.size > 1) conflicts.push({ field, facts: [...distinct.values()] });
  }
  return conflicts;
}

function unavailable(reason, extra = {}) {
  return { status: "unavailable", value: null, reason, ...extra };
}

function available(value, extra = {}) {
  return { status: "available", value, reason: null, ...extra };
}

function recentValidCloses(bars, sessions) {
  const recent = (bars ?? []).slice(-sessions);
  if (recent.length !== sessions || recent.some((bar) => !Number.isFinite(bar?.close))) return null;
  return recent.map((bar) => bar.close);
}

/**
 * Computes only directly-supported technical facts.  A current price needs its own
 * timestamp; a bar's date is not silently substituted for a missing quote timestamp.
 *
 * Moving averages and the 52-week high prefer Yahoo's own pre-computed
 * `summaryDetail` figures (`providedSma50`/`providedSma200`/`providedHigh52Week`) —
 * free, already fetched alongside fundamentals, no extra request. The from-bars
 * reconstruction below is kept only as a fallback for the rare ticker where
 * Yahoo doesn't report one, which is why it still requires a full, gap-free
 * window rather than guessing from partial history.
 */
export function buildTechnicalFactPacket({
  bars, price, priceTimestamp, asOf = null,
  providedSma50 = null, providedSma200 = null, providedHigh52Week = null, providedAsOf = null,
} = {}) {
  const barCount = Array.isArray(bars) ? bars.length : 0;
  const closes50 = recentValidCloses(bars, 50);
  const closes200 = recentValidCloses(bars, 200);
  const closes252 = recentValidCloses(bars, 252);
  const currentPrice = Number.isFinite(price) && typeof priceTimestamp === "string" && priceTimestamp.trim()
    ? available(price, { asOf: priceTimestamp })
    : unavailable("current price and timestamp are both required", { asOf: null });

  const sma50 = Number.isFinite(providedSma50)
    ? available(providedSma50, { sessions: 50, asOf: providedAsOf ?? asOf, source: "yahoo_summary_detail" })
    : closes50
    ? available(closes50.reduce((total, close) => total + close, 0) / 50, { sessions: 50, asOf })
    : unavailable("50 consecutive valid daily closing bars are required", { sessions: barCount, asOf });

  const sma200 = Number.isFinite(providedSma200)
    ? available(providedSma200, { sessions: 200, asOf: providedAsOf ?? asOf, source: "yahoo_summary_detail" })
    : closes200
    ? available(closes200.reduce((total, close) => total + close, 0) / 200, {
        sessions: 200,
        asOf,
      })
    : unavailable("200 consecutive valid daily closing bars are required", { sessions: barCount, asOf });

  const high52Week = Number.isFinite(providedHigh52Week)
    ? available(providedHigh52Week, { sessions: 252, asOf: providedAsOf ?? asOf, source: "yahoo_summary_detail" })
    : closes252
    ? available(Math.max(...closes252), { sessions: 252, asOf })
    : unavailable("252 consecutive valid daily closing bars are required", { sessions: barCount, asOf });

  return { currentPrice, sma50, sma200, high52Week };
}

/**
 * Gives proposal writers a safe answer for a named technical claim.  Unknown names
 * and missing data are both unavailable, so callers have no route to guess.
 */
export function technicalClaimStatus(packet, claim) {
  const key = {
    price: "currentPrice",
    current_price: "currentPrice",
    sma_50: "sma50",
    "50d_sma": "sma50",
    sma_200: "sma200",
    "200d_sma": "sma200",
    high_52_week: "high52Week",
    "52_week_high": "high52Week",
  }[normaliseType(claim)];
  if (!key || !packet?.[key]) return unavailable(`technical claim is not available: ${claim}`);
  return packet[key];
}
