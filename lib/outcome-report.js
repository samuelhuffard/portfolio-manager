function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function biweeklyPeriodId(now = new Date()) {
  // Monday 2026-01-05 is an explicit cadence anchor, so period boundaries do
  // not drift with epoch arithmetic or vary by month length.
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const anchor = Date.UTC(2026, 0, 5);
  return `biweekly-${Math.floor((day - anchor) / (14 * 86400000))}`;
}

export function renderOutcomeReportEmail(report, { periodId, dashboardUrl = null } = {}) {
  const coverage = report?.sections?.dataCoverage ?? {};
  const classes = report?.sections?.evidenceClasses ?? {};
  const rows = Object.entries(classes).map(([name, item]) => `${name}: ${item?.state ?? "not_recorded"}, ${item?.counts?.sample ?? item?.sampleCount ?? 0} sample(s)`).join("\n");
  const subject = `Portfolio Manager outcome report — ${periodId}`;
  const text = [
    "Portfolio Manager research outcome report", "",
    `Period: ${periodId}`, `As of: ${report?.metadata?.asOf ?? "not_recorded"}`,
    `Conclusion: ${report?.conclusion ?? "not_assessed"}`,
    "", "Coverage", `Observations: ${coverage.observationCount ?? 0}`,
    `Outcome samples: ${coverage.outcomeCount ?? 0}`, `Outcome snapshots: ${coverage.snapshotCount ?? 0}`,
    `Freshness: ${coverage.freshness ?? "not_recorded"}`, `Statuses: ${JSON.stringify(coverage.statusCounts ?? {})}`,
    "", "Evidence classes", rows,
    "", "This is an internal measurement report. It does not claim an investment edge, recommend an action, or authorize trading.",
    dashboardUrl ? `Dashboard: ${dashboardUrl}` : null,
  ].filter(Boolean).join("\n");
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5"><h1>Research outcome report</h1><p><strong>Period:</strong> ${escapeHtml(periodId)}<br/><strong>As of:</strong> ${escapeHtml(report?.metadata?.asOf ?? "not_recorded")}<br/><strong>Conclusion:</strong> ${escapeHtml(report?.conclusion ?? "not_assessed")}</p><h2>Coverage</h2><ul><li>Observations: ${escapeHtml(coverage.observationCount ?? 0)}</li><li>Outcome samples: ${escapeHtml(coverage.outcomeCount ?? 0)}</li><li>Outcome snapshots: ${escapeHtml(coverage.snapshotCount ?? 0)}</li><li>Freshness: ${escapeHtml(coverage.freshness ?? "not_recorded")}</li></ul><h2>Evidence classes</h2><pre>${escapeHtml(rows)}</pre>${dashboardUrl ? `<p><a href="${escapeHtml(dashboardUrl)}">Open dashboard</a></p>` : ""}<p><small>This is an internal measurement report. It does not claim an investment edge, recommend an action, or authorize trading.</small></p></body></html>`;
  return { subject, text, html };
}
