#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { auditLocalProposalQuality, summarizeLocalProposalQuality } from "../lib/proposal-quality-local.js";

const inputPath = process.argv[2] ?? "fixtures/proposal-quality-local-cases.json";
const parsed = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), inputPath), "utf8"));
const cases = Array.isArray(parsed) ? parsed : parsed.cases;
if (!Array.isArray(cases)) throw new TypeError("local proposal-quality input must contain cases");
console.log(JSON.stringify(summarizeLocalProposalQuality(cases.map(auditLocalProposalQuality)), null, 2));

