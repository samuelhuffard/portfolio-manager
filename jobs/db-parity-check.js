import { runParityCheck } from "../lib/pg/parity-runner.js";
import { getRedis } from "../lib/redis.js";
import { sendMessage } from "../lib/telegram.js";

const LATEST_KEY = "pm:pg-parity:latest";
const HISTORY_KEY = "pm:pg-parity:history";

export async function runDailyDbParityCheck() {
  const result = await runParityCheck();
  console.log(`[Parity] ${result.report.replaceAll("\n", " | ")}`);

  const redis = getRedis();
  if (redis) {
    const payload = JSON.stringify({
      ok: result.ok,
      comparedAt: result.comparedAt,
      matched: result.matched,
      divergences: result.divergences,
    });
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
