import fs from "fs";
import { google } from "googleapis";

const SPREADSHEET_TITLE = "Sam's Portfolio Manager";
const TABS = ["Overview", "Holdings", "Performance", "Recommendations", "Strategy", "Track Record"];

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

  // Clean up the default "Sheet1" tab Google adds to brand-new spreadsheets, if it's unused.
  const sheet1 = meta.data.sheets.find((s) => s.properties.title === "Sheet1");
  if (sheet1) {
    const vals = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Sheet1!A1:Z10" });
    if (!vals.data.values?.length) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ deleteSheet: { sheetId: sheet1.properties.sheetId } }] },
      });
    }
  }

  const existingTitles = new Set(meta.data.sheets.map((s) => s.properties.title));
  const missing = TABS.filter((t) => !existingTitles.has(t));
  if (!missing.length) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: missing.map((title) =>
        title === "Overview"
          ? { addSheet: { properties: { title, index: 0 } } }
          : { addSheet: { properties: { title } } }
      ),
    },
  });

  if (missing.includes("Strategy")) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Strategy!A1",
      valueInputOption: "RAW",
      requestBody: {
        values: [
          ["Strategy Notes (edit freely — read verbatim by the AI overlay each research cycle)"],
          [""],
        ],
      },
    });
  }
}

