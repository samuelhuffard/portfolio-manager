import fs from "fs";
import { google } from "googleapis";
import { assertInvestorLedgerEntries, investorLedgerRow, parseInvestorLedgerRow } from "./investor-ledger.js";
import { assertOperationalLedgerEntries, assertPerformanceSourceRequestEntries, computePerformanceSourceRequestHmac, signOperationalLedgerEntry } from "./operational-ledger.js";
import { parseLotRow, parsePerformanceRow, parseTradeRow } from "./operational-ledger-rows.js";
import { holdingRowLabel, isSecurityHoldingRow } from "./holdings-rows.js";
import { buildHoldingsValuationDigest, roundDecimalNumber } from "./quote-snapshot.js";
import { getCachedSharedSpreadsheetId, setCachedSharedSpreadsheetId } from "./redis.js";

const SPREADSHEET_TITLE = "Sam's Portfolio Manager";
const AGENT_TAB_NAMES = ["Agent-1", "Agent-2", "Agent-3"];
const TABS = ["Overview", "Holdings", "Market Scans", "Performance", "Trade Ledger", "Lots", "Investors", "Track Record", ...AGENT_TAB_NAMES];

/** "agent-1" -> "Agent-1" — the single internal tab each agent reads/writes for its own history. */
export function agentTabName(agentId) {
  return agentId.replace(/^agent-/, "Agent-");
}

const C_NAVY = { red: 0.063, green: 0.094, blue: 0.157 };
const C_WHITE = { red: 1, green: 1, blue: 1 };
const C_GRAY = { red: 0.95, green: 0.95, blue: 0.95 };
const C_GREEN = { red: 0.851, green: 0.918, blue: 0.839 };
const C_RED = { red: 0.980, green: 0.878, blue: 0.878 };
const C_LIGHT_BLUE = { red: 0.851, green: 0.918, blue: 0.965 };
const C_YELLOW = { red: 1, green: 0.949, blue: 0.78 };
const C_GREEN_TEXT = { red: 0.106, green: 0.467, blue: 0.216 };
const C_RED_TEXT = { red: 0.706, green: 0.118, blue: 0.118 };

const CURRENCY_FMT = '"$"#,##0.00;-"$"#,##0.00';
const SIGNED_PERCENT_FMT = '+0.00"%";-0.00"%";0.00"%"';
const PLAIN_PERCENT_FMT = '0.0"%"';
const SCORE_FMT = '0"/100"';

// ── Auth ───────────────────────────────────────────────────────────────────

export function getServiceAccountClients() {
  let credentials;
  if (process.env.GOOGLE_SERVICE_ACCOUNT) {
    credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT, "base64").toString("utf8"));
  } else {
    credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_CREDENTIALS_PATH, "utf8"));
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"],
  });
  return {
    sheets: google.sheets({ version: "v4", auth }),
    drive: google.drive({ version: "v3", auth }),
  };
}

export async function getSheetIds(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const ids = {};
  for (const s of meta.data.sheets) ids[s.properties.title] = s.properties.sheetId;
  return ids;
}

/**
 * Ensure all required tabs exist on a spreadsheet, adding any that are missing.
 * Used both for a freshly-created spreadsheet and for an existing one Sam shared with us
 * (service accounts on personal Drives have 0 storage quota and can't call spreadsheets.create).
 */
export async function ensureTabs(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTitles = new Set(meta.data.sheets.map((s) => s.properties.title));
  const missing = TABS.filter((t) => !existingTitles.has(t));

  const requests = missing.map((title) =>
    title === "Overview"
      ? { addSheet: { properties: { title, index: 0 } } }
      : { addSheet: { properties: { title } } }
  );

  // Clean up the default "Sheet1" tab Google adds to brand-new spreadsheets, if it's unused.
  // Bundled into the same batchUpdate as any tabs being added so the sheet count never
  // transiently hits zero — the Sheets API rejects removing the last sheet in a document,
  // which is exactly what happens on a truly blank Sheet if the delete runs as its own call.
  const sheet1 = meta.data.sheets.find((s) => s.properties.title === "Sheet1");
  if (sheet1) {
    const vals = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Sheet1!A1:Z10" });
    if (!vals.data.values?.length) requests.push({ deleteSheet: { sheetId: sheet1.properties.sheetId } });
  }

  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  }

  for (const tab of missing.filter((t) => AGENT_TAB_NAMES.includes(t))) {
    await seedAgentTabLayout(sheets, spreadsheetId, tab);
  }
}

/**
 * Seeds the fixed layout for a freshly-created Agent-N tab: a strategy-notes row
 * (read by the AI overlay each research cycle, editable by Sam), a Track Record
 * block, then the Recommendations header. Purely an internal working tab for the
 * agent's own continuity — not styled for investor-facing readability.
 */
