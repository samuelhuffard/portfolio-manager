import { TICKER_RE } from "../contracts/proposal.js";

function rowLabel(rowOrLabel) {
  const raw = Array.isArray(rowOrLabel) ? rowOrLabel[0] : rowOrLabel;
  return String(raw ?? "").trim();
}

/** Normalized label from a Holdings row or raw label string. */
export function holdingRowLabel(rowOrLabel) {
  return rowLabel(rowOrLabel);
}

/** Rows written for provenance, cash, or warnings are not broker positions. */
export function isHoldingMarkerRow(rowOrLabel) {
  const label = rowLabel(rowOrLabel);
  return (
    !label ||
    /^cash$/i.test(label) ||
    /^last synced\b/i.test(label) ||
    /^synced via robinhood agentic mcp\b/i.test(label) ||
    label.startsWith("⚠️")
  );
}

/** A real holdings row must be a ticker-shaped label that is not a marker row. */
export function isSecurityHoldingRow(rowOrLabel) {
  const label = rowLabel(rowOrLabel);
  return Boolean(label) && !isHoldingMarkerRow(label) && TICKER_RE.test(label);
}
