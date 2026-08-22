-- Locally-observed consensus-estimate history (mandate v3 Category A/B).
--
-- Append-only and point-in-time by construction. `estimateRevisions` is a
-- CHANGE over time, so it cannot be derived from any single fetch: the value
-- only exists once this table has accumulated snapshots. Redis is deliberately
-- not the store — it is a TTL presentation cache here, and a silently expired
-- 90-day revision window would read as "no signal" rather than as data loss.
--
-- Advisory research history only: isolated from the money, proposal, order and
-- accounting paths, exactly like the 0004 research tables.

CREATE TABLE IF NOT EXISTS consensus_snapshots (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  period TEXT NOT NULL,
  -- When THIS system observed the estimate. Revision math differences are taken
  -- between these instants, never against vendor-asserted trailing figures.
  retrieved_at TIMESTAMPTZ NOT NULL,
  -- The fiscal period the consensus targets. Pairing a beat against an actual
  -- requires matching this to the EDGAR filing's period end, so it is indexed
  -- rather than left inside the payload.
  period_end_date TIMESTAMPTZ,
  eps_avg NUMERIC(20,6),
  revenue_avg NUMERIC(28,4),
  source TEXT NOT NULL,
  payload JSONB NOT NULL,
  content_hash TEXT NOT NULL UNIQUE CHECK (content_hash ~ '^[0-9a-f]{64}$')
);

-- The read path is always "this ticker's observed history up to an instant",
-- so the index leads with ticker and orders by observation time.
CREATE INDEX IF NOT EXISTS consensus_snapshots_ticker_retrieved_at_idx
  ON consensus_snapshots(ticker, retrieved_at DESC);

-- One observation per ticker/period/instant. A re-run of the same collection
-- pass must not deepen the history and inflate the apparent snapshot count,
-- which is what gates estimateRevisions activation.
CREATE UNIQUE INDEX IF NOT EXISTS consensus_snapshots_identity_idx
  ON consensus_snapshots(ticker, period, retrieved_at);
