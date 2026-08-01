// Local fixture metadata only. It contains no provider response, quote, model
// output, or investment conclusion.
const make = (id, ticker, scenario, sourceTier = "primary") => ({
  id, ticker, scenario, sourceTier,
  decisionTime: "2025-01-31T21:00:00.000Z",
  policyVersion: "mandate-v3-baseline",
  retrievalReceipt: { id: `receipt-${id}`, retrievedAt: "2025-01-31T20:00:00.000Z" },
  expectedFacts: ["issuer_filing_or_disclosure"],
  expectedMissingness: [],
  restatementOrCorporateActionState: "none",
});

export const BENCH30_GOLDEN_SET = Object.freeze({
  version: "bench30-golden-set-v1",
  slots: Object.freeze([
    make("B01", "ALPHA", "ordinary_operating_company"), make("B02", "BRAVO", "ordinary_operating_company"),
    make("B03", "CHARLIE", "ordinary_operating_company"), make("B04", "DELTA", "ordinary_operating_company"),
    make("B05", "ECHO", "ordinary_operating_company"), make("B06", "FOXTROT", "ordinary_operating_company"),
    make("B07", "GOLF", "ordinary_operating_company"), make("B08", "HOTEL", "ordinary_operating_company"),
    make("B09", "INDIA", "bank_special_sector", "regulatory"), make("B10", "JULIET", "bank_special_sector", "regulatory"),
    make("B11", "KILO", "insurer_special_sector", "regulatory"), make("B12", "LIMA", "insurer_special_sector", "regulatory"),
    make("B13", "MIKE", "reit_special_sector", "regulatory"), make("B14", "NOVEMBER", "reit_special_sector", "regulatory"),
    make("B15", "OSCAR", "thin_coverage", "issuer"), make("B16", "PAPA", "thin_coverage", "issuer"),
    make("B17", "QUEBEC", "stale_estimate", "corroborating"), make("B18", "ROMEO", "stale_estimate", "corroborating"),
    make("B19", "SIERRA", "restatement", "regulatory"), make("B20", "TANGO", "restatement", "regulatory"),
    make("B21", "UNIFORM", "share_class_trap", "issuer"), make("B22", "VICTOR", "share_class_trap", "issuer"),
    make("B23", "WHISKEY", "corporate_action_trap", "regulatory"), make("B24", "XRAY", "corporate_action_trap", "regulatory"),
    make("B25", "YANKEE", "negative_case_missing_primary", "primary"), make("B26", "ZULU", "negative_case_conflict", "primary"),
    make("B27", "AAB", "negative_case_future_fact", "primary"), make("B28", "AAC", "negative_case_illiquid", "issuer"),
    make("B29", "AAD", "ordinary_operating_company"), make("B30", "AAE", "ordinary_operating_company"),
  ]),
});

