import "dotenv/config";
import { getResearchScanStatus } from "../lib/redis.js";
import { buildResearchRunReport, formatResearchRunReport } from "../lib/research-run-report.js";

const status = await getResearchScanStatus();
const report = buildResearchRunReport(status);

console.log(JSON.stringify(report, null, 2));
console.log(formatResearchRunReport(report));
