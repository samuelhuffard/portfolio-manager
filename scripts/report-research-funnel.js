import "dotenv/config";
import { listResearchScanHistory } from "../lib/redis.js";
import { buildResearchFunnelReport } from "../lib/research-funnel-report.js";

const arg = process.argv.find((value) => value.startsWith("--runs="));
const maxRuns = arg ? Number(arg.slice("--runs=".length)) : 5;

const history = await listResearchScanHistory({ limit: 50 });
const report = buildResearchFunnelReport(history, { maxRuns });
console.log(JSON.stringify(report, null, 2));
