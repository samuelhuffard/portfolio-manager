import "dotenv/config";
import cron from "node-cron";
import { syncHoldings } from "./jobs/holdings-sync.js";
import { runResearchScan } from "./jobs/research-scan.js";
import { runPerformanceReview } from "./jobs/performance-review.js";

// Holdings sync — daily after market close (4:30pm ET), Mon-Fri
cron.schedule("30 16 * * 1-5", async () => {
  await syncHoldings().catch((e) => console.error("[Holdings] Sync error:", e.message));
}, { timezone: "America/New_York" });

// Research scan — daily shortly after (5:00pm ET), Mon-Fri
cron.schedule("0 17 * * 1-5", async () => {
  await runResearchScan().catch((e) => console.error("[Research] Scan error:", e.message));
}, { timezone: "America/New_York" });

// Performance review — daily shortly after (5:30pm ET), Mon-Fri: scores past
// recommendations whose 30/90/180-day windows have elapsed and refreshes the
// Track Record tab's hit-rate stats.
cron.schedule("30 17 * * 1-5", async () => {
  await runPerformanceReview().catch((e) => console.error("[Performance] Review error:", e.message));
}, { timezone: "America/New_York" });

console.log("[Portfolio Manager] Scheduler started — holdings sync 4:30pm ET, research scan 5:00pm ET, performance review 5:30pm ET (Mon-Fri)");
