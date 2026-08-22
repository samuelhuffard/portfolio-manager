-- Broker fills and Sheets can carry fractional shares beyond four decimals.
-- Keep both lot quantities at the same precision as proposal fulfillment and
-- position shares so the Neon shadow cannot silently round residual lots.
ALTER TABLE lots ALTER COLUMN shares_original TYPE NUMERIC(18,8);
ALTER TABLE lots ALTER COLUMN shares_open TYPE NUMERIC(18,8);
