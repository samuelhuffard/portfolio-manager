import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() });

/**
 * Produces a structured BUY/SELL/HOLD proposal for a single ticker, combining
 * its quant score breakdown, recent news, Sam's strategy notes, and whether he
 * currently holds it. The model returns JSON (thesis, risks, kill criteria,
 * confidence, suggested position size) rather than free text, so the result
 * is auditable and can be checked by lib/risk-engine.js before anything is
 * written to the Sheet. Approved proposals may later be executed through the
 * Robinhood MCP path — this layer only researches and recommends, never acts.
 * output only, never an instruction to act.
 */
export async function getAIRecommendation({
  ticker, name, quantScore, breakdown, news, strategyNotes, isHeld,
  nextEarningsDate, analystTrend, insiderActivity, recentFilings, macro, personality,
}) {
  const newsBlock = news.length
    ? news.map((n) => `- ${n.title} (${n.url})\n  ${(n.content ?? "").slice(0, 300)}`).join("\n")
    : "No recent news found.";

  const holdingLine = isHeld
    ? "Sam currently holds this ticker in his portfolio."
    : "Sam does not currently hold this ticker.";

  const filingsBlock = recentFilings?.length
    ? recentFilings.map((f) => `- ${f.form} filed ${f.filed}${f.description && f.description !== f.form ? ` (${f.description})` : ""}`).join("\n")
    : "No recent SEC filings found.";

  const prompt = `You are a quant + qualitative equity research assistant helping Sam manage a personal portfolio. Approved trades may later be executed through an approval-gated Robinhood MCP workflow — your job is to recommend and explain, never to act.
${personality ? `\nYour investment mandate/philosophy:\n${personality}\n` : ""}
Ticker: ${ticker} (${name})
Quant score: ${quantScore}/100 (cross-sectional rank vs. the watchlist; higher = stronger fundamentals/momentum)
Score breakdown (0-100 per metric): ${JSON.stringify(breakdown)}

${holdingLine}
Next earnings date: ${nextEarningsDate ?? "unknown"}
Analyst recommendation trend: ${analystTrend ?? "no analyst coverage data"}
Insider activity (trailing period): ${insiderActivity ?? "no insider activity data"}

Recent SEC filings:
${filingsBlock}

Recent news (last 7 days):
${newsBlock}
${macro ? `\nMacro backdrop:\n${macro}\n` : ""}
Sam's current strategy notes (follow as steering input; if empty, use balanced judgment):
${strategyNotes || "(none provided)"}

Respond with ONLY a single JSON object — no markdown fences, no commentary before or after — matching exactly this shape:
{
  "action": "BUY" | "SELL" | "HOLD",
  "target_weight_pct": <number 0-10, your suggested position size as % of invested capital if BUY, otherwise 0>,
  "thesis": "<2-3 sentences citing the quant score and any relevant news>",
  "risks": ["<specific risk>", "<at most one more>"],
  "kill_criteria": ["<condition that would make you reverse this call>", "<at most one more>"],
  "confidence": <number 0-1>
}

Keep risks and kill_criteria to AT MOST 2 short items each (one sentence each) — be concise, not exhaustive. For HOLD, risks/kill_criteria may be empty arrays. For BUY or SELL you MUST include at least one risk and one kill criterion — a downstream rule check rejects BUY/SELL proposals that omit them.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 700,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  return parseRecommendation(text, ticker);
}

function parseRecommendation(text, ticker) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    const action = ["BUY", "SELL", "HOLD"].includes(parsed.action) ? parsed.action : "HOLD";
    return {
      action,
      targetWeight: Number(parsed.target_weight_pct) || 0,
      thesis: typeof parsed.thesis === "string" ? parsed.thesis : "",
      risks: Array.isArray(parsed.risks) ? parsed.risks.filter((r) => typeof r === "string") : [],
      killCriteria: Array.isArray(parsed.kill_criteria) ? parsed.kill_criteria.filter((k) => typeof k === "string") : [],
      confidence: parsed.confidence != null && !Number.isNaN(Number(parsed.confidence)) ? Number(parsed.confidence) : null,
    };
  } catch (err) {
    console.warn(`[AI Overlay] Failed to parse JSON response for ${ticker} (${err.message}), defaulting to HOLD. Raw response length: ${text.length} chars.`);
    return {
      action: "HOLD",
      targetWeight: 0,
      thesis: text.trim() || "Failed to parse AI response — defaulted to HOLD.",
      risks: [],
      killCriteria: [],
      confidence: null,
    };
  }
}
