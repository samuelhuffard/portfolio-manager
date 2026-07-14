import "dotenv/config";
import { fileURLToPath } from "node:url";
import { formatAnthropicSpendReport, getAnthropicSpendReport } from "../lib/anthropic-monthly-budget.js";

export async function runAnthropicSpendReport(options = {}) {
  const report = await getAnthropicSpendReport(options);
  const output = formatAnthropicSpendReport(report);
  console.log(output);
  return report;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runAnthropicSpendReport().catch((error) => {
    console.error(`[AnthropicSpend] report failed: ${error.message}`);
    process.exit(1);
  });
}
