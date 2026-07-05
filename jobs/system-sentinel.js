import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleSnapshot, persistSnapshot } from "../lib/sysloop/snapshot.js";
import { sendMessage } from "../lib/telegram.js";

// Tier 0 of the system autoresearch loop (docs/SYSTEM-LOOP-PLAN.md).
// Deterministic only — no LLM calls ever happen on the Jetson. Observes the
// system, publishes a snapshot to Redis for the Mac tier, and Telegrams only
// P0s and P1s that were NOT present in the previous snapshot (dedup by
// fingerprint, so a known-broken thing doesn't page Sam every evening).
//
// Write surface: pm:sysloop:* keys, ops/health/*.json, Telegram. Nothing else.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function runSystemSentinel({ dryRun = false } = {}) {
  const started = Date.now();
  console.log(`[Sysloop] Sentinel run starting...${dryRun ? " (dry run — no Redis publish, no Telegram)" : ""}`);

  const { snapshot, nextState, prevAnomalyFingerprints } = await assembleSnapshot({ repoRoot: REPO_ROOT });

  const prev = new Set(prevAnomalyFingerprints);
  const fresh = snapshot.anomalies.filter((a) => !prev.has(a.fingerprint));
  const urgent = fresh.filter((a) => a.severity === "P0" || a.severity === "P1");

  console.log(
    `[Sysloop] ${snapshot.anomalies.length} anomalies (${JSON.stringify(snapshot.stats.bySeverity)}), ` +
    `${fresh.length} new since last run, ${urgent.length} urgent`
  );
  for (const a of snapshot.anomalies) console.log(`[Sysloop]   ${a.severity} ${a.check}: ${a.title}`);

  if (urgent.length > 0 && !dryRun) {
    const lines = urgent.slice(0, 8).map((a) => `${a.severity} ${a.title}`).join("\n");
    try {
      await sendMessage(`System sentinel: ${urgent.length} new urgent finding(s)\n${lines}`);
    } catch (e) {
      // Alerting is this job's OUTPUT — a swallowed Telegram failure would make
      // the sentinel itself a silent no-op. Scream in the logs at minimum.
      console.error("[Sysloop] TELEGRAM ALERT FAILED — urgent findings unreported:", e.message);
    }
  }

  const published = dryRun ? false : await persistSnapshot({ snapshot, nextState, repoRoot: REPO_ROOT });
  console.log(`[Sysloop] Done in ${Date.now() - started}ms (published=${published})`);
  return snapshot;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runSystemSentinel({ dryRun: process.argv.includes("--dry-run") })
    .then((s) => process.exit(s.anomalies.some((a) => a.severity === "P0") ? 2 : 0))
    .catch((e) => {
      console.error("[Sysloop] Sentinel crashed:", e);
      process.exit(1);
    });
}