async function seedAgentTabLayout(sheets, spreadsheetId, tabName) {
  const rows = [
    [`${tabName} — internal working tab (not shown to investors)`],
    ["Strategy Notes (edit freely — read verbatim by the AI overlay each research cycle)"],
    [""],
    [""],
    ["Track Record", "", "", "", ""],
    ["Horizon", "Evaluated", "Hit Rate (%)", "Avg Return (%)", "Avg Alpha vs SPY (%)"],
    ["30 Day", "", "", "", ""],
    ["90 Day", "", "", "", ""],
    ["180 Day", "", "", "", ""],
    [""],
    ["Recommendations"],
    REC_HEADERS,
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

/**
 * Resolves the spreadsheet to use: the caller's configured ID (preferred — Sam
 * creates a blank Sheet in his own Drive and shares it with the service account
 * as Editor, since service accounts on personal Drives have 0 storage quota and
 * cannot call spreadsheets.create), or falls back to creating one. Callers are
 * expected to check their own Redis cache (see getCachedSharedSpreadsheetId) before
 * calling this — this function only resolves/creates, it doesn't cache.
 */
export async function getOrCreateSpreadsheet(sheets, drive, configuredSpreadsheetId) {
  if (configuredSpreadsheetId) {
    await ensureTabs(sheets, configuredSpreadsheetId);
    console.log(`[Sheets] Using configured spreadsheet: https://docs.google.com/spreadsheets/d/${configuredSpreadsheetId}`);
    return configuredSpreadsheetId;
  }

  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: SPREADSHEET_TITLE },
      sheets: TABS.map((title, index) => ({ properties: { title, sheetId: index, index } })),
    },
  });
  const spreadsheetId = res.data.spreadsheetId;

  const samEmail = process.env.SAM_EMAIL;
  if (samEmail) {
    await drive.permissions.create({
      fileId: spreadsheetId,
      requestBody: { role: "writer", type: "user", emailAddress: samEmail },
      sendNotificationEmail: false,
    });
  }

  for (const tab of AGENT_TAB_NAMES) {
    await seedAgentTabLayout(sheets, spreadsheetId, tab);
  }

  console.log(`[Sheets] Spreadsheet created: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  return spreadsheetId;
}

/**
 * Resolves the one shared spreadsheet for the whole portfolio (cached in Redis
 * after the first lookup) — the single place every job/script should call
 * instead of re-deriving SPREADSHEET_ID + cache logic themselves.
 */
export async function resolveSharedSpreadsheetId(sheets, drive) {
  let spreadsheetId = await getCachedSharedSpreadsheetId();
  if (!spreadsheetId) {
    spreadsheetId = await getOrCreateSpreadsheet(sheets, drive, process.env.SPREADSHEET_ID?.trim());
    await setCachedSharedSpreadsheetId(spreadsheetId);
  } else {
    await ensureTabs(sheets, spreadsheetId);
  }
  return spreadsheetId;
}

// ── Formatting helpers ────────────────────────────────────────────────────

function colorReq(sheetId, r1, r2, c1, c2, color) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 },
      cell: { userEnteredFormat: { backgroundColor: color } },
      fields: "userEnteredFormat.backgroundColor",
    },
  };
}

function textReq(sheetId, r1, r2, c1, c2, { bold, italic, color, fontSize } = {}) {
  const textFormat = {};
  if (bold !== undefined) textFormat.bold = bold;
  if (italic !== undefined) textFormat.italic = italic;
  if (color) textFormat.foregroundColor = color;
  if (fontSize) textFormat.fontSize = fontSize;
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 },
      cell: { userEnteredFormat: { textFormat } },
      fields: "userEnteredFormat.textFormat",
    },
  };
}

function numberFormatReq(sheetId, r1, r2, c1, c2, type, pattern) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 },
      cell: { userEnteredFormat: { numberFormat: { type, pattern } } },
      fields: "userEnteredFormat.numberFormat",
    },
  };
}

function mergeReq(sheetId, r1, r2, c1, c2) {
  return { mergeCells: { range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 }, mergeType: "MERGE_ALL" } };
}

function unmergeReq(sheetId, r2, c2) {
  return { unmergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: r2, startColumnIndex: 0, endColumnIndex: c2 } } };
}

function clearFormatReq(sheetId, r2, c2) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: r2, startColumnIndex: 0, endColumnIndex: c2 },
      cell: {},
      fields: "userEnteredFormat",
    },
  };
}

function columnWidthReq(sheetId, c1, c2, width) {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: c1, endIndex: c2 },
      properties: { pixelSize: width },
      fields: "pixelSize",
    },
  };
}

function freezeReq(sheetId, rows = 1) {
  return {
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: rows } },
      fields: "gridProperties.frozenRowCount",
    },
  };
}

async function ensureHeaders(sheets, spreadsheetId, sheetId, tabName, headers, columnFormats = {}) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A1:${String.fromCharCode(64 + headers.length)}1` });
  if (res.data.values?.length) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] },
  });
  const requests = [
    freezeReq(sheetId, 1),
    colorReq(sheetId, 0, 1, 0, headers.length, C_NAVY),
    textReq(sheetId, 0, 1, 0, headers.length, { bold: true, color: C_WHITE }),
  ];
  for (const [colIndex, fmt] of Object.entries(columnFormats)) {
    requests.push(numberFormatReq(sheetId, 1, 1000, Number(colIndex), Number(colIndex) + 1, fmt.type, fmt.pattern));
  }
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

/**
 * Like ensureHeaders, but extends an existing header row with new trailing
 * columns instead of skipping when headers already exist. Used for tabs
 * whose schema has grown (e.g. Recommendations gaining forward-return columns)
 * so older sheets migrate in place instead of needing a manual reset.
 */
