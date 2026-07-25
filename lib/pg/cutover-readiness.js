const DAY_MS = 24 * 60 * 60 * 1000;

function isoDay(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

function daysBefore(asOf, count) {
  const end = new Date(`${asOf}T00:00:00.000Z`).getTime();
  return Array.from({ length: count }, (_, index) => new Date(end - index * DAY_MS).toISOString().slice(0, 10));
}

/** Evaluate evidence only; it does not enable a reader, writer, or migration. */
export function evaluateCanonicalCutoverReadiness({ parityHistory = [], reconciliation = null, recoveryProof = null, asOf = new Date().toISOString() } = {}) {
  const latestByDay = new Map();
  for (const record of parityHistory) {
    const day = isoDay(record?.comparedAt);
    if (day) latestByDay.set(day, record);
  }
  const asOfDay = isoDay(asOf);
  const requiredDays = asOfDay ? daysBefore(asOfDay, 30) : [];
  const cleanDays = requiredDays.filter((day) => {
    const record = latestByDay.get(day);
    return record?.ok === true && record?.valuation?.status === "EXACT_MATCH";
  });
  const recoveryValid = recoveryProof?.provider === "neon"
    && ["pitr", "pg_dump_restore"].includes(recoveryProof?.method)
    && recoveryProof?.status === "verified"
    && recoveryProof?.digestVerified === true
    && recoveryProof?.ledgerVerified === true
    && recoveryProof?.sequenceVerified === true;

  const gates = {
    parityWindow: cleanDays.length === 30,
    latestProposalDelivery: reconciliation?.ok === true && reconciliation?.failed === 0,
    providerRecovery: recoveryValid,
    writerCoverage: recoveryProof?.writerCoverageVerified === true,
    rollbackDrill: recoveryProof?.rollbackDrillVerified === true,
  };
  return {
    ok: Object.values(gates).every(Boolean),
    gates,
    cleanDays: cleanDays.length,
    missingDays: requiredDays.filter((day) => !cleanDays.includes(day)),
  };
}
