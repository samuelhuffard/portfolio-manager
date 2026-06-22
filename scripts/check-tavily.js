import "dotenv/config";
import { tavilySearch } from "../lib/tavily.js";

try {
  const results = await tavilySearch("AAPL stock news", { maxResults: 1, days: 7 });
  console.log(JSON.stringify({ ok: true, results: results.length, firstHasUrl: Boolean(results[0]?.url) }));
} catch (err) {
  if (err instanceof Error) {
    const cause = err.cause && typeof err.cause === "object" && "code" in err.cause ? ` (${err.cause.code})` : "";
    console.error(`${err.message}${cause}`);
  } else {
    console.error(err);
  }
  process.exit(1);
}