async function ensureHeadersExtendable(sheets, spreadsheetId, sheetId, tabName, headers, columnFormats = {}) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A1:${String.fromCharCode(64 + headers.length)}1` });
  const existing = res.data.values?.[0] ?? [];
  if (existing.length >= headers.length) return;
  const startCol = existing.length;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!${String.fromCharCode(65 + startCol)}1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers.slice(startCol)] },
  });
  const requests = [
    freezeReq(sheetId, 1),
    colorReq(sheetId, 0, 1, startCol, headers.length, C_NAVY),
    textReq(sheetId, 0, 1, startCol, headers.length, { bold: true, color: C_WHITE }),
  ];
  for (const [colIndex, fmt] of Object.entries(columnFormats)) {
    const ci = Number(colIndex);
    if (ci >= startCol) requests.push(numberFormatReq(sheetId, 1, 1000, ci, ci + 1, fmt.type, fmt.pattern));
  }
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

// ── Overview tab (rewritten each holdings sync) ─────────────────────────────

export async function writeOverviewTab(sheets, spreadsheetId, sheetId, data) {
  const {
    timestamp,
    totalValue,
    cash,
    investedValue,
    totalGainLoss,
    totalGainLossPct,
    numHoldings,
    best,
    worst,
    portfolioReturnPct,
    spyReturnPct,
    allocation = [],
    isSample = false,
  } = data;

  const rows = [];
  const requests = [];
  let r = 0;

  // Title banner
  rows.push(["📊 Sam's Portfolio — Overview", "", "", ""]);
  requests.push(
    mergeReq(sheetId, r, r + 1, 0, 4),
    colorReq(sheetId, r, r + 1, 0, 4, C_NAVY),
    textReq(sheetId, r, r + 1, 0, 4, { bold: true, color: C_WHITE, fontSize: 14 })
  );
  r++;

  // Last updated / sample banner
  if (isSample) {
    rows.push([`⚠️ Sample data — preview only, replaced after the first live sync. (${timestamp})`, "", "", ""]);
    requests.push(
      mergeReq(sheetId, r, r + 1, 0, 4),
      colorReq(sheetId, r, r + 1, 0, 4, C_YELLOW),
      textReq(sheetId, r, r + 1, 0, 4, { bold: true, italic: true })
    );
  } else {
    rows.push([`Last updated: ${timestamp}`, "", "", ""]);
    requests.push(mergeReq(sheetId, r, r + 1, 0, 4), textReq(sheetId, r, r + 1, 0, 4, { italic: true, color: { red: 0.4, green: 0.4, blue: 0.4 } }));
  }
  r++;

  // blank row
  rows.push(["", "", "", ""]);
  r++;

  // Snapshot section header
  rows.push(["Snapshot", "", "", ""]);
  requests.push(
    mergeReq(sheetId, r, r + 1, 0, 4),
    colorReq(sheetId, r, r + 1, 0, 4, C_LIGHT_BLUE),
    textReq(sheetId, r, r + 1, 0, 4, { bold: true })
  );
  r++;

  const gainColor = totalGainLoss >= 0 ? C_GREEN_TEXT : C_RED_TEXT;
  rows.push(["Total Portfolio Value", totalValue, "Total Gain/Loss", totalGainLoss]);
  requests.push(
    numberFormatReq(sheetId, r, r + 1, 1, 2, "CURRENCY", CURRENCY_FMT),
    textReq(sheetId, r, r + 1, 0, 1, { bold: true }),
    numberFormatReq(sheetId, r, r + 1, 3, 4, "NUMBER", CURRENCY_FMT),
    textReq(sheetId, r, r + 1, 3, 4, { bold: true, color: gainColor })
  );
  r++;

  rows.push(["Cash", cash, "Total Return", totalGainLossPct]);
  requests.push(
    numberFormatReq(sheetId, r, r + 1, 1, 2, "CURRENCY", CURRENCY_FMT),
    numberFormatReq(sheetId, r, r + 1, 3, 4, "NUMBER", SIGNED_PERCENT_FMT),
    textReq(sheetId, r, r + 1, 3, 4, { bold: true, color: gainColor })
  );
  r++;

  rows.push(["Invested in Stocks", investedValue, "Number of Holdings", numHoldings]);
  requests.push(numberFormatReq(sheetId, r, r + 1, 1, 2, "CURRENCY", CURRENCY_FMT));
  r++;

  let vsSpyText = "Not enough history yet — check back tomorrow";
  if (portfolioReturnPct != null && spyReturnPct != null) {
    const youSign = portfolioReturnPct >= 0 ? "+" : "";
    const spySign = spyReturnPct >= 0 ? "+" : "";
    vsSpyText = `You: ${youSign}${portfolioReturnPct.toFixed(2)}%   ·   S&P 500: ${spySign}${spyReturnPct.toFixed(2)}%`;
  }
  rows.push(["Performance vs S&P 500", vsSpyText, "", ""]);
  requests.push(mergeReq(sheetId, r, r + 1, 1, 4), textReq(sheetId, r, r + 1, 0, 1, { bold: true }));
  r++;

  rows.push([
    "Best Performer",
    best ? `${best.ticker}  (+${best.gainLossPct.toFixed(2)}%)` : "—",
    "Worst Performer",
    worst ? `${worst.ticker}  (${worst.gainLossPct.toFixed(2)}%)` : "—",
  ]);
  requests.push(textReq(sheetId, r, r + 1, 0, 1, { bold: true }), textReq(sheetId, r, r + 1, 2, 3, { bold: true }));
  if (best) requests.push(textReq(sheetId, r, r + 1, 1, 2, { color: C_GREEN_TEXT, bold: true }));
  if (worst) requests.push(textReq(sheetId, r, r + 1, 3, 4, { color: worst.gainLossPct >= 0 ? C_GREEN_TEXT : C_RED_TEXT, bold: true }));
  r++;

  // blank row
  rows.push(["", "", "", ""]);
  r++;

  // Allocation section header
  rows.push(["Allocation", "", "", ""]);
  requests.push(
    mergeReq(sheetId, r, r + 1, 0, 4),
    colorReq(sheetId, r, r + 1, 0, 4, C_LIGHT_BLUE),
    textReq(sheetId, r, r + 1, 0, 4, { bold: true })
  );
  r++;

  rows.push(["Ticker", "Company", "Market Value", "% of Portfolio"]);
  requests.push(colorReq(sheetId, r, r + 1, 0, 4, C_NAVY), textReq(sheetId, r, r + 1, 0, 4, { bold: true, color: C_WHITE }));
  r++;

  const allocStart = r;
  for (const a of allocation) {
    rows.push([a.ticker, a.name, a.marketValue, a.pct]);
    r++;
  }
  if (allocation.length) {
    requests.push(
      numberFormatReq(sheetId, allocStart, r, 2, 3, "CURRENCY", CURRENCY_FMT),
      numberFormatReq(sheetId, allocStart, r, 3, 4, "NUMBER", PLAIN_PERCENT_FMT)
    );
  }

  const totalRows = Math.max(r, 30);

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: "Overview" });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Overview!A1",
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        unmergeReq(sheetId, totalRows, 4),
        clearFormatReq(sheetId, totalRows, 4),
        columnWidthReq(sheetId, 0, 1, 200),
        columnWidthReq(sheetId, 1, 4, 170),
        ...requests,
      ],
    },
  });
}

// ── Holdings tab (overwritten each sync) ────────────────────────────────────

export async function writeHoldingsTab(sheets, spreadsheetId, sheetId, holdings, cash, timestamp, note, quoteSnapshot = null) {
  const headers = ["Ticker", "Company", "Shares", "Avg Cost", "Current Price", "Market Value", "Cost Basis", "Gain/Loss ($)", "Return (%)"];
  const rows = [headers];
  for (const h of holdings) {
    rows.push([
      h.ticker,
      h.name ?? "",
      h.shares,
      h.avgCost,
      h.currentPrice ?? "",
      h.marketValue != null ? roundDecimalNumber(h.marketValue, 2) : "",
      h.costBasis != null ? roundDecimalNumber(h.costBasis, 2) : "",
      h.gainLoss != null ? roundDecimalNumber(h.gainLoss, 2) : "",
      h.gainLossPct != null ? Math.round(h.gainLossPct * 100) / 100 : "",
    ]);
  }
  const cashRowIndex = rows.length;
  rows.push(["Cash", "", "", "", "", cash ?? "", "", "", ""]);
  const syncedRowIndex = rows.length;
  // Bind provenance to the exact rounded cells being written, not the
  // pre-render objects (whose binary-float edge cases may round differently).
  const valuationInventoryDigest = quoteSnapshot
    ? buildHoldingsValuationDigest(rows.slice(1, cashRowIndex))
    : "";
  rows.push([
    `Last synced: ${timestamp}`,
    quoteSnapshot?.quoteSnapshotVersion ?? "",
    quoteSnapshot?.quoteSource ?? "",
    quoteSnapshot?.quoteTimestamp ?? "",
    valuationInventoryDigest,
  ]);
  let noteRowIndex = null;
  if (note) {
    noteRowIndex = rows.length;
    rows.push([note, "", "", "", "", "", "", "", ""]);
  }

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: "Holdings" });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Holdings!A1",
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });

  const requests = [
    unmergeReq(sheetId, rows.length + 5, headers.length),
    clearFormatReq(sheetId, rows.length + 5, headers.length),
    freezeReq(sheetId, 1),
    colorReq(sheetId, 0, 1, 0, headers.length, C_NAVY),
    textReq(sheetId, 0, 1, 0, headers.length, { bold: true, color: C_WHITE }),
    columnWidthReq(sheetId, 0, 1, 80),
    columnWidthReq(sheetId, 1, 2, 220),
  ];

  if (holdings.length) {
    requests.push(
      numberFormatReq(sheetId, 1, holdings.length + 1, 3, 8, "CURRENCY", CURRENCY_FMT),
      numberFormatReq(sheetId, 1, holdings.length + 1, 8, 9, "NUMBER", SIGNED_PERCENT_FMT)
    );
    holdings.forEach((h, i) => {
      if (i % 2 === 1) requests.push(colorReq(sheetId, i + 1, i + 2, 0, 7, C_GRAY));
      if (h.gainLossPct == null) return;
      const bg = h.gainLossPct >= 0 ? C_GREEN : C_RED;
      requests.push(colorReq(sheetId, i + 1, i + 2, 7, 9, bg));
    });
  }

  requests.push(
    textReq(sheetId, cashRowIndex, cashRowIndex + 1, 0, 1, { bold: true }),
    numberFormatReq(sheetId, cashRowIndex, cashRowIndex + 1, 5, 6, "CURRENCY", CURRENCY_FMT),
    textReq(sheetId, syncedRowIndex, syncedRowIndex + 1, 0, 1, { italic: true, color: { red: 0.4, green: 0.4, blue: 0.4 } })
  );

  if (noteRowIndex != null) {
    requests.push(
      mergeReq(sheetId, noteRowIndex, noteRowIndex + 1, 0, headers.length),
      colorReq(sheetId, noteRowIndex, noteRowIndex + 1, 0, headers.length, C_YELLOW),
      textReq(sheetId, noteRowIndex, noteRowIndex + 1, 0, headers.length, { bold: true, italic: true })
    );
  }

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

/** Tickers currently held, read back from the Holdings tab (col A, after header). */
export async function readHoldingsTickers(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Holdings!A2:A" });
  return (res.data.values || [])
    .map((row) => holdingRowLabel(row))
    .filter((label) => isSecurityHoldingRow(label));
}

/** Current idle cash balance from the Holdings tab's Cash row, for withdrawal funding decisions. */
export async function readCashBalance(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Holdings!A2:F",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const cashRow = (res.data.values || []).find((row) => /^cash$/i.test(String(row?.[0] ?? "").trim()));
  const cash = cashRow?.[5] === "" || cashRow?.[5] == null ? null : Number(cashRow[5]);
  return Number.isFinite(cash) ? cash : 0;
}

/** Ticker, shares held, and current price for current holdings — for withdrawal sell-down decisions. */
export async function readHoldingsDetail(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Holdings!A2:G",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return (res.data.values || [])
    .filter((row) => isSecurityHoldingRow(row))
    .map((row) => ({
      ticker: row[0],
      shares: row[2] !== "" && row[2] != null ? Number(row[2]) : 0,
      currentPrice: row[4] !== "" && row[4] != null ? Number(row[4]) : null,
      marketValue: row[5] !== "" && row[5] != null ? Number(row[5]) : null,
      costBasis: row[6] !== "" && row[6] != null ? Number(row[6]) : null,
    }));
}

/** Complete current-position projection for the non-authoritative Postgres mirror. */
export function parseHoldingsProjection(rows) {
  const numericCell = (value) => {
    if (value === "" || value == null) return null;
    const parsed = Number(String(value).replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  };
  return (rows || [])
    .filter((row) => isSecurityHoldingRow(row))
    .map((row) => ({
      ticker: row[0], name: row[1] || null,
      shares: numericCell(row[2]) ?? 0,
      avgCost: numericCell(row[3]), costBasis: numericCell(row[6]), marketValue: numericCell(row[5]),
    }));
}

export async function readHoldingsProjection(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Holdings!A2:G", valueRenderOption: "UNFORMATTED_VALUE" });
  return parseHoldingsProjection(res.data.values || []);
}

/** Parse provider quote-set identity from the non-security Last synced row. */
export function parseHoldingsQuoteSnapshot(rows) {
  const marker = (rows ?? []).find((row) => /^last synced\b/i.test(String(row?.[0] ?? "").trim()));
  const quoteSnapshotVersion = String(marker?.[1] ?? "").trim();
  const quoteSource = String(marker?.[2] ?? "").trim();
  const rawTimestamp = String(marker?.[3] ?? "").trim();
  const recordedValuationDigest = String(marker?.[4] ?? "").trim();
  const parsedTimestamp = Date.parse(rawTimestamp);
  const valuationRows = (rows ?? []).filter((row) => isSecurityHoldingRow(row));
  const currentValuationDigest = buildHoldingsValuationDigest(valuationRows);
  if (
    !quoteSnapshotVersion || !quoteSource || !Number.isFinite(parsedTimestamp)
    || !recordedValuationDigest || recordedValuationDigest !== currentValuationDigest
  ) return null;
  return { quoteSnapshotVersion, quoteSource, quoteTimestamp: new Date(parsedTimestamp).toISOString() };
}

/** Read the quote provenance paired with the current Holdings projection. */
export async function readHoldingsQuoteSnapshot(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Holdings!A2:G", valueRenderOption: "UNFORMATTED_VALUE" });
  return parseHoldingsQuoteSnapshot(res.data.values || []);
}

/** Read current Holdings rows and their content-bound quote provenance atomically. */
export async function readHoldingsProjectionWithQuoteSnapshot(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Holdings!A2:G", valueRenderOption: "UNFORMATTED_VALUE" });
  const rows = res.data.values || [];
  return {
    holdings: parseHoldingsProjection(rows),
    quoteSnapshot: parseHoldingsQuoteSnapshot(rows),
    rawRows: rows,
  };
}

/** Latest signed Performance projection plus current Holdings cash for parity. */
export async function readLatestAccountingProjection(sheets, spreadsheetId) {
  const [history, holdingsResponse] = await Promise.all([
    readPerformanceHistory(sheets, spreadsheetId),
    sheets.spreadsheets.values.get({ spreadsheetId, range: "Holdings!A2:G", valueRenderOption: "UNFORMATTED_VALUE" }),
  ]);
  const latest = history.at(-1);
  const cashRow = (holdingsResponse.data.values || []).find((row) => /^cash$/i.test(String(row?.[0] ?? "").trim()));
  const cash = cashRow?.[5] === "" || cashRow?.[5] == null ? null : Number(cashRow[5]);
  if (!latest || latest.portfolioValue == null || !Number.isFinite(cash)) {
    throw new Error("Latest signed Performance row or Holdings cash is unavailable.");
  }
  return {
    date: latest.date,
    totalValue: latest.portfolioValue,
    cash,
    unitsOutstanding: latest.unitsOutstanding ?? 0,
    navPerUnit: latest.navPerUnit,
  };
}

/** Ticker + market value for current holdings, for the risk engine's sector/position-size checks. */
export async function readHoldingsAllocation(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Holdings!A2:F",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return (res.data.values || [])
    .filter((row) => isSecurityHoldingRow(row))
    .map((row) => ({
      ticker: row[0],
      shares: row[2] !== "" && row[2] != null && Number.isFinite(Number(row[2])) ? Number(row[2]) : null,
      marketValue: row[5] !== "" && row[5] != null ? Number(row[5]) : null,
    }));
}

/**
 * Map of held ticker -> Return (%) from the Holdings tab (column I). Used by Agent One's
 * risk engine (no-averaging-down: a BUY into a position at a loss is blocked) and exit
 * monitor (loss-to-hold prohibition). Returns null returnPct for unparseable rows.
 */
export async function readHoldingsReturnPct(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Holdings!A2:I",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const out = {};
  for (const row of res.data.values || []) {
    const ticker = row[0];
    if (!isSecurityHoldingRow(row)) continue;
    const raw = row[8];
    out[ticker] = raw !== "" && raw != null ? Number(raw) : null;
  }
  return out;
}

// ── Market Scans tab (Robinhood MCP read-only scans + market data) ─────────

const MARKET_SCAN_HEADERS = [
  "Synced At", "Scan", "Ticker", "Company", "Price", "Change (%)", "Volume",
  "Avg Volume", "Market Cap", "Signal", "Score", "Agent Hint", "Notes",
];

function cleanString(value) {
  return value == null ? "" : String(value).trim();
}

function numOrBlank(value) {
  if (value == null || value === "") return "";
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : "";
}

export async function writeMarketScansTab(sheets, spreadsheetId, sheetId, rows, syncedAt = new Date().toISOString()) {
  await ensureHeadersExtendable(sheets, spreadsheetId, sheetId, "Market Scans", MARKET_SCAN_HEADERS, {
    4: { type: "CURRENCY", pattern: CURRENCY_FMT },
    5: { type: "NUMBER", pattern: SIGNED_PERCENT_FMT },
    6: { type: "NUMBER", pattern: "#,##0" },
    7: { type: "NUMBER", pattern: "#,##0" },
    8: { type: "CURRENCY", pattern: '"$"#,##0' },
    10: { type: "NUMBER", pattern: "0.0" },
  });

  const values = rows.map((row) => [
    row.syncedAt ?? syncedAt,
    cleanString(row.scanName ?? row.scan),
    cleanString(row.ticker ?? row.symbol).toUpperCase(),
    cleanString(row.name ?? row.company),
    numOrBlank(row.price ?? row.currentPrice ?? row.lastPrice),
    numOrBlank(row.changePct ?? row.percentChange ?? row.changePercent),
    numOrBlank(row.volume),
    numOrBlank(row.avgVolume ?? row.averageVolume),
    numOrBlank(row.marketCap),
    cleanString(row.signal ?? row.reason),
    numOrBlank(row.score),
    cleanString(row.agentHint ?? row.agentId),
    cleanString(row.notes ?? row.note),
  ]).filter((row) => row[2]);

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: "Market Scans!A2:M" });
  if (!values.length) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Market Scans!A2",
    valueInputOption: "RAW",
    requestBody: { values },
  });

  const requests = [
    columnWidthReq(sheetId, 0, 2, 150),
    columnWidthReq(sheetId, 2, 3, 90),
    columnWidthReq(sheetId, 3, 4, 220),
    columnWidthReq(sheetId, 9, 10, 220),
    columnWidthReq(sheetId, 12, 13, 320),
  ];
  values.forEach((row, i) => {
    if (i % 2 === 1) requests.push(colorReq(sheetId, i + 1, i + 2, 0, MARKET_SCAN_HEADERS.length, C_GRAY));
    if (row[11]) requests.push(colorReq(sheetId, i + 1, i + 2, 11, 12, C_LIGHT_BLUE));
  });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

export async function readMarketScans(sheets, spreadsheetId, limit = 250) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Market Scans!A2:M${limit + 1}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return (res.data.values || [])
    .filter((row) => row[2])
    .map((row) => ({
      syncedAt: row[0] ?? "",
      scanName: row[1] ?? "",
      ticker: row[2] ?? "",
      name: row[3] ?? "",
      price: row[4] !== "" && row[4] != null ? Number(row[4]) : null,
      changePct: row[5] !== "" && row[5] != null ? Number(row[5]) : null,
      volume: row[6] !== "" && row[6] != null ? Number(row[6]) : null,
      avgVolume: row[7] !== "" && row[7] != null ? Number(row[7]) : null,
      marketCap: row[8] !== "" && row[8] != null ? Number(row[8]) : null,
      signal: row[9] ?? "",
      score: row[10] !== "" && row[10] != null ? Number(row[10]) : null,
      agentHint: row[11] ?? "",
      notes: row[12] ?? "",
    }));
}

// ── Performance tab (append one row per sync) ───────────────────────────────

const NAV_FMT = '"$"#,##0.0000';
const PERFORMANCE_HEADERS = ["Date", "Portfolio Value", "S&P 500 (SPY)", "Units Outstanding", "NAV per Unit", "Row HMAC", "Source Request ID", "Source Request HMAC"];

export async function appendPerformanceRow(sheets, spreadsheetId, sheetId, { date, portfolioValue, spyPrice, unitsOutstanding, navPerUnit, sourceRequestId = null }) {
  await ensureHeadersExtendable(sheets, spreadsheetId, sheetId, "Performance", PERFORMANCE_HEADERS, {
    1: { type: "CURRENCY", pattern: CURRENCY_FMT },
    2: { type: "CURRENCY", pattern: CURRENCY_FMT },
    4: { type: "CURRENCY", pattern: NAV_FMT },
  });
  const entry = signOperationalLedgerEntry("performance", {
    date, portfolioValue, spyPrice: spyPrice ?? null, unitsOutstanding: unitsOutstanding ?? null, navPerUnit: navPerUnit ?? null,
  });
  const sourceRequestHmac = computePerformanceSourceRequestHmac({ ...entry, sourceRequestId });
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Performance!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[date, portfolioValue, spyPrice ?? "", unitsOutstanding ?? "", navPerUnit ?? "", entry.rowHmac, sourceRequestId ?? "", sourceRequestHmac ?? ""]] },
  });
}

/** Full performance history, oldest first (excludes header row). */
export async function readPerformanceHistory(sheets, spreadsheetId, { verify = true } = {}) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Performance!A2:H", valueRenderOption: "UNFORMATTED_VALUE" });
  const entries = (res.data.values || []).filter((row) => row[0]).map(parsePerformanceRow);
  return verify ? assertPerformanceSourceRequestEntries(assertOperationalLedgerEntries("performance", entries)) : entries;
}

// ── Investors tab (capital ledger: one row per contribution/withdrawal) ─────

const INVESTOR_HEADERS = ["Date", "Investor Email", "Investor Name", "Type", "Amount ($)", "NAV per Unit", "Units", "Investor ID", "Entry ID", "Row HMAC"];

export async function appendInvestorLedgerEntry(sheets, spreadsheetId, sheetId, entry) {
  await ensureHeadersExtendable(sheets, spreadsheetId, sheetId, "Investors", INVESTOR_HEADERS, {
    4: { type: "CURRENCY", pattern: CURRENCY_FMT },
    5: { type: "CURRENCY", pattern: NAV_FMT },
    6: { type: "NUMBER", pattern: "#,##0.0000" },
  });
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Investors!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [investorLedgerRow(entry)] },
  });

  const match = res.data.updates?.updatedRange?.match(/![A-Z]+(\d+):/);
  if (!match) return;
  const row0 = Number(match[1]) - 1;
  const bg = entry.type === "Withdrawal" ? C_RED : C_GREEN;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [colorReq(sheetId, row0, row0 + 1, 3, 4, bg)] },
  });
}

/** Full capital ledger, oldest first (excludes header row). */
export async function readInvestorLedger(sheets, spreadsheetId, { verify = true } = {}) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Investors!A2:J", valueRenderOption: "UNFORMATTED_VALUE" });
  const entries = (res.data.values || [])
    .filter((row) => row[0])
    .map(parseInvestorLedgerRow);
  return verify ? assertInvestorLedgerEntries(entries) : entries;
}

// ── Agent-N tabs (one per agent: strategy notes + track record + recommendations) ──
// Internal working tabs only — see seedAgentTabLayout for the fixed row layout
// (rows 1-3 strategy banner/notes, rows 5-9 Track Record block, row 11 onward
// Recommendations). Not styled for investor-facing readability per Sam's call —
// that presentation lives entirely in the dashboard.

const ACTION_COLORS = { BUY: C_GREEN, SELL: C_RED, HOLD: C_GRAY, NO_TRADE: C_YELLOW, ERROR: C_RED };

const REC_HEADERS = [
  "Date", "Ticker", "Action", "Quant Score", "AI Rationale", "News Links", "Status",
  "Entry Price", "SPY Entry Price",
  "30D Return (%)", "30D Alpha vs SPY (%)", "30D Hit",
  "90D Return (%)", "90D Alpha vs SPY (%)", "90D Hit",
  "180D Return (%)", "180D Alpha vs SPY (%)", "180D Hit",
  "Target Weight (%)", "Confidence", "Rule Check",
];

/** Column index (0-based) of each forward-return field, per horizon in days. */
const HORIZON_COLUMNS = {
  30: { return: 9, alpha: 10, hit: 11 },
  90: { return: 12, alpha: 13, hit: 14 },
  180: { return: 15, alpha: 16, hit: 17 },
};

const REC_HEADER_ROW = 12; // 1-indexed sheet row of REC_HEADERS within an Agent-N tab
const REC_DATA_START_ROW = REC_HEADER_ROW + 1; // 13

/** Sam's free-text strategy notes for one agent, read verbatim by the AI overlay each research cycle. */
export async function readAgentStrategyNotes(sheets, spreadsheetId, agentId) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${agentTabName(agentId)}!A3` });
  return res.data.values?.[0]?.[0] ?? "";
}

