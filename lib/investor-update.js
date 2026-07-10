import { defaultInvestorId, normalizeEmail } from "./investor-ledger.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function money(value) {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function pct(value) {
  if (value == null || !Number.isFinite(value)) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function number(value, digits = 4) {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseTime(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function isoWeekOf(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function latestNav(performanceHistory) {
  const last = performanceHistory[performanceHistory.length - 1];
  return {
    asOf: last?.date ?? null,
    navPerUnit: last?.navPerUnit ?? null,
    unitsOutstanding: last?.unitsOutstanding ?? null,
  };
}

function investorKey(entry) {
  return entry.investorId || defaultInvestorId(entry.email);
}

export function computeInvestorSummaries({ ledger, performanceHistory, holdings, trades, now = new Date() }) {
  const { asOf, navPerUnit, unitsOutstanding } = latestNav(performanceHistory);
  const weekStart = new Date(now.getTime() - WEEK_MS);
  const weeklyTrades = trades
    .filter((trade) => {
      const ms = parseTime(trade.date);
      return ms != null && ms >= weekStart.getTime() && ms <= now.getTime();
    })
    .sort((a, b) => (parseTime(a.date) ?? 0) - (parseTime(b.date) ?? 0));

  const keys = [...new Set(ledger.map(investorKey))];
  return keys
    .map((key) => {
      const rows = ledger.filter((entry) => investorKey(entry) === key);
      const sample = rows[rows.length - 1];
      const contributed = rows.filter((entry) => entry.type === "Contribution").reduce((sum, entry) => sum + entry.amount, 0);
      const withdrawn = rows.filter((entry) => entry.type === "Withdrawal").reduce((sum, entry) => sum + entry.amount, 0);
      const units = rows.reduce((sum, entry) => sum + entry.units, 0);
      const value = navPerUnit != null ? units * navPerUnit : null;
      const netContributed = contributed - withdrawn;
      const gainLoss = value != null ? value - netContributed : null;
      const gainLossPct = gainLoss != null && netContributed ? (gainLoss / netContributed) * 100 : null;
      const ownershipPct = unitsOutstanding ? (units / unitsOutstanding) * 100 : null;
      const topHoldings = ownershipPct == null
        ? []
        : holdings
            .filter((holding) => holding.marketValue != null && Number.isFinite(holding.marketValue))
            .map((holding) => ({
              ticker: holding.ticker,
              marketValue: round2(holding.marketValue * (ownershipPct / 100)),
            }))
            .sort((a, b) => b.marketValue - a.marketValue)
            .slice(0, 3);

      return {
        investorId: sample.investorId || defaultInvestorId(sample.email),
        email: normalizeEmail(sample.email),
        name: sample.name || normalizeEmail(sample.email),
        contributed,
        withdrawn,
        netContributed,
        units,
        navPerUnit,
        navAsOf: asOf,
        value: value != null ? round2(value) : null,
        gainLoss: gainLoss != null ? round2(gainLoss) : null,
        gainLossPct,
        ownershipPct,
        weeklyTrades,
        topHoldings,
      };
    })
    .filter((summary) => summary.email && summary.units > 0);
}

function actionLine(trade, ownershipPct) {
  const date = String(trade.date ?? "").slice(0, 10);
  const investorShare = ownershipPct != null && Number.isFinite(ownershipPct)
    ? round2(trade.amount * (ownershipPct / 100))
    : null;
  const realized = trade.realizedGain != null && Number.isFinite(trade.realizedGain) && ownershipPct != null
    ? `, your pro-rata realized gain/loss ${money(round2(trade.realizedGain * (ownershipPct / 100)))}`
    : "";
  return `${date}: ${trade.side} ${trade.ticker} at avg ${money(trade.price)} (your pro-rata amount ${money(investorShare)}${realized})`;
}

function subjectFor(summary, isoWeek, prefix) {
  const week = isoWeek.replace("-", " ");
  const base = `Portfolio update ${week}: ${money(summary.value)} (${pct(summary.gainLossPct)})`;
  return prefix ? `${prefix} ${base}` : base;
}

export function renderInvestorUpdateEmail(summary, { isoWeek, dashboardUrl, subjectPrefix } = {}) {
  const subject = subjectFor(summary, isoWeek, subjectPrefix);
  const tradeLines = summary.weeklyTrades.length
    ? summary.weeklyTrades.map((trade) => actionLine(trade, summary.ownershipPct))
    : ["No buys or sells were executed this week."];
  const exposureLines = summary.topHoldings.length
    ? summary.topHoldings.map((h) => `${h.ticker}: ${money(h.marketValue)} of your pro-rata exposure`)
    : ["No current holdings exposure is available yet."];

  const text = [
    `Hi ${summary.name},`,
    "",
    `Here is your weekly Portfolio Manager update for ${isoWeek}.`,
    "",
    "Your section",
    `Current value: ${money(summary.value)}`,
    `Net contributed: ${money(summary.netContributed)}`,
    `Gain/loss: ${money(summary.gainLoss)} (${pct(summary.gainLossPct)})`,
    `Units: ${number(summary.units)} at NAV/unit ${money(summary.navPerUnit)}${summary.navAsOf ? ` as of ${summary.navAsOf}` : ""}`,
    "",
    "Actions this week",
    ...tradeLines.map((line) => `- ${line}`),
    "",
    "Largest current exposures",
    ...exposureLines.map((line) => `- ${line}`),
    "",
    dashboardUrl ? `Dashboard: ${dashboardUrl}` : null,
    "This is an accounting and research update, not investment advice or a guarantee of future performance.",
  ].filter(Boolean).join("\n");

  const tradesHtml = tradeLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const exposuresHtml = exposureLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const dashboardHtml = dashboardUrl
    ? `<p><a href="${escapeHtml(dashboardUrl)}">Open the investor dashboard</a></p>`
    : "";
  const gainColor = summary.gainLoss == null ? "#334155" : summary.gainLoss >= 0 ? "#166534" : "#991b1b";
  const html = `<!doctype html>
<html>
  <body style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5; margin: 0; padding: 24px; background: #f8fafc;">
    <main style="max-width: 640px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
      <p>Hi ${escapeHtml(summary.name)},</p>
      <p>Here is your weekly Portfolio Manager update for <strong>${escapeHtml(isoWeek)}</strong>.</p>
      <h2 style="font-size: 18px; margin-top: 24px;">Your section</h2>
      <table style="border-collapse: collapse; width: 100%;">
        <tr><td style="padding: 6px 0; color: #475569;">Current value</td><td style="padding: 6px 0; text-align: right; font-weight: 700;">${escapeHtml(money(summary.value))}</td></tr>
        <tr><td style="padding: 6px 0; color: #475569;">Net contributed</td><td style="padding: 6px 0; text-align: right;">${escapeHtml(money(summary.netContributed))}</td></tr>
        <tr><td style="padding: 6px 0; color: #475569;">Gain/loss</td><td style="padding: 6px 0; text-align: right; color: ${gainColor};">${escapeHtml(money(summary.gainLoss))} (${escapeHtml(pct(summary.gainLossPct))})</td></tr>
        <tr><td style="padding: 6px 0; color: #475569;">Units / NAV</td><td style="padding: 6px 0; text-align: right;">${escapeHtml(number(summary.units))} at ${escapeHtml(money(summary.navPerUnit))}</td></tr>
      </table>
      <p style="color: #64748b; font-size: 13px;">NAV as of ${escapeHtml(summary.navAsOf || "latest available row")}.</p>
      <h2 style="font-size: 18px; margin-top: 24px;">Actions this week</h2>
      <ul>${tradesHtml}</ul>
      <h2 style="font-size: 18px; margin-top: 24px;">Largest current exposures</h2>
      <ul>${exposuresHtml}</ul>
      ${dashboardHtml}
      <p style="color: #64748b; font-size: 12px; margin-top: 24px;">This is an accounting and research update, not investment advice or a guarantee of future performance.</p>
    </main>
  </body>
</html>`;

  return { subject, text, html };
}
