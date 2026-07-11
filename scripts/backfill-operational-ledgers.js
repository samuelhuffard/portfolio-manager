import "dotenv/config";
import { getServiceAccountClients, resolveSharedSpreadsheetId } from "../lib/sheets.js";
import { getOperationalLedgerSecret, signOperationalLedgerEntry, verifyOperationalLedgerEntries } from "../lib/operational-ledger.js";
import { parseLotRow, parsePerformanceRow, parseTradeRow } from "../lib/operational-ledger-rows.js";
import { fileURLToPath } from "node:url";

const definitions = [
  { kind: "performance", tab: "Performance", range: "A2:F", signatureColumn: "F", parser: parsePerformanceRow },
  { kind: "trade", tab: "Trade Ledger", range: "A2:K", signatureColumn: "K", parser: parseTradeRow },
  { kind: "lot", tab: "Lots", range: "A2:I", signatureColumn: "I", parser: parseLotRow },
];

export async function backfillOperationalLedgers({ sheets, spreadsheetId, secret = getOperationalLedgerSecret() }) {
  const updates = definitions.map((definition) => ({
    range: `${definition.tab}!${definition.signatureColumn}1`, values: [["Row HMAC"]],
  }));
  const summary = {};
  for (const definition of definitions) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${definition.tab}!${definition.range}`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const rows = res.data.values || [];
    const entries = rows.map((row, i) => ({ row, rowNumber: i + 2, entry: definition.parser(row, i) })).filter(({ entry }) => {
      return definition.kind === "lot" ? entry.lotId : entry.date;
    });
    const existing = entries.filter(({ entry }) => entry.rowHmac).map(({ entry }) => entry);
    const verification = verifyOperationalLedgerEntries(definition.kind, existing, secret);
    if (verification.mismatched.length) {
      throw new Error(`${definition.tab}: refusing backfill because ${verification.mismatched.length} existing signature(s) do not verify.`);
    }
    const unsigned = entries.filter(({ entry }) => !entry.rowHmac);
    for (const { rowNumber, entry } of unsigned) {
      const signed = signOperationalLedgerEntry(definition.kind, entry, secret);
      updates.push({ range: `${definition.tab}!${definition.signatureColumn}${rowNumber}`, values: [[signed.rowHmac]] });
    }
    summary[definition.tab] = { total: entries.length, alreadySigned: existing.length, backfilled: unsigned.length };
  }
  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: updates } });
  }
  return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { sheets, drive } = getServiceAccountClients();
  const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
  const summary = await backfillOperationalLedgers({ sheets, spreadsheetId });
  console.log(JSON.stringify(summary, null, 2));
}