export async function appendAgentRecommendations(sheets, spreadsheetId, sheetId, agentId, recommendations) {
  if (!recommendations.length) return;
  const tab = agentTabName(agentId);
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tab}!A${REC_HEADER_ROW}:U`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: recommendations.map((r) => [
        r.date, r.ticker, r.action, r.quantScore, r.rationale, r.newsLinks, r.status,
        r.entryPrice ?? "", r.spyEntryPrice ?? "",
        "", "", "", "", "", "", "", "", "",
        r.targetWeight ?? "", r.confidence ?? "", r.ruleCheck ?? "OK",
      ]),
    },
  });

  const match = res.data.updates?.updatedRange?.match(/![A-Z]+(\d+):/);
  if (!match) return;
  const startRow0 = Number(match[1]) - 1; // 0-indexed
  const requests = [];
  recommendations.forEach((r, i) => {
    const bg = ACTION_COLORS[r.action];
    if (bg) requests.push(colorReq(sheetId, startRow0 + i, startRow0 + i + 1, 2, 3, bg));
    if (r.ruleCheck && r.ruleCheck !== "OK") requests.push(colorReq(sheetId, startRow0 + i, startRow0 + i + 1, 20, 21, C_YELLOW));
  });
  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

/** Recommendation rows with entry prices + which forward-return horizons are already filled in, for the performance-review job. */
export async function readAgentRecommendationsForReview(sheets, spreadsheetId, agentId) {
  const tab = agentTabName(agentId);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A${REC_DATA_START_ROW}:R` });
  const rows = res.data.values || [];
  return rows.map((row, i) => ({
    rowIndex: i, // 0-indexed data row (sheet row = rowIndex + REC_DATA_START_ROW)
    date: row[0],
    ticker: row[1],
    action: row[2],
    entryPrice: row[7] !== "" && row[7] != null ? Number(row[7]) : null,
    spyEntryPrice: row[8] !== "" && row[8] != null ? Number(row[8]) : null,
    horizonsDone: {
      30: row[HORIZON_COLUMNS[30].return] !== "" && row[HORIZON_COLUMNS[30].return] != null,
      90: row[HORIZON_COLUMNS[90].return] !== "" && row[HORIZON_COLUMNS[90].return] != null,
      180: row[HORIZON_COLUMNS[180].return] !== "" && row[HORIZON_COLUMNS[180].return] != null,
    },
  }));
}

