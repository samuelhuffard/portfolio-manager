-- Replaceable position valuation provenance. These columns never change the
-- transactional position digest; they only allow an exact market-value
-- comparison when Sheets and Postgres hold the same provider quote set.
ALTER TABLE positions ADD COLUMN IF NOT EXISTS quote_snapshot_version TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS quote_source TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS quote_timestamp TIMESTAMPTZ;
