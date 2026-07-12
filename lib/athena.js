/**
 * Read-only client for Athena's machine-to-machine agent API. Athena is a
 * separate, locally-hosted stock-research platform (advisory-only, no
 * execution surface) that exposes a token-guarded per-ticker dossier endpoint
 * (GET /api/agent/ticker/{ticker}: decision, valuation, underwriting, peers,
 * positioning, earnings).
 *
 * OFF unless BOTH ATHENA_AGENT_URL and ATHENA_SERVICE_TOKEN are set — when
 * unset the research scan behaves exactly as before this file existed.
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

/** Returns { url, token } when Athena is fully configured, else null. */
export function getAthenaConfig(env = process.env) {
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
export function athenaDossierToEvidence(dossier, { maxItems = MAX_EVIDENCE_ITEMS, maxChars = MAX_ITEM_CHARS } = {}) {
  if (!dossier || typeof dossier !== "object" || Array.isArray(dossier)) return [];
  const items = [];
  for (const [section, value] of Object.entries(dossier)) {
    if (value == null || section === "ticker") continue;
    const content = (typeof value === "string" ? value : JSON.stringify(value)).slice(0, maxChars);
    if (!content || content === "{}" || content === "[]") continue;
    items.push({ section, content });
    if (items.length >= maxItems) break;
  }
  return items;
}