/**
 * Read the immutable-at-source fields needed to backfill the human research
 * audit. This is intentionally read-only: the Sheet remains the provenance
 * for pre-audit recommendation rows.
 */
export async function readAgentRecommendationAuditRows(sheets, spreadsheetId, agentId) {
  const tab = agentTabName(agentId);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A${REC_DATA_START_ROW}:U` });
  const rows = res.data.values || [];
  const num = (value) => (value !== "" && value != null && Number.isFinite(Number(value)) ? Number(value) : null);
  return rows.map((row, rowIndex) => ({
    sheetRow: rowIndex + REC_DATA_START_ROW,
    date: row[0] ?? "",
    ticker: row[1] ?? "",
    action: row[2] ?? "",
    quantScore: num(row[3]),
    rationale: row[4] ?? "",
    status: row[6] ?? "",
    targetWeight: num(row[18]),
    ruleCheck: row[20] ?? "",
  }));
}

/**
 * Full recommendation rows including locked-in forward-return outcomes and the
 * Rule Check column — feeds the weekly-review scorecard (lib/weekly-scorecard.js).
 * Read-only; percent columns are already ×100 in the sheet and pass through as-is.
 */
export async function readAgentRecommendationOutcomes(sheets, spreadsheetId, agentId) {
  const tab = agentTabName(agentId);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A${REC_DATA_START_ROW}:U` });
  const rows = res.data.values || [];
  const num = (v) => (v !== "" && v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  return rows.map((row) => ({
    date: row[0],
    ticker: row[1],
    action: row[2],
    quantScore: num(row[3]),
    return30: num(row[9]),
    alpha30: num(row[10]),
    hit30: row[11] ?? "",
    return90: num(row[12]),
    alpha90: num(row[13]),
    hit90: row[14] ?? "",
    return180: num(row[15]),
    alpha180: num(row[16]),
    hit180: row[17] ?? "",
    targetWeight: num(row[18]),
    confidence: num(row[19]),
    ruleCheck: row[20] ?? "",
  }));
}

