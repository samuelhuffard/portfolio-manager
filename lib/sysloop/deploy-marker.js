import { createHmac, timingSafeEqual } from "node:crypto";

export const PM2_DEPLOY_MARKER_SCHEMA = "pm2-deploy-marker-v1";
export const PM2_DEPLOY_MARKER_TTL_SECONDS = 10 * 24 * 60 * 60;
export const PM2_DEPLOY_MARKER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const PM2_DEPLOY_MARKER_MAX_CHAIN = 100;

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function unsignedMarker(marker) {
  const { rowHmac: _rowHmac, ...record } = marker ?? {};
  return record;
}

function nonnegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}

export function getSysloopDeployHmacSecret(env = process.env) {
  const secret = String(env.SYSLOOP_DEPLOY_HMAC_SECRET ?? "").trim();
  if (secret.length < 32) throw new Error("SYSLOOP_DEPLOY_HMAC_SECRET must be explicitly configured with at least 32 characters.");
  return secret;
}

export function pm2DeployMarkerKey(processName, afterRestarts) {
  const normalized = String(processName ?? "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) throw new Error("PM2 process name is invalid.");
  nonnegativeInteger(afterRestarts, "afterRestarts");
  return `pm:sysloop:deploy-marker:${normalized}:${afterRestarts}`;
}

export function assertPm2DeployMarkerShape(marker) {
  if (!marker || typeof marker !== "object") throw new Error("deploy marker is missing.");
  if (marker.schemaVersion !== PM2_DEPLOY_MARKER_SCHEMA) throw new Error("deploy marker schema is unsupported.");
  if (!/^[0-9a-f]{64}$/i.test(String(marker.markerId ?? ""))) throw new Error("deploy marker id is invalid.");
  if (!String(marker.target ?? "").trim()) throw new Error("deploy marker target is missing.");
  if (!String(marker.host ?? "").trim()) throw new Error("deploy marker host is missing.");
  const beforeRestarts = nonnegativeInteger(marker.beforeRestarts, "beforeRestarts");
  const afterRestarts = nonnegativeInteger(marker.afterRestarts, "afterRestarts");
  pm2DeployMarkerKey(marker.processName, afterRestarts);
  if (afterRestarts !== beforeRestarts + 1) throw new Error("deploy marker must attest exactly one restart edge.");
  const beforeUnstable = nonnegativeInteger(marker.beforeUnstableRestarts, "beforeUnstableRestarts");
  const afterUnstable = nonnegativeInteger(marker.afterUnstableRestarts, "afterUnstableRestarts");
  if (afterUnstable !== beforeUnstable) throw new Error("deploy marker cannot attest an unstable restart delta.");
  if (marker.exitCode !== 0) throw new Error("deploy marker cannot attest a non-zero exit code.");
  if (!Number.isFinite(marker.startedAt) || marker.startedAt <= 0) throw new Error("deploy marker startedAt is invalid.");
  if (!/^[0-9a-f]{40,64}$/i.test(String(marker.commit ?? ""))) throw new Error("deploy marker commit is invalid.");
  if (!String(marker.branch ?? "").trim()) throw new Error("deploy marker branch is missing.");
  const createdMs = Date.parse(marker.createdAt ?? "");
  const expiresMs = Date.parse(marker.expiresAt ?? "");
  if (!Number.isFinite(createdMs) || !Number.isFinite(expiresMs) || expiresMs <= createdMs) {
    throw new Error("deploy marker timestamps are invalid.");
  }
  return marker;
}

export function computePm2DeployMarkerHmac(marker, secret = getSysloopDeployHmacSecret()) {
  if (String(secret ?? "").trim().length < 32) throw new Error("dedicated deploy marker signing secret is required.");
  const unsigned = unsignedMarker(marker);
  assertPm2DeployMarkerShape(unsigned);
  return createHmac("sha256", secret)
    .update(stableJson({ kind: "pm2-deploy-marker", record: unsigned }))
    .digest("hex");
}

export function signPm2DeployMarker(marker, secret = getSysloopDeployHmacSecret()) {
  const unsigned = unsignedMarker(marker);
  assertPm2DeployMarkerShape(unsigned);
  return { ...unsigned, rowHmac: computePm2DeployMarkerHmac(unsigned, secret) };
}

function hmacMatches(expectedHex, providedHex) {
  const expected = Buffer.from(String(expectedHex ?? ""), "hex");
  const provided = Buffer.from(String(providedHex ?? ""), "hex");
  return expected.length > 0 && provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function validatePm2DeployMarkerChain(markers, {
  secret,
  target,
  host,
  processName,
  previousRestarts,
  currentRestarts,
  previousUnstableRestarts,
  currentUnstableRestarts,
  currentExitCode,
  currentStartedAt,
  currentBranch,
  currentCommit,
  nowMs = Date.now(),
  maxAgeMs = PM2_DEPLOY_MARKER_MAX_AGE_MS,
} = {}) {
  try {
    if (!Number.isInteger(previousRestarts) || !Number.isInteger(currentRestarts) || currentRestarts <= previousRestarts) {
      throw new Error("a positive restart delta is required for deploy-marker validation.");
    }
    const expectedCount = currentRestarts - previousRestarts;
    if (expectedCount > PM2_DEPLOY_MARKER_MAX_CHAIN) throw new Error("deploy marker chain is implausibly long.");
    if (!Array.isArray(markers) || markers.length !== expectedCount) throw new Error("deploy marker chain is incomplete.");
    if (currentUnstableRestarts !== previousUnstableRestarts) throw new Error("unstable restart count changed.");
    if (currentExitCode !== 0) throw new Error("current PM2 exit code is non-zero.");

    const ids = new Set();
    for (let index = 0; index < markers.length; index++) {
      const marker = markers[index];
      assertPm2DeployMarkerShape(marker);
      const expectedHmac = computePm2DeployMarkerHmac(marker, secret);
      if (!hmacMatches(expectedHmac, marker.rowHmac)) throw new Error("deploy marker HMAC mismatch.");
      if (ids.has(marker.markerId)) throw new Error("deploy marker chain contains a duplicate marker.");
      ids.add(marker.markerId);
      const before = previousRestarts + index;
      if (marker.beforeRestarts !== before || marker.afterRestarts !== before + 1) {
        throw new Error("deploy marker chain is reordered or has a missing edge.");
      }
      if (marker.target !== target || marker.host !== host || marker.processName !== processName) {
        throw new Error("deploy marker target, host, or process does not match.");
      }
      if (marker.beforeUnstableRestarts !== previousUnstableRestarts || marker.afterUnstableRestarts !== previousUnstableRestarts) {
        throw new Error("deploy marker unstable restart metadata does not match.");
      }
      const createdMs = Date.parse(marker.createdAt);
      const expiresMs = Date.parse(marker.expiresAt);
      if (createdMs > nowMs + 5 * 60 * 1000) throw new Error("deploy marker is future-dated.");
      if (nowMs - createdMs > maxAgeMs || expiresMs <= nowMs) throw new Error("deploy marker is stale.");
    }

    const final = markers.at(-1);
    if (final.startedAt !== currentStartedAt) throw new Error("final deploy marker process start does not match.");
    if (final.branch !== currentBranch || final.commit !== currentCommit) {
      throw new Error("final deploy marker branch or commit does not match the running process.");
    }
    return {
      trusted: true,
      reason: null,
      markerIds: markers.map((marker) => marker.markerId),
      markerKeys: markers.map((marker) => pm2DeployMarkerKey(marker.processName, marker.afterRestarts)),
    };
  } catch (error) {
    return { trusted: false, reason: error.message, markerIds: [], markerKeys: [] };
  }
}
