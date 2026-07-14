import { runParityCheck } from "../lib/pg/parity-runner.js";
import { getRedis } from "../lib/redis.js";
import { sendMessage } from "../lib/telegram.js";

const LATEST_KEY = "pm:pg-parity:latest";
const HISTORY_KEY = "pm:pg-parity:history";

export function parityStatusPayload(result) {
  const valuation = result?.valuation
    ? {
        status: result.valuation.status,
        comparable: result.valuation.comparable === true,
        reason: result.valuation.reason ?? null,
      }
    : null;
  return {
    ok: result?.ok === true,
    comparedAt: result?.comparedAt ?? null,
    matched: Array.isArray(result?.matched) ? result.matched : [],
    divergences: Array.isArray(result?.divergences) ? result.divergences : [],
    valuation,
  };
}

export async function runDailyDbParityCheck() {
  const result = await runParityCheck();
  console.log(`[Parity] ${result.report.replaceAll("\n", " | ")}`);

  const redis = getRedis();
  if (redis) {
    // Persist only the aggregate valuation classification. Per-position values
    // and inventories stay out of operational Redis status/history.
    const payload = JSON.stringify(parityStatusPayload(result));
    await redis.set(LATEST_KEY, payload);
    await redis.lpush(HISTORY_KEY, payload);
    await redis.ltrim(HISTORY_KEY, 0, 89);
  }

  if (!result.ok) {
    await sendMessage(`⚠️ Postgres shadow parity divergence\n${result.report}`).catch((error) => {
      console.warn(`[Parity] Telegram alert failed: ${error.message}`);
    });
    throw new Error(`Postgres shadow parity diverged: ${result.divergences.map((row) => `${row.key} ${row.reason}`).join("; ")}`);
  }
  return result;
}