const HIT_COLORS = { "✅": C_GREEN, "❌": C_RED };

/** Write computed forward-return outcomes back onto specific recommendation rows (locks in once a horizon is filled — never overwritten). */
export async function applyAgentOutcomeUpdates(sheets, spreadsheetId, sheetId, agentId, updates) {
  if (!updates.length) return;
  const tab = agentTabName(agentId);
  const data = [];
  const colorRequests = [];
  for (const { rowIndex, patch } of updates) {
    const sheetRow = rowIndex + REC_DATA_START_ROW;
    for (const [horizon, p] of Object.entries(patch)) {
      const cols = HORIZON_COLUMNS[horizon];
      data.push({ range: `${tab}!${String.fromCharCode(65 + cols.return)}${sheetRow}`, values: [[Math.round(p.return * 10000) / 100]] });
      if (p.alpha != null) {
        data.push({ range: `${tab}!${String.fromCharCode(65 + cols.alpha)}${sheetRow}`, values: [[Math.round(p.alpha * 10000) / 100]] });
      }
      data.push({ range: `${tab}!${String.fromCharCode(65 + cols.hit)}${sheetRow}`, values: [[p.hit]] });
      const bg = HIT_COLORS[p.hit];
      if (bg) colorRequests.push(colorReq(sheetId, sheetRow - 1, sheetRow, cols.hit, cols.hit + 1, bg));
    }
  }
  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data } });
  }
  if (colorRequests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: colorRequests } });
  }
}

