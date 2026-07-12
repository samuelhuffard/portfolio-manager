-- Preserve the precision present in broker/Sheets projections. The initial
-- shadow schema used four decimal places for share quantities, which rounded
-- small fractional positions and made a clean parity comparison impossible.
ALTER TABLE proposals ALTER COLUMN fulfilled_shares TYPE NUMERIC(18,8);
ALTER TABLE positions ALTER COLUMN shares TYPE NUMERIC(18,8);
