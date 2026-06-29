import { randomUUID } from "crypto";
import { getRedis } from "./redis.js";

const KEY = "pm:price-alerts";

export async function listPriceAlerts() {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.get(KEY);
    if (!raw) return [];
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    console.warn("[PriceAlerts] Failed to list:", e.message);
    return [];
  }
}

export async function addPriceAlert({ agentId, ticker, direction, targetPrice, note }) {
  const redis = getRedis();
  if (!redis) return null;
  const alerts = await listPriceAlerts();
  const alert = {
    id: randomUUID(),
    agentId,
    ticker: ticker.toUpperCase(),
    direction, // 'below' | 'above'
    targetPrice: Number(targetPrice),
    note: note ?? "",
    createdAt: new Date().toISOString(),
  };
  alerts.push(alert);
  await redis.set(KEY, JSON.stringify(alerts));
  return alert;
}

export async function removePriceAlert(id) {
  const redis = getRedis();
  if (!redis) return;
  const alerts = await listPriceAlerts();
  await redis.set(KEY, JSON.stringify(alerts.filter((a) => a.id !== id)));
}

/**
 * Returns alerts whose condition is met by the given price map ({ TICKER: currentPrice }).
 * Does NOT remove them — caller decides whether to fire-and-delete.
 */
export function checkAlerts(alerts, priceMap) {
  return alerts.filter((a) => {
    const price = priceMap[a.ticker];
    if (price == null) return false;
    return a.direction === "below" ? price <= a.targetPrice : price >= a.targetPrice;
  });
}