/** Aggregate hit-rate / alpha stats for one agent, written into its tab's fixed Track Record block (rows 7-9). */
export async function writeAgentTrackRecordBlock(sheets, spreadsheetId, agentId) {
  const tab = agentTabName(agentId);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A${REC_DATA_START_ROW}:R` });
  const rows = res.data.values || [];

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const values = [];
  for (const horizon of [30, 90, 180]) {
    const cols = HORIZON_COLUMNS[horizon];
    const evaluated = rows.filter((r) => r[cols.hit] === "✅" || r[cols.hit] === "❌");
    const hits = evaluated.filter((r) => r[cols.hit] === "✅");
    const returns = rows.filter((r) => r[cols.return] !== "" && r[cols.return] != null).map((r) => Number(r[cols.return]));
    const alphas = rows.filter((r) => r[cols.alpha] !== "" && r[cols.alpha] != null).map((r) => Number(r[cols.alpha]));
    const hitRate = evaluated.length ? (hits.length / evaluated.length) * 100 : null;
    const avgReturn = avg(returns);
    const avgAlpha = avg(alphas);
    values.push([
      `${horizon} Day`,
      evaluated.length,
      hitRate != null ? Math.round(hitRate * 10) / 10 : "—",
      avgReturn != null ? Math.round(avgReturn * 100) / 100 : "—",
      avgAlpha != null ? Math.round(avgAlpha * 100) / 100 : "—",
    ]);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!A7`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

// ── Trade Ledger tab (shared, one row per detected Robinhood fill) ─────────

const TRADE_LEDGER_HEADERS = [
  "Date", "Ticker", "Side", "Shares", "Price", "Amount ($)", "Order ID", "Agent ID", "Proposal ID", "Realized Gain ($)", "Row HMAC",
];

export async function appendTradeLedgerEntries(sheets, spreadsheetId, sheetId, trades) {
  if (!trades.length) return;
  await ensureHeadersExtendable(sheets, spreadsheetId, sheetId, "Trade Ledger", TRADE_LEDGER_HEADERS, {
    4: { type: "CURRENCY", pattern: CURRENCY_FMT },
    5: { type: "CURRENCY", pattern: CURRENCY_FMT },
    9: { type: "CURRENCY", pattern: CURRENCY_FMT },
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Trade Ledger!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: trades.map((input) => {
        const t = signOperationalLedgerEntry("trade", {
          ...input,
          orderId: input.orderId ?? null,
          agentId: input.agentId ?? "unattributed",
          proposalId: input.proposalId ?? null,
          realizedGain: input.realizedGain ?? null,
        });
        return [t.date, t.ticker, t.side, t.shares, t.price, t.amount, t.orderId ?? "",
          t.agentId, t.proposalId ?? "", t.realizedGain ?? "", t.rowHmac];
      }),
    },
  });
}