export async function getOrCreateSpreadsheet(sheets, drive, redis) {
  const existing = redis ? await redis.get("pm:spreadsheet-id") : null;

  // Preferred path: Sam creates a blank Sheet in his own Drive and shares it with the
  // service account (Editor). Service accounts on personal Drives have 0 storage quota
  // and cannot call spreadsheets.create, so this is the supported setup.
  const configured = process.env.SPREADSHEET_ID?.trim();
  if (configured) {
    await ensureTabs(sheets, configured);
    if (redis && configured !== existing) await redis.set("pm:spreadsheet-id", configured);
    console.log(`[Sheets] Using configured spreadsheet: https://docs.google.com/spreadsheets/d/${configured}`);
    return configured;
  }

  if (existing) {
    await ensureTabs(sheets, existing);
    return existing;
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

  // Seed headers + Strategy notes placeholder
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Strategy!A1",
    valueInputOption: "RAW",
    requestBody: {
      values: [
        ["Strategy Notes (edit freely — read verbatim by the AI overlay each research cycle)"],
        [""],
      ],
    },
  });

  if (redis) await redis.set("pm:spreadsheet-id", spreadsheetId);
  console.log(`[Sheets] Spreadsheet created: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
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

export async function writeHoldingsTab(sheets, spreadsheetId, sheetId, holdings, cash, timestamp, note) {
  const headers = ["Ticker", "Company", "Shares", "Avg Cost", "Current Price", "Market Value", "Cost Basis", "Gain/Loss ($)", "Return (%)"];
  const rows = [headers];
  for (const h of holdings) {
    rows.push([
      h.ticker,
      h.name ?? "",
      h.shares,
      h.avgCost,
      h.currentPrice ?? "",
      h.marketValue != null ? Math.round(h.marketValue * 100) / 100 : "",
      Math.round(h.costBasis * 100) / 100,
      h.gainLoss != null ? Math.round(h.gainLoss * 100) / 100 : "",
      h.gainLossPct != null ? Math.round(h.gainLossPct * 100) / 100 : "",
    ]);
  }
  const cashRowIndex = rows.length;
  rows.push(["Cash", "", "", "", "", cash ?? "", "", "", ""]);
  const syncedRowIndex = rows.length;
  rows.push([`Last synced: ${timestamp}`]);
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
    .map((row) => row[0])
    .filter((v) => v && v !== "Cash" && !String(v).startsWith("Last synced") && !String(v).startsWith("⚠️"));
}

// ── Performance tab (append one row per sync) ───────────────────────────────

export async function appendPerformanceRow(sheets, spreadsheetId, sheetId, { date, portfolioValue, spyPrice }) {
  await ensureHeaders(sheets, spreadsheetId, sheetId, "Performance", ["Date", "Portfolio Value", "S&P 500 (SPY)"], {
    1: { type: "CURRENCY", pattern: CURRENCY_FMT },
    2: { type: "CURRENCY", pattern: CURRENCY_FMT },
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Performance!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[date, portfolioValue, spyPrice]] },
  });
}

/** Full performance history, oldest first (excludes header row). */
export async function readPerformanceHistory(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Performance!A2:C" });
  return (res.data.values || []).map((row) => ({
    date: row[0],
    portfolioValue: row[1] != null && row[1] !== "" ? Number(row[1]) : null,
    spyPrice: row[2] != null && row[2] !== "" ? Number(row[2]) : null,
  }));
}

// ── Recommendations tab (append per cycle) ──────────────────────────────────

const ACTION_COLORS = { BUY: C_GREEN, SELL: C_RED, HOLD: C_GRAY };

const REC_HEADERS = [
  "Date", "Ticker", "Action", "Quant Score", "AI Rationale", "News Links", "Status",
  "Entry Price", "SPY Entry Price",
  "30D Return (%)", "30D Alpha vs SPY (%)", "30D Hit",
  "90D Return (%)", "90D Alpha vs SPY (%)", "90D Hit",
  "180D Return (%)", "180D Alpha vs SPY (%)", "180D Hit",
];

const REC_NUMBER_FORMATS = {
  3: { type: "NUMBER", pattern: SCORE_FMT },
  7: { type: "CURRENCY", pattern: CURRENCY_FMT },
  8: { type: "CURRENCY", pattern: CURRENCY_FMT },
  9: { type: "NUMBER", pattern: SIGNED_PERCENT_FMT },
  10: { type: "NUMBER", pattern: SIGNED_PERCENT_FMT },
  12: { type: "NUMBER", pattern: SIGNED_PERCENT_FMT },
  13: { type: "NUMBER", pattern: SIGNED_PERCENT_FMT },
  15: { type: "NUMBER", pattern: SIGNED_PERCENT_FMT },
  16: { type: "NUMBER", pattern: SIGNED_PERCENT_FMT },
};

/** Column index (0-based) of each forward-return field, per horizon in days. */
const HORIZON_COLUMNS = {
  30: { return: 9, alpha: 10, hit: 11 },
  90: { return: 12, alpha: 13, hit: 14 },
  180: { return: 15, alpha: 16, hit: 17 },
};

export async function appendRecommendations(sheets, spreadsheetId, sheetId, recommendations) {
  if (!recommendations.length) return;
  await ensureHeadersExtendable(sheets, spreadsheetId, sheetId, "Recommendations", REC_HEADERS, REC_NUMBER_FORMATS);
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Recommendations!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: recommendations.map((r) => [
        r.date, r.ticker, r.action, r.quantScore, r.rationale, r.newsLinks, r.status,
        r.entryPrice ?? "", r.spyEntryPrice ?? "",
        "", "", "", "", "", "", "", "", "",
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
  });
  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

/** Recommendation rows with entry prices + which forward-return horizons are already filled in, for the performance-review job. */
export async function readRecommendationsForReview(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Recommendations!A2:R" });
  const rows = res.data.values || [];
  return rows.map((row, i) => ({
    rowIndex: i, // 0-indexed data row (sheet row = rowIndex + 2)
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

const HIT_COLORS = { "✅": C_GREEN, "❌": C_RED };

/** Write computed forward-return outcomes back onto specific Recommendations rows (locks in once a horizon is filled — never overwritten). */
export async function applyOutcomeUpdates(sheets, spreadsheetId, sheetId, updates) {
  if (!updates.length) return;
  const data = [];
  const colorRequests = [];
  for (const { rowIndex, patch } of updates) {
    const sheetRow = rowIndex + 2; // 1-indexed sheet row (header is row 1)
    for (const [horizon, p] of Object.entries(patch)) {
      const cols = HORIZON_COLUMNS[horizon];
      data.push({ range: `Recommendations!${String.fromCharCode(65 + cols.return)}${sheetRow}`, values: [[Math.round(p.return * 10000) / 100]] });
      if (p.alpha != null) {
        data.push({ range: `Recommendations!${String.fromCharCode(65 + cols.alpha)}${sheetRow}`, values: [[Math.round(p.alpha * 10000) / 100]] });
      }
      data.push({ range: `Recommendations!${String.fromCharCode(65 + cols.hit)}${sheetRow}`, values: [[p.hit]] });
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

// ── Track Record tab (aggregate hit-rate stats, rewritten each performance review) ─

/** Aggregate hit-rate / alpha stats across all evaluated recommendations, written to the Track Record tab. */
export async function writeTrackRecordTab(sheets, spreadsheetId, sheetId) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Recommendations!A2:R" });
  const rows = res.data.values || [];

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const stats = {};
  for (const horizon of [30, 90, 180]) {
    const cols = HORIZON_COLUMNS[horizon];
    const evaluated = rows.filter((r) => r[cols.hit] === "✅" || r[cols.hit] === "❌");
    const hits = evaluated.filter((r) => r[cols.hit] === "✅");
    const returns = rows.filter((r) => r[cols.return] !== "" && r[cols.return] != null).map((r) => Number(r[cols.return]));
    const alphas = rows.filter((r) => r[cols.alpha] !== "" && r[cols.alpha] != null).map((r) => Number(r[cols.alpha]));
    stats[horizon] = {
      evaluated: evaluated.length,
      hitRate: evaluated.length ? (hits.length / evaluated.length) * 100 : null,
      avgReturn: avg(returns),
      avgAlpha: avg(alphas),
    };
  }

  const rows_ = [
    ["📈 Track Record — forward-return outcomes by horizon", "", "", "", ""],
    ["Directional hit rate = BUY followed by a gain, or SELL followed by a loss. Updated by the performance-review job.", "", "", "", ""],
    ["", "", "", "", ""],
    ["Horizon", "Evaluated", "Hit Rate (%)", "Avg Return (%)", "Avg Alpha vs SPY (%)"],
  ];
  const requests = [
    mergeReq(sheetId, 0, 1, 0, 5),
    colorReq(sheetId, 0, 1, 0, 5, C_NAVY),
    textReq(sheetId, 0, 1, 0, 5, { bold: true, color: C_WHITE, fontSize: 14 }),
    mergeReq(sheetId, 1, 2, 0, 5),
    textReq(sheetId, 1, 2, 0, 5, { italic: true, color: { red: 0.4, green: 0.4, blue: 0.4 } }),
    colorReq(sheetId, 3, 4, 0, 5, C_LIGHT_BLUE),
    textReq(sheetId, 3, 4, 0, 5, { bold: true }),
  ];
  for (const horizon of [30, 90, 180]) {
    const s = stats[horizon];
    rows_.push([
      `${horizon} Day`,
      s.evaluated,
      s.hitRate != null ? Math.round(s.hitRate * 10) / 10 : "—",
      s.avgReturn != null ? Math.round(s.avgReturn * 100) / 100 : "—",
      s.avgAlpha != null ? Math.round(s.avgAlpha * 100) / 100 : "—",
    ]);
  }

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: "Track Record" });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Track Record!A1",
    valueInputOption: "RAW",
    requestBody: { values: rows_ },
  });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [unmergeReq(sheetId, rows_.length + 5, 5), clearFormatReq(sheetId, rows_.length + 5, 5), columnWidthReq(sheetId, 0, 1, 150), ...requests],
    },
  });
}

// ── Strategy tab (read-only from the job's perspective) ─────────────────────

/** Sam's free-text strategy notes, written via the dashboard's /strategy page. */
export async function readStrategyNotes(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Strategy!A2" });
  return res.data.values?.[0]?.[0] ?? "";
}
