/**
 * Read-only client for Athena's machine-to-machine agent API. Athena is a
 * separate, locally-hosted stock-research platform (advisory-only, no
 * execution surface) that exposes a token-guarded per-ticker dossier endpoint
 * (GET /api/agent/ticker/{ticker}: decision, valuation, underwriting, peers,
 * positioning, earnings).
 *
 * OFF unless ATHENA_ENABLED=true AND both ATHENA_AGENT_URL and
 * ATHENA_SERVICE_TOKEN are set. Credentials alone never activate an optional
 * evidence source in production.
 *
 * Athena output is EXTERNAL UNTRUSTED TEXT like any other fetched evidence:
 * everything from here must pass sanitizeEvidenceItems + fenceUntrusted before
 * a model sees it. It can inform the generator's proposal but never gates
 * anything — the risk engine and evaluator downstream are unchanged, so it
 * can only ever be argued against, never used to upgrade an action.
 *
 * Pure normalization is tested in tests/athena.test.js.
 */

const ATHENA_TIMEOUT_MS = 15_000;
const MAX_EVIDENCE_ITEMS = 6;
const MAX_ITEM_CHARS = 500;

// A per-share valuation more than 10x off the live quote, or an implied
// upside/downside beyond this magnitude, is treated as a methodology error
// (e.g. the observed BRK-A/BRK-B per-share conflation) rather than signal —
// dropped before it can reach the generator as "independent research".
const MAX_PLAUSIBLE_UPSIDE_PCT = 300;
const MAX_PLAUSIBLE_PRICE_RATIO = 10;
const PRICE_FIELD_RE = /price|value|target|fairvalue/i;
const UPSIDE_FIELD_RE = /upside|downside/i;

/**
 * Pure: recursively walks an Athena dossier section for numeric fields that
 * look like a per-share valuation or an implied upside/downside percentage,
 * and returns the ones that are implausible given the live quote price.
 * Schema-agnostic by design (Athena's shape can evolve) — keys are matched
 * by name, not a fixed contract.
 */
export function findImplausibleValuationFields(value, livePrice, path = []) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((v) => findImplausibleValuationFields(v, livePrice, path));
  }
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, v]) => findImplausibleValuationFields(v, livePrice, [...path, key]));
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return [];
  const key = path[path.length - 1] ?? "";
  if (UPSIDE_FIELD_RE.test(key) && Math.abs(value) > MAX_PLAUSIBLE_UPSIDE_PCT) {
    return [{ path: path.join("."), value, reason: `${Math.abs(value)}% implied upside/downside exceeds the ${MAX_PLAUSIBLE_UPSIDE_PCT}% plausibility ceiling` }];
  }
  if (PRICE_FIELD_RE.test(key) && Number.isFinite(livePrice) && livePrice > 0) {
    const ratio = value / livePrice;
    if (ratio > MAX_PLAUSIBLE_PRICE_RATIO || ratio < 1 / MAX_PLAUSIBLE_PRICE_RATIO) {
      return [{ path: path.join("."), value, reason: `$${value} is ${ratio.toFixed(1)}x the live price ($${livePrice}) — implausible per-share figure` }];
    }
  }
  return [];
}

/**
 * Per-run circuit for optional Athena evidence. A local Athena outage must
 * never turn a research scan into N sequential 15-second timeouts. Callers
 * create one circuit for one scan and pass it to each dossier fetch.
 */
export function createAthenaCircuit({ failureThreshold = 2 } = {}) {
  let failures = 0;
  let skipped = 0;
  let opened = false;
  return {
    get open() { return opened; },
    get failures() { return failures; },
    get skipped() { return skipped; },
    recordFailure(reason) {
      failures += 1;
      if (!opened && failures >= failureThreshold) {
        opened = true;
        console.warn(`[Athena] advisory evidence circuit opened after ${failures} failure(s); skipping remaining dossier fetches this run. Last error: ${reason}`);
      }
    },
    recordSkip() { skipped += 1; },
    summary() { return { failures, skipped, open: opened }; },
  };
}

/** Returns { url, token } only after explicit opt-in and complete config. */
export function getAthenaConfig(env = process.env) {
  if (env.ATHENA_ENABLED?.trim().toLowerCase() !== "true") return null;
  const url = env.ATHENA_AGENT_URL?.trim();
  const token = env.ATHENA_SERVICE_TOKEN?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

/** Shared GET against an Athena agent-API path. Returns parsed JSON or null; never throws. */
async function athenaGet(path, { fetchImpl = fetch, env = process.env, timeoutMs = ATHENA_TIMEOUT_MS, onFailure, quiet = false } = {}) {
  const config = getAthenaConfig(env);
  if (!config) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${config.url}${path}`, {
        headers: { Authorization: `Bearer ${config.token}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    const reason = err?.name === "AbortError" ? `timeout after ${timeoutMs}ms` : err.message;
    onFailure?.(reason);
    if (!quiet) console.error(`[Athena] GET ${path} failed (continuing without): ${reason}`);
    return null;
  }
}

/**
 * Fetches Athena's dossier for one ticker. Advisory evidence only: any failure
 * returns null loudly and the scan proceeds exactly as it would without Athena.
 */
export async function fetchAthenaDossier(ticker, opts = {}) {
  const circuit = opts.circuit;
  if (circuit?.open) {
    circuit.recordSkip();
    return null;
  }
  return athenaGet(`/api/agent/ticker/${encodeURIComponent(ticker)}`, {
    ...opts,
    quiet: Boolean(circuit),
    onFailure: (reason) => circuit?.recordFailure(reason),
  });
}

/**
 * Fetches Athena's own analyst-pipeline health/coverage snapshot: analyst_ok,
 * decisions count, complete_underwritings, graded_outcomes, calibration_ready,
 * last_activity. Informational only (surfaced on our /health, never gates
 * anything) — this is the one other agent-API route a PARTNER token can reach;
 * Athena's /api/agent/signals, /watchlist, and /portfolio are suite-scope only
 * (reserved for its own JARVIS umbrella assistant — see Athena's api/deps.py
 * require_suite_scope), so those are intentionally not wired in here.
 *
 * Called from our own /health, so pass a short timeoutMs (server.js uses ~3s)
 * — /health must stay fast and must never block on a slow/unreachable Athena.
 */
export async function fetchAthenaStatus(opts = {}) {
  return athenaGet("/api/agent/status", opts);
}

/**
 * Pure: flattens a dossier response into evidence items ({ section, content })
 * for sanitizeEvidenceItems. Deliberately schema-agnostic — Athena's response
 * shape can evolve without breaking this side; every section is treated as an
 * opaque blob of untrusted text, size-capped so one dossier can't flood the prompt.
 */
export function athenaDossierToEvidence(dossier, { maxItems = MAX_EVIDENCE_ITEMS, maxChars = MAX_ITEM_CHARS, livePrice = null } = {}) {
  if (!dossier || typeof dossier !== "object" || Array.isArray(dossier)) return { items: [], flags: [] };
  const items = [];
  const flags = [];
  for (const [section, value] of Object.entries(dossier)) {
    if (value == null || section === "ticker") continue;
    const implausible = findImplausibleValuationFields(value, livePrice, [section]);
    if (implausible.length) {
      flags.push({ section, reasons: implausible.map((f) => f.reason) });
      continue; // drop the whole section rather than surgically edit out one field
    }
    const content = (typeof value === "string" ? value : JSON.stringify(value)).slice(0, maxChars);
    if (!content || content === "{}" || content === "[]") continue;
    items.push({ section, content });
    if (items.length >= maxItems) break;
  }
  return { items, flags };
}
