import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { TICKER_RE } from "../contracts/proposal.js";

const MANDATE_FILES = Object.freeze({
  "agent-1": new URL("../config/agents/agent-1/mandate.json", import.meta.url),
  "agent-2": new URL("../config/agents/agent-2/mandate.json", import.meta.url),
  "agent-3": new URL("../config/agents/agent-3/mandate.json", import.meta.url),
});

const SCORING_TABLE_KEYS = [
  "AGENT_SCORING",
  "ABSOLUTE_RULE_TABLES",
  "SPECIAL_SECTOR_RULE_TABLES",
  "ABSOLUTE_VALUATION_TABLES",
];

const ZONED_ISO_RE = /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/;
const OBJECT_TAG = "[object Object]";

function isPlainObject(value) {
  if (Object.prototype.toString.call(value) !== OBJECT_TAG) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalize(value, seen = new Set(), path = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`canonicalJson rejects non-finite numbers at ${path}`);
    return value;
  }

  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new TypeError(`canonicalJson rejects unsupported ${typeof value} at ${path}`);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError(`canonicalJson rejects cyclic values at ${path}`);
    seen.add(value);
    try {
      const out = [];
      for (let index = 0; index < value.length; index++) {
        if (!(index in value)) throw new TypeError(`canonicalJson rejects sparse arrays at ${path}[${index}]`);
        out.push(canonicalize(value[index], seen, `${path}[${index}]`));
      }
      return out;
    } finally {
      seen.delete(value);
    }
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`canonicalJson rejects non-plain objects at ${path}`);
  }

  if (seen.has(value)) throw new TypeError(`canonicalJson rejects cyclic values at ${path}`);
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`canonicalJson rejects symbol keys at ${path}`);
  seen.add(value);
  try {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (typeof child === "undefined") throw new TypeError(`canonicalJson rejects undefined at ${path}.${key}`);
      out[key] = canonicalize(child, seen, `${path}.${key}`);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

function readJsonFile(fileUrl) {
  return JSON.parse(readFileSync(fileUrl, "utf8"));
}

function normalizeTicker(ticker, path) {
  const normalized = String(ticker ?? "").trim().toUpperCase();
  if (!normalized || !TICKER_RE.test(normalized)) {
    throw new TypeError(`peerSetId/observationId rejects invalid ticker at ${path}`);
  }
  return normalized;
}

function normalizeZonedIsoTimestamp(value, path) {
  const ts = String(value ?? "").trim();
  if (!ts || !ZONED_ISO_RE.test(ts) || Number.isNaN(Date.parse(ts))) {
    throw new TypeError(`peerSetId rejects invalid zoned ISO timestamp at ${path}`);
  }
  return ts;
}

function normalizeScoringTables(scoringTables) {
  if (!isPlainObject(scoringTables)) {
    throw new TypeError("scoringConfigVersion requires a plain object of executable scoring tables");
  }
  const out = {};
  for (const key of SCORING_TABLE_KEYS) {
    if (!(key in scoringTables)) {
      throw new TypeError(`scoringConfigVersion missing required table export: ${key}`);
    }
    out[key] = scoringTables[key];
  }
  return out;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function contentHash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function mandateMetadataFor(agentId) {
  const fileUrl = MANDATE_FILES[agentId];
  if (!fileUrl) throw new Error(`Unknown mandate agentId: ${agentId}`);
  return readJsonFile(fileUrl);
}

export function mandateVersionFor(agentId) {
  return mandateMetadataFor(agentId).mandateVersion;
}

export function scoringConfigVersion({ semanticVersion, scoringTables }) {
  const version = String(semanticVersion ?? "").trim();
  if (!version) throw new TypeError("scoringConfigVersion requires a semanticVersion");
  const normalized = normalizeScoringTables(scoringTables);
  return `${version}+sha256:${contentHash(normalized)}`;
}

export function peerSetId({ level, key, tickers, asOf }) {
  const normalizedLevel = String(level ?? "").trim();
  const normalizedKey = String(key ?? "").trim();
  const normalizedTickers = [...new Set((Array.isArray(tickers) ? tickers : []).map((ticker, index) => normalizeTicker(ticker, `tickers[${index}]`)))].sort();
  return contentHash({
    level: normalizedLevel,
    key: normalizedKey,
    tickers: normalizedTickers,
    asOf: normalizeZonedIsoTimestamp(asOf, "asOf"),
  });
}

export function observationId(observationIdentity) {
  const runId = String(observationIdentity?.runId ?? "").trim();
  const agentId = String(observationIdentity?.agentId ?? "").trim();
  const ticker = normalizeTicker(observationIdentity?.ticker, "ticker");
  if (!runId) throw new TypeError("observationId requires a runId");
  if (!agentId) throw new TypeError("observationId requires an agentId");
  return contentHash({ runId, agentId, ticker });
}
