// Free key at https://fred.stlouisfed.org/docs/api/api_key.html — macro snapshot is skipped (returns null) if unset.
const SERIES = {
  "10Y Treasury Yield (%)": "DGS10",
  "Fed Funds Rate (%)": "FEDFUNDS",
  "CPI Index (1982-84=100)": "CPIAUCSL",
  "Unemployment Rate (%)": "UNRATE",
};

/** Latest value for each tracked macro series, or null if FRED_API_KEY isn't configured or every fetch fails. */
export async function fetchMacroSnapshot() {
  const apiKey = process.env.FRED_API_KEY?.trim();
  if (!apiKey) return null;

  const results = {};
  let anySucceeded = false;
  for (const [label, seriesId] of Object.entries(SERIES)) {
    try {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const obs = data.observations?.[0];
      results[label] = obs && obs.value !== "." ? { value: obs.value, date: obs.date } : null;
      anySucceeded = true;
    } catch (err) {
      console.warn(`[FRED] fetch failed for ${seriesId}:`, err.message);
      results[label] = null;
    }
  }
  return anySucceeded ? results : null;
}

/** Plain-text summary of a macro snapshot for the AI prompt, or null if unavailable. */
export function formatMacroSnapshot(snapshot) {
  if (!snapshot) return null;
  const lines = Object.entries(snapshot)
    .filter(([, v]) => v != null)
    .map(([label, v]) => `${label}: ${v.value} (as of ${v.date})`);
  return lines.length ? lines.join("\n") : null;
}
