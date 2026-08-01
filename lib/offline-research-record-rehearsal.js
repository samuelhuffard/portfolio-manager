// Offline-only append-only rehearsal. It intentionally has no database, runtime,
// scheduler, network, proposal, or model imports. The production writer is covered
// separately by pg-research-observations tests; this module proves that fixture
// identities and replay semantics remain inspectable without production storage.
import { createHash } from "node:crypto";

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createOfflineResearchRecordRehearsal() {
  const records = new Map();
  return Object.freeze({
    append(record) {
      if (!record?.id || !record?.kind || !record?.payload) throw new TypeError("offline record requires id, kind, and payload");
      const contentHash = digest({ kind: record.kind, payload: record.payload });
      const existing = records.get(record.id);
      if (existing && existing.contentHash !== contentHash) throw new TypeError(`offline replay conflict for ${record.id}`);
      if (!existing) records.set(record.id, Object.freeze({ id: record.id, kind: record.kind, contentHash }));
      return Object.freeze({ id: record.id, inserted: !existing, contentHash });
    },
    snapshot() {
      return Object.freeze([...records.values()].sort((a, b) => a.id.localeCompare(b.id)));
    },
  });
}
