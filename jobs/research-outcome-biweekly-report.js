import "dotenv/config";
import { fileURLToPath } from "node:url";
import { getRedis } from "../lib/redis.js";
import { outcomeReportsEnabled, sendOutcomeReportEmail } from "../lib/email.js";
import { getPool, pgConfigured } from "../lib/pg/client.js";
import { readResearchEvidenceRows } from "../lib/pg/research-outcomes.js";
import { buildResearchEvidenceReport } from "../lib/research-evidence-report.js";
import { biweeklyPeriodId, renderOutcomeReportEmail } from "../lib/outcome-report.js";

const SENT_TTL_SECONDS = 45 * 24 * 3600;

function recipientsFromEnv(env = process.env) {
  return [...new Set(String(env.OUTCOME_REPORT_RECIPIENTS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

export async function runResearchOutcomeBiweeklyReport({ now = new Date(), env = process.env } = {}) {
  if (!pgConfigured()) throw new Error("DATABASE_URL is required for outcome reports.");
  const rows = await readResearchEvidenceRows({ pool: getPool() });
  const timestamps = [...rows.outcomes.map((row) => row.asOf), ...rows.observations.map((row) => row.observedAt ?? row.observed_at)].filter((value) => Number.isFinite(Date.parse(value)));
  const asOf = timestamps.length ? new Date(Math.max(...timestamps.map(Date.parse))).toISOString() : null;
  const built = buildResearchEvidenceReport({ metadata: { version: "research-evidence-report-v1", asOf, q007CostStatus: "not_configured" }, ...rows });
  const periodId = biweeklyPeriodId(now);
  if (!outcomeReportsEnabled()) return { skipped: true, reason: "OUTCOME_REPORT_ENABLED is not true", periodId, report: built.report };
  const recipients = recipientsFromEnv(env);
  if (!recipients.length) throw new Error("OUTCOME_REPORT_RECIPIENTS is required when outcome reporting is enabled.");
  const redis = getRedis();
  if (!redis) throw new Error("Redis is required to idempotently send enabled outcome reports.");
  const results = [];
  for (const recipient of recipients) {
    const key = `pm:outcome-report:sent:${periodId}:${recipient}`;
    const reserved = await redis.set(key, now.toISOString(), { nx: true, ex: SENT_TTL_SECONDS });
    if (!(reserved === "OK" || reserved === "ok" || reserved === true)) { results.push({ recipient, skipped: true, reason: "already sent" }); continue; }
    try {
      const rendered = renderOutcomeReportEmail(built.report, { periodId, dashboardUrl: env.OUTCOME_REPORT_DASHBOARD_URL?.trim() || null });
      results.push({ recipient, ...(await sendOutcomeReportEmail({ to: recipient, ...rendered, idempotencyKey: `outcome-report-${periodId}-${recipient}`.slice(0, 256) })) });
    } catch (error) {
      await redis.del(key);
      throw error;
    }
  }
  return { skipped: false, periodId, sent: results.filter((result) => !result.skipped).length, results, report: built.report };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runResearchOutcomeBiweeklyReport().then((result) => console.log(JSON.stringify({ skipped: result.skipped, periodId: result.periodId, sent: result.sent ?? 0, reason: result.reason ?? null }))).catch((error) => { console.error(`[OutcomeReport] failed: ${error.message}`); process.exit(1); });
}
