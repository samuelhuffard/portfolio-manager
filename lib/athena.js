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

/** Returns { url, token } when Athena is fully configured, else null. */
export function getAthenaConfig(env = process.env) {
  const url = env.ATHENA_AGENT_URL?.trim();
  const token = env.ATHENA_SERVICE_TOKEN?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

/**
 * Fetches Athena's dossier for one ticker. Advisory evidence only: any failure
 * returns null loudly and the scan proceeds exactly as it would without Athena.
 */
export async function fetchAthenaDossier(ticker, { fetchImpl = fetch, env = process.env } = {}) {
  const config = getAthenaConfig(env);
  if (!config) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATHENA_TIMEOUT_MS);
    let res;
    try {
      // format=compact: Athena returns flat conclusion-first strings sized for this
      // adapter's 6-item x 500-char budget (older Athena ignores the param and
      // returns the rich shape, which still works — just spends budget on JSON syntax).
      res = await fetchImpl(`${config.url}/api/agent/ticker/${encodeURIComponent(ticker)}?format=compact`, {
        headers: { Authorization: `Bearer ${config.token}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    // Loud degrade: an Athena outage must not fail the scan, but must not
    // silently remove an evidence source either.
    console.error(`[Athena] dossier fetch failed for ${ticker} (continuing without): ${err.message}`);
    return null;
  }
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
