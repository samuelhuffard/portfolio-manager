export function parsePerformanceRow(row) {
  return {
    date: row[0],
    portfolioValue: row[1] != null && row[1] !== "" ? Number(row[1]) : null,
    spyPrice: row[2] != null && row[2] !== "" ? Number(row[2]) : null,
    unitsOutstanding: row[3] != null && row[3] !== "" ? Number(row[3]) : null,
    navPerUnit: row[4] != null && row[4] !== "" ? Number(row[4]) : null,
    rowHmac: row[5] || null,
    sourceRequestId: row[6] || null,
    sourceRequestHmac: row[7] || null,
    sourceInvocationId: row[8] || null,
    sourceInvocationHmac: row[9] || null,
  };
}

export function parseTradeRow(row) {
  return {
    date: row[0],
    ticker: row[1],
    side: row[2],
    shares: Number(row[3]),
    price: Number(row[4]),
    amount: Number(row[5]),
    orderId: row[6] || null,
    agentId: row[7] || "unattributed",
    proposalId: row[8] || null,
    realizedGain: row[9] !== "" && row[9] != null ? Number(row[9]) : null,
    rowHmac: row[10] || null,
  };
}

export function parseLotRow(row, rowIndex) {
  return {
    rowIndex,
    lotId: row[0],
    ticker: row[1],
    openDate: row[2],
    agentId: row[3] || "unattributed",
    costPerShare: Number(row[4]),
    sharesOriginal: Number(row[5]),
    sharesOpen: Number(row[6]),
    status: row[7] || "OPEN",
    rowHmac: row[8] || null,
  };
}

export function parseWithdrawalOperationRow(row) {
  return {
    operationId: row[0] || null,
    createdAt: row[1] || null,
    planJson: row[2] || null,
    rowHmac: row[3] || null,
  };
}
