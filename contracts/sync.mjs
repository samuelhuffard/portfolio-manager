#!/usr/bin/env node
// Mirror the canonical contracts into the dashboard repo.
//
// Copies every canonical `contracts/*.js` file verbatim into
// ../portfolio-dashboard/lib/contracts/ so Vercel (which cannot reach this repo
// at build time) ships an identical copy. The dashboard's contracts-drift test
// byte-compares the two and fails if they differ.
//
// Run from the backend repo: `npm run contracts:sync`. Requires the dashboard
// checked out as a sibling directory (same assumption the Mac companion makes).

import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dashboardContracts = resolve(here, "../../portfolio-dashboard/lib/contracts");

// Only these files are the contract. sync.mjs, README, and *.test.js stay in the
// backend repo and are never mirrored.
function isContractFile(name) {
  return name.endsWith(".js") && !name.endsWith(".test.js") && name !== "sync.mjs";
}

async function main() {
  const dashboardRepo = resolve(here, "../../portfolio-dashboard");
  if (!existsSync(dashboardRepo)) {
    console.error(
      `Dashboard repo not found at ${dashboardRepo}. ` +
        "Check out portfolio-dashboard as a sibling of portfolio-manager, then re-run."
    );
    process.exit(1);
  }

  const entries = (await readdir(here)).filter(isContractFile).sort();
  if (entries.length === 0) {
    console.error("No canonical contract files found — refusing to wipe the mirror.");
    process.exit(1);
  }

  // Rebuild the mirror from scratch so a deleted canonical file also disappears
  // downstream (a stale mirror file would silently pass consumers, fail drift).
  if (existsSync(dashboardContracts)) await rm(dashboardContracts, { recursive: true });
  await mkdir(dashboardContracts, { recursive: true });

  for (const name of entries) {
    const body = await readFile(join(here, name));
    await writeFile(join(dashboardContracts, name), body);
    console.log(`synced ${name} -> lib/contracts/${name}`);
  }
  console.log(`\n${entries.length} contract file(s) mirrored. Run \`npm test\` in both repos.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
