const MAX_BROKER_SNAPSHOT_AGE_MS = 12 * 60 * 60 * 1000;
const normalizedTicker = (value) => String(value ?? "").trim().toUpperCase();

export function assertBrokerZeroHoldingSnapshot({ holdings, rawRows, quoteSnapshot, ticker, now = new Date() }) {
  if (!quoteSnapshot?.quoteTimestamp || !Number.isFinite(Date.parse(quoteSnapshot.quoteTimestamp))) throw new Error("Broker Holdings quote snapshot is missing or invalid.");
  const ageMs = now.getTime() - Date.parse(quoteSnapshot.quoteTimestamp);
  if (ageMs < 0 || ageMs > MAX_BROKER_SNAPSHOT_AGE_MS) throw new Error("Broker Holdings quote snapshot is stale.");
  if (!Array.isArray(holdings) || holdings.length === 0 || !Array.isArray(rawRows)) throw new Error("Broker Holdings projection is empty or unreadable.");
  const wanted = normalizedTicker(ticker);
  for (const row of rawRows) {
    if (normalizedTicker(row?.[0]) !== wanted) continue;
    const shares = Number(row?.[2]);
    if (!Number.isFinite(shares)) throw new Error(`Broker Holdings shares for ${wanted} are unreadable.`);
    if (shares !== 0) throw new Error(`Broker-backed Holdings still reports ${shares} ${wanted} shares; refusing to close lot.`);
  }
  const brokerPosition = holdings.find((row) => normalizedTicker(row?.ticker) === wanted && Number(row.shares) > 0);
  if (brokerPosition) throw new Error(`Broker-backed Holdings still reports ${brokerPosition.shares} ${wanted} shares; refusing to close lot.`);
  return { brokerShares: 0, quoteSnapshot };
}

export function planBrokerZeroLotClosure({ lots, holdings, rawRows, quoteSnapshot, lotId, expectedSharesOpen, now }) {
  if (!Array.isArray(lots) || !Array.isArray(holdings)) throw new TypeError("lots and holdings are required arrays.");
  const lot = lots.find((row) => row?.lotId === lotId);
  if (!lot || lot.status !== "OPEN" || !Number.isFinite(lot.sharesOpen) || lot.sharesOpen <= 0) throw new Error(`Lot ${lotId} is not an open positive-share lot.`);
  if (!Number.isFinite(expectedSharesOpen) || expectedSharesOpen <= 0 || lot.sharesOpen !== expectedSharesOpen) throw new Error(`Lot ${lotId} no longer has the expected open-share residual.`);
  const broker = assertBrokerZeroHoldingSnapshot({ holdings, rawRows, quoteSnapshot, ticker: lot.ticker, now });
  return { originalLot: lot, updatedLot: { ...lot, sharesOpen: 0, status: "CLOSED" }, brokerShares: broker.brokerShares };
}
