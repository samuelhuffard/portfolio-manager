import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { activateShadowAllocationPolicy } from "../lib/portfolio-manager-shadow-store.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run agent4:policy:set -- path/to/reviewed-policy.json");
  process.exitCode = 1;
} else {
  try {
    const raw = JSON.parse(await readFile(resolve(file), "utf8"));
    const policy = await activateShadowAllocationPolicy(raw);
    console.log(`Activated Kairos ${policy.mode} policy ${policy.version}. No live authority was granted.`);
  } catch (error) {
    console.error(`Kairos policy activation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
