/**
 * Daily candidate slate for catalog-sourced agents — the deterministic narrowing
 * step between the philosophy-screened universe catalog (thousands of names) and
 * the expensive fundamentals/quant/AI pipeline (~20 names). Pure and tested
 * (tests/candidate-slate.test.js).
 *
 * Bucket priority (LOOP-DESIGN funnel):
 *   1. holdings     — always reviewed, unchanged behavior.
 *   2. movers       — Robinhood scan names (outside signal). Screened again
 *                     downstream by screenUniverse at fundamentals time.
 *   3. ranked       — top screened catalog names by cheap quote signals, skipping
 *                     names researched within researchCooldownDays.
 *   4. exploration  — never-researched screened names on a deterministic daily
 *                     rotation, so the agent eventually covers its whole
 *                     wheelhouse and always looks beyond what it already knows.
 */

// Agent-1 mandate: "small and mid-cap are preferred hunting grounds."
const PREFERRED_CAP_MIN = 300_000_000;
const PREFERRED_CAP_MAX = 50_000_000_000;

function inPreferredBand(marketCap) {
  return marketCap != null && marketCap >= PREFERRED_CAP_MIN && marketCap <= PREFERRED_CAP_MAX;
}

function finiteOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function compareDescending(left, right, fallback = -Infinity) {
  const a = finiteOr(left, fallback);
  const b = finiteOr(right, fallback);
  if (a === b) return 0;
  return b > a ? 1 : -1;
}

/**
 * Research-attention ranking only. These cheap catalog facts decide which
 * companies deserve deeper work; they are not conviction or entry scores.
 */
export function rankScreenedCandidates(screened, { agentId = "agent-1" } = {}) {
  return [...screened].sort((a, b) => {
    if (agentId === "agent-1") {
      const bandDiff = Number(inPreferredBand(b.marketCap)) - Number(inPreferredBand(a.marketCap));
      if (bandDiff !== 0) return bandDiff;
      const momentumDiff = compareDescending(a.fiftyTwoWeekChangePct, b.fiftyTwoWeekChangePct);
      if (momentumDiff !== 0) return momentumDiff;
    } else if (agentId === "agent-2") {
      // Established trend is verified later from daily bars. The catalog's 52w
      // change is only a supported attention proxy and missing values rank last.
      const momentumDiff = compareDescending(a.fiftyTwoWeekChangePct, b.fiftyTwoWeekChangePct);
      if (momentumDiff !== 0) return momentumDiff;
      const liquidityDiff = compareDescending(a.avgDollarVolume, b.avgDollarVolume);
      if (liquidityDiff !== 0) return liquidityDiff;
    } else if (agentId === "agent-3") {
      // The quote catalog has no defensible quality/valuation history. Use the
      // mandate's size preference and liquidity only to prioritize research.
      const capDiff = compareDescending(a.marketCap, b.marketCap);
      if (capDiff !== 0) return capDiff;
      const liquidityDiff = compareDescending(a.avgDollarVolume, b.avgDollarVolume);
      if (liquidityDiff !== 0) return liquidityDiff;
    } else {
      throw new TypeError(`Unsupported research agent for attention ranking: ${String(agentId)}`);
    }
    return a.ticker < b.ticker ? -1 : 1; // deterministic tiebreak
  });
}

function isInCooldown(ledgerEntry, cooldownDays, now) {
  if (!ledgerEntry?.lastResearchedAt) return false;
  const ageMs = now.getTime() - Date.parse(ledgerEntry.lastResearchedAt);
  return Number.isFinite(ageMs) && ageMs < cooldownDays * 24 * 3600 * 1000;
}

/**
 * @param {object} args
 * @param {object[]} args.screened   philosophy-screened catalog candidates
 *                                   ({ ticker, marketCap, fiftyTwoWeekChangePct, ... })
 * @param {string[]} args.holdings   currently-held tickers (always included)
 * @param {string[]} args.scanTickers Robinhood scan names outside the holdings
 * @param {object}  args.ledger      research ledger map (ticker -> entry)
 * @param {object}  [args.config]    { slateSize, researchCooldownDays, explorationSlots }
 * @param {Date}    [args.now]
 * @returns {{ slate: {ticker: string, bucket: string}[], counts: object }}
 */
export function buildSlate({ screened = [], holdings = [], scanTickers = [], ledger = {}, config = {}, now = new Date() }) {
  const slateSize = config.slateSize ?? 20;
  const cooldownDays = config.researchCooldownDays ?? 14;
  const explorationSlots = config.explorationSlots ?? 3;

  const slate = [];
  const picked = new Set();
  const add = (ticker, bucket) => {
    const t = ticker.toUpperCase();
    if (picked.has(t) || slate.length >= slateSize) return;
    picked.add(t);
    slate.push({ ticker: t, bucket });
  };

  for (const t of holdings) add(t, "holdings");
  for (const t of scanTickers) add(t, "movers");

  // Exploration slots are reserved BEFORE ranked fills the slate, so a long
  // ranked list can never squeeze discovery out entirely.
  const attentionPolicy = { agentId: config.agentId ?? "agent-1" };
  const neverResearched = rankScreenedCandidates(screened.filter((c) => !picked.has(c.ticker) && !ledger[c.ticker]), attentionPolicy);
  const explorationPicks = [];
  if (explorationSlots > 0 && neverResearched.length) {
    // Deterministic daily rotation through the never-researched set (sorted by
    // ticker so the cycle is stable as the catalog grows).
    const rotation = [...neverResearched].sort((a, b) => (a.ticker < b.ticker ? -1 : 1));
    const offset = Math.floor(now.getTime() / (24 * 3600 * 1000)) % rotation.length;
    for (let i = 0; i < Math.min(explorationSlots, rotation.length); i++) {
      explorationPicks.push(rotation[(offset + i) % rotation.length].ticker);
    }
  }

  const rankedBudget = Math.max(0, slateSize - slate.length - explorationPicks.length);
  const ranked = rankScreenedCandidates(
    screened.filter((c) => !picked.has(c.ticker) && !explorationPicks.includes(c.ticker) && !isInCooldown(ledger[c.ticker], cooldownDays, now)),
    attentionPolicy
  );
  for (const c of ranked.slice(0, rankedBudget)) add(c.ticker, "ranked");
  for (const t of explorationPicks) add(t, "exploration");

  const counts = { holdings: 0, movers: 0, ranked: 0, exploration: 0 };
  for (const s of slate) counts[s.bucket]++;
  return { slate, counts };
}

/** "4 holdings + 3 movers + 10 ranked + 3 exploration" — for the scan log line. */
export function formatSlateCounts(counts) {
  return ["holdings", "movers", "ranked", "exploration"].map((b) => `${counts[b] ?? 0} ${b}`).join(" + ");
}
