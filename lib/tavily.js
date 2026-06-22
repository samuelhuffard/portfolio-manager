export async function tavilySearch(query, { maxResults = 5, days } = {}) {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");

  const body = { query, max_results: maxResults };
  if (days) body.days = days;

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const rawDetail = data?.detail || data?.message || data?.error || data?.raw || res.statusText;
    const detail = typeof rawDetail === "string" ? rawDetail : JSON.stringify(rawDetail);
    throw new Error(`Tavily search failed (${res.status}): ${String(detail).slice(0, 300)}`);
  }

  return data.results || [];
}
