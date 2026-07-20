#!/usr/bin/env node
// Local/manual only. This script has no network, provider, Redis, Sheets, or
// write access. It reads a supplied fixture and prints a JSON shadow report.
import fs from "node:fs";
import path from "node:path";
import { auditProposalQualityShadow, summarizeProposalQualityShadow } from "../lib/proposal-quality-shadow.js";

const inputPath = process.argv[2] ?? "fixtures/proposal-quality-shadow-cases.json";
const absolutePath = path.resolve(process.cwd(), inputPath);
const parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
const cases = Array.isArray(parsed) ? parsed : parsed.cases;
if (!Array.isArray(cases)) throw new TypeError("shadow input must be an array or an object with a cases array");

const audits = cases.map((item) => auditProposalQualityShadow(item));
console.log(JSON.stringify(summarizeProposalQualityShadow(audits), null, 2));
