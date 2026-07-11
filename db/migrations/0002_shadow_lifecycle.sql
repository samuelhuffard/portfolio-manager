-- Complete the proposal lifecycle shadow added by 0001. Redis remains
-- authoritative; these nullable fields only let Postgres represent the same
-- decide/reject/fulfill state for parity observation.
ALTER TABLE proposals ADD COLUMN fulfilled_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN fulfilled_order_id TEXT;
ALTER TABLE proposals ADD COLUMN fulfilled_shares NUMERIC(18,4);

-- Canonical StrategyLot permits the explicit "legacy" sentinel. The original
-- DATE column rejected precisely those quarantined unattributed lots that the
-- ownership migration must preserve and observe.
ALTER TABLE lots ALTER COLUMN open_date TYPE TEXT USING open_date::text;
