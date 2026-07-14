export function investorUpdatesEnabled() {
  return process.env.INVESTOR_UPDATE_ENABLED?.trim().toLowerCase() === "true";
}

export function outcomeReportsEnabled() {
  return process.env.OUTCOME_REPORT_ENABLED?.trim().toLowerCase() === "true";
}

export async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.INVESTOR_UPDATE_FROM?.trim();
  const replyTo = process.env.INVESTOR_UPDATE_REPLY_TO?.trim();
  const bcc = process.env.INVESTOR_UPDATE_BCC?.trim();

  if (!investorUpdatesEnabled()) {
    return { skipped: true, reason: "INVESTOR_UPDATE_ENABLED is not true" };
  }
  if (!apiKey) throw new Error("RESEND_API_KEY is required to send investor updates.");
  if (!from) throw new Error("INVESTOR_UPDATE_FROM is required to send investor updates.");

  const body = {
    from,
    to: [to],
    subject,
    html,
    text,
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(bcc ? { bcc: bcc.split(",").map((v) => v.trim()).filter(Boolean) } : {}),
    tags: [{ name: "category", value: "investor_update" }],
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.message || data?.error || res.statusText || `HTTP ${res.status}`;
    throw new Error(`Resend send failed for ${to}: ${message}`);
  }
  return { skipped: false, id: data?.id ?? null };
}

export async function sendOutcomeReportEmail({ to, subject, html, text, idempotencyKey }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.OUTCOME_REPORT_FROM?.trim() || process.env.INVESTOR_UPDATE_FROM?.trim();
  const replyTo = process.env.OUTCOME_REPORT_REPLY_TO?.trim() || process.env.INVESTOR_UPDATE_REPLY_TO?.trim();
  if (!outcomeReportsEnabled()) return { skipped: true, reason: "OUTCOME_REPORT_ENABLED is not true" };
  if (!apiKey) throw new Error("RESEND_API_KEY is required to send outcome reports.");
  if (!from) throw new Error("OUTCOME_REPORT_FROM (or INVESTOR_UPDATE_FROM) is required to send outcome reports.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body: JSON.stringify({ from, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}), tags: [{ name: "category", value: "outcome_report" }] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend outcome report failed for ${to}: ${data?.message || data?.error || res.statusText || `HTTP ${res.status}`}`);
  return { skipped: false, id: data?.id ?? null };
}
