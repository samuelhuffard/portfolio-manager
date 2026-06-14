import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() });

/**
 * Produces a BUY/SELL/HOLD recommendation + rationale for a single ticker,
 * combining its quant score breakdown, recent news, Sam's strategy notes,
 * and whether he currently holds it. Sam executes trades manually — this
 * is research output only.
 */
export async function getAIRecommendation({ ticker, name, quantScore, breakdown, news, strategyNotes, isHeld }) {
  const newsBlock = news.length
    ? news.map((n) => `- ${n.title} (${n.url})\n  ${(n.content ?? "").slice(0, 300)}`).join("\n")
    : "No recent news found.";

  const holdingLine = isHeld
    ? "Sam currently holds this ticker in his portfolio."
    : "Sam does not currently hold this ticker.";

  const prompt = `You are a quant + qualitative equity research assistant helping Sam manage a personal portfolio. He executes all trades manually in the Robinhood app — your job is to recommend and explain, never to act.

Ticker: ${ticker} (${name})
Quant score: ${quantScore}/100 (cross-sectional rank vs. the watchlist; higher = stronger fundamentals/momentum)
Score breakdown (0-100 per metric): ${JSON.stringify(breakdown)}

${holdingLine}

Recent news (last 7 days):
${newsBlock}

Sam's current strategy notes (follow as steering input; if empty, use balanced judgment):
${strategyNotes || "(none provided)"}

Respond in exactly this format:
ACTION: BUY | SELL | HOLD
RATIONALE: <2-3 sentences citing the quant score and any relevant news>`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  const actionMatch = text.match(/ACTION:\s*(BUY|SELL|HOLD)/i);
  const rationaleMatch = text.match(/RATIONALE:\s*([\s\S]*)/i);

  return {
    action: actionMatch ? actionMatch[1].toUpperCase() : "HOLD",
    rationale: rationaleMatch ? rationaleMatch[1].trim() : text.trim(),
  };
}
