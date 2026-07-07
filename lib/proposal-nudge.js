/**
 * Approval-queue expiry nudges (finding F-2026-003: 8 proposals expired without
 * a decision — nothing pushed them to Sam before the 48h lapse). Pure selection
 * and formatting, tested in tests/proposal-nudge.test.js; the intraday monitor
 * owns the Telegram send and the per-proposal dedupe marker (lib/redis.js).
 */

const DEFAULT_WINDOW_HOURS = 24;

/** Pending proposals inside their final `windowHours` before expiry (already-expired excluded). */
export function selectExpiringProposals(proposals = [], { now = new Date(), windowHours = DEFAULT_WINDOW_HOURS } = {}) {
  const windowMs = windowHours * 3600 * 1000;
  return proposals.filter((p) => {
    if (p?.status !== "Pending" || !p.expiresAt) return false;
    const msLeft = Date.parse(p.expiresAt) - now.getTime();
    return Number.isFinite(msLeft) && msLeft > 0 && msLeft <= windowMs;
  });
}

/** One Telegram digest for however many proposals entered the window this tick. */
export function formatExpiryNudge(expiring, now = new Date()) {
  const lines = expiring.map((p) => {
    const hoursLeft = Math.max(1, Math.round((Date.parse(p.expiresAt) - now.getTime()) / 3_600_000));
    return `• ${p.agentId} ${p.side} ${p.ticker} $${p.amountDollars} — expires in ~${hoursLeft}h`;
  });
  return `⏳ ${expiring.length} pending proposal(s) expiring soon — decide in the dashboard or they lapse:\n${lines.join("\n")}`;
}
