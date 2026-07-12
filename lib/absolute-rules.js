/**
 * Pure evaluator for mandate v3 §5 absolute-threshold tables.
 *
 * Rules are ordered best-to-worst. If a higher band cannot be evaluated because
 * required evidence is missing, evaluation stops as `missing`; it must never fall
 * through and award a weaker band from an incomplete record.
 *
 * NOT wired into the live scan path.
 */

const valueAt = (input, field) => input?.[field];

export function evaluateCondition(input, condition) {
  if (condition.all) {
    let unknown = false;
    for (const child of condition.all) {
      const result = evaluateCondition(input, child);
      if (result === false) return false;
      if (result == null) unknown = true;
    }
    return unknown ? null : true;
  }
  if (condition.any) {
    let unknown = false;
    for (const child of condition.any) {
      const result = evaluateCondition(input, child);
      if (result === true) return true;
      if (result == null) unknown = true;
    }
    return unknown ? null : false;
  }
  if (condition.not) {
    const result = evaluateCondition(input, condition.not);
    return result == null ? null : !result;
  }

  const value = valueAt(input, condition.field);
  if (value == null || Number.isNaN(value)) return null;
  if (Object.hasOwn(condition, "eq")) return value === condition.eq;
  if (Object.hasOwn(condition, "gte") && value < condition.gte) return false;
  if (Object.hasOwn(condition, "gt") && value <= condition.gt) return false;
  if (Object.hasOwn(condition, "lte") && value > condition.lte) return false;
  if (Object.hasOwn(condition, "lt") && value >= condition.lt) return false;
  return true;
}

export function scoreAbsoluteRuleTable(input, table) {
  if (!table?.rules?.length) return { fraction: null, missing: true, matchedBand: null };
  for (const [index, rule] of table.rules.entries()) {
    const result = evaluateCondition(input, rule.when);
    if (result == null) return { fraction: null, missing: true, matchedBand: null };
    if (result) return { fraction: rule.fraction, missing: false, matchedBand: index };
  }
  if (Object.hasOwn(table, "defaultFraction")) {
    return { fraction: table.defaultFraction, missing: false, matchedBand: "default" };
  }
  return { fraction: null, missing: true, matchedBand: null };
}

export function scoreAbsoluteEvidence(input, metricSpec, table) {
  const result = scoreAbsoluteRuleTable(input, table);
  return {
    ...result,
    points: result.missing ? 0 : result.fraction * metricSpec.points,
    maxPoints: metricSpec.points,
    method: "absolute",
  };
}