export async function readTradeLedger(sheets, spreadsheetId, { verify = true } = {}) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Trade Ledger!A2:K", valueRenderOption: "UNFORMATTED_VALUE" });
  const entries = (res.data.values || []).filter((row) => row[0]).map(parseTradeRow);
  return verify ? assertOperationalLedgerEntries("trade", entries) : entries;
}

// ── Lots tab (shared, FIFO tax-lot ledger) ──────────────────────────────────

const LOTS_HEADERS = ["Lot ID", "Ticker", "Open Date", "Agent ID", "Cost Per Share", "Shares Original", "Shares Open", "Status", "Row HMAC"];

export async function appendLots(sheets, spreadsheetId, sheetId, lots) {
  if (!lots.length) return;
  await ensureHeadersExtendable(sheets, spreadsheetId, sheetId, "Lots", LOTS_HEADERS, {
    4: { type: "CURRENCY", pattern: CURRENCY_FMT },
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Lots!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: lots.map((input) => {
        const l = signOperationalLedgerEntry("lot", { ...input, agentId: input.agentId ?? "unattributed" });
        return [l.lotId, l.ticker, l.openDate, l.agentId, l.costPerShare, l.sharesOriginal, l.sharesOpen, l.status, l.rowHmac];
      }),
    },
  });
}

/** Full lot list (all tickers, all statuses) — caller filters as needed (see lib/tax-lots.js). */
export async function readAllLots(sheets, spreadsheetId, { verify = true } = {}) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Lots!A2:I", valueRenderOption: "UNFORMATTED_VALUE" });
  const entries = (res.data.values || []).filter((row) => row[0]).map((row, i) => parseLotRow(row, i));
  return verify ? assertOperationalLedgerEntries("lot", entries) : entries;
}

/** Writes sharesOpen/status back onto specific Lots rows after a FIFO consumption (see lib/tax-lots.js consumeLotsFIFO). */
export async function applyLotUpdatesToSheet(sheets, spreadsheetId, updatedLots) {
  if (!updatedLots.length) return;
  // A lot's row index comes from a prior Sheet read. Verify the identity at the
  // destination immediately before changing money state: an interior blank row
  // or user sort must fail closed rather than updating another lot's G:I cells.
  const identityRanges = updatedLots.map((lot) => `Lots!A${lot.rowIndex + 2}`);
  const identityResponse = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: identityRanges, valueRenderOption: "UNFORMATTED_VALUE" });
  const identities = identityResponse.data.valueRanges ?? [];
  if (identities.length !== updatedLots.length || identities.some((response, index) => String(response.values?.[0]?.[0] ?? "") !== String(updatedLots[index].lotId))) {
    throw new Error("Lot row identity changed before update; refusing to write a potentially different lot.");
  }
  const data = updatedLots.map((lot) => {
    const signed = signOperationalLedgerEntry("lot", lot);
    return {
      range: `Lots!G${lot.rowIndex + 2}:I${lot.rowIndex + 2}`,
      values: [[lot.sharesOpen, lot.status, signed.rowHmac]],
    };
  });
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data } });
}

// ── Sysloop schema expectations ─────────────────────────────────────────────
// Consumed by lib/sysloop (schema-drift check). References the SAME constants
// the writers use, so this can never drift from what this repo writes — it
// detects drift on the SHEET side (manual edits, partial migrations) and gives
// the system loop one canonical place to read expected headers from.
export const SYSLOOP_EXPECTED_HEADERS = {
  "Performance": { row: 1, headers: PERFORMANCE_HEADERS },
  "Investors": { row: 1, headers: INVESTOR_HEADERS },
  "Trade Ledger": { row: 1, headers: TRADE_LEDGER_HEADERS },
  "Lots": { row: 1, headers: LOTS_HEADERS },
  "Market Scans": { row: 1, headers: MARKET_SCAN_HEADERS },
  "Agent-1": { row: REC_HEADER_ROW, headers: REC_HEADERS },
  "Agent-2": { row: REC_HEADER_ROW, headers: REC_HEADERS },
  "Agent-3": { row: REC_HEADER_ROW, headers: REC_HEADERS },
};
