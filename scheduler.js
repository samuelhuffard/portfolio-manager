import "dotenv/config";
import cron from "node-cron";
import { runResearchScan } from "./jobs/research-scan.js";
import { runExitMonitor } from "./jobs/monitor-positions.js";
import { runPerformanceReview } from "./jobs/performance-review.js";
import { startServer } from "./server.js";

startServer();

// Holdings sync is MCP-driven and on demand. A Claude session with the
// robinhood-trading MCP reads positions, then runs scripts/sync-holdings-from-mcp.js.

// Exit monitor — daily after the holdings sync (4:45pm ET), Mon-Fri: runs the T1/T2/T3
// exit triggers over open positions and queues SELL/TRIM proposals before the entry scan.
cron.schedule("45 16 * * 1-5", async () => {
  await runExitMonitor().catch((e) => console.error("[ExitMonitor] error:", e.message));
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

console.log("[Portfolio Manager] Scheduler started — MCP holdings sync on demand, exit monitor 4:45pm ET, research scan 5:00pm ET, performance review 5:30pm ET (Mon-Fri)");
