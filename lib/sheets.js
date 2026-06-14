import fs from "fs";
import { google } from "googleapis";

const SPREADSHEET_TITLE = "Sam's Portfolio Manager";
const TABS = ["Holdings", "Performance", "Recommendations", "Strategy"];

const C_NAVY = { red: 0.063, green: 0.094, blue: 0.157 };
const C_WHITE = { red: 1, green: 1, blue: 1 };
const C_GRAY = { red: 0.95, green: 0.95, blue: 0.95 };
const C_GREEN = { red: 0.851, green: 0.918, blue: 0.839 };
const C_RED = { red: 0.980, green: 0.878, blue: 0.878 };

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
async function ensureTabs(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTitles = new Set(meta.data.sheets.map((s) => s.properties.title));
  const missing = TABS.filter((t) => !existingTitles.has(t));
  if (!missing.length) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
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

function textReq(sheetId, r1, r2, c1, c2, { bold, color } = {}) {
  const textFormat = {};
  if (bold !== undefined) textFormat.bold = bold;
  if (color) textFormat.foregroundColor = color;
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 },
      cell: { userEnteredFormat: { textFormat } },
      fields: "userEnteredFormat.textFormat",
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

async function ensureHeaders(sheets, spreadsheetId, sheetId, tabName, headers) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A1:${String.fromCharCode(64 + headers.length)}1` });
  if (res.data.values?.length) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] },
  });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        freezeReq(sheetId, 1),
        colorReq(sheetId, 0, 1, 0, headers.length, C_NAVY),
        textReq(sheetId, 0, 1, 0, headers.length, { bold: true, color: C_WHITE }),
      ],
    },
  });
}

// ── Holdings tab (overwritten each sync) ────────────────────────────────────

export async function writeHoldingsTab(sheets, spreadsheetId, sheetId, holdings, cash, timestamp) {
  const headers = ["Ticker", "Name", "Shares", "Avg Cost", "Current Price", "Market Value", "Cost Basis", "Gain/Loss $", "Gain/Loss %"];
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
  rows.push([]);
  rows.push(["Cash", cash ?? ""]);
  rows.push([`Last synced: ${timestamp}`]);

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: "Holdings" });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Holdings!A1",
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });

  const requests = [
    freezeReq(sheetId, 1),
    colorReq(sheetId, 0, 1, 0, headers.length, C_NAVY),
    textReq(sheetId, 0, 1, 0, headers.length, { bold: true, color: C_WHITE }),
  ];
  holdings.forEach((h, i) => {
    if (h.gainLossPct == null) return;
    const bg = h.gainLossPct >= 0 ? C_GREEN : C_RED;
    requests.push(colorReq(sheetId, i + 1, i + 2, 7, 9, bg));
  });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

/** Tickers currently held, read back from the Holdings tab (col A, after header). */
export async function readHoldingsTickers(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Holdings!A2:A" });
  return (res.data.values || [])
    .map((row) => row[0])
    .filter((v) => v && v !== "Cash" && !String(v).startsWith("Last synced"));
}

// ── Performance tab (append one row per sync) ───────────────────────────────

export async function appendPerformanceRow(sheets, spreadsheetId, sheetId, { date, portfolioValue, spyPrice }) {
  await ensureHeaders(sheets, spreadsheetId, sheetId, "Performance", ["Date", "Portfolio Value", "SPY Price"]);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Performance!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[date, portfolioValue, spyPrice]] },
  });
}

// ── Recommendations tab (append per cycle) ──────────────────────────────────

export async function appendRecommendations(sheets, spreadsheetId, sheetId, recommendations) {
  if (!recommendations.length) return;
  await ensureHeaders(sheets, spreadsheetId, sheetId, "Recommendations", [
    "Date", "Ticker", "Action", "Quant Score", "AI Rationale", "News Links", "Status",
  ]);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Recommendations!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: recommendations.map((r) => [r.date, r.ticker, r.action, r.quantScore, r.rationale, r.newsLinks, r.status]),
    },
  });
}

// ── Strategy tab (read-only from the job's perspective) ─────────────────────

/** Sam's free-text strategy notes, written via the dashboard's /strategy page. */
export async function readStrategyNotes(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Strategy!A2" });
  return res.data.values?.[0]?.[0] ?? "";
}
