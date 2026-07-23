import assert from "node:assert/strict";
import test from "node:test";
import { blankResearchFunnel, recordCandidateBuild, recordResearchReview, RESEARCH_FUNNEL_VERSION } from "../lib/research-funnel.js";

test("funnel records every research stage without treating overlap as a partition", () => {
  let funnel = blankResearchFunnel({
    cataloged: 4511,
    discovery: { visible: 2613, eligible: 900, screenedOut: 1713, counts: { ranked: 17, exploration: 3 } },
    fundamentalsRequested: 20,
  });
  funnel = recordCandidateBuild(funnel, {
    fundamentalsAvailable: 16,
    candidatesBuilt: 16,
    freshScreenPassed: 12,
    freshScreenRejected: 4,
    mandatoryHoldingOverrides: 1,
  });
  funnel = recordResearchReview(funnel, { generatorAction: "BUY", riskOverridden: true, evaluatorState: "not_run" });
  funnel = recordResearchReview(funnel, { generatorAction: "HOLD", proposalDisposition: "not_applicable" });
  funnel = recordResearchReview(funnel, { dataGateBlocked: true, generatorAction: null, proposalDisposition: "not_applicable" });
  funnel = recordResearchReview(funnel, { generatorAction: "SELL", evaluatorState: "approved", proposalDisposition: "created" });

  assert.equal(funnel.version, RESEARCH_FUNNEL_VERSION);
  assert.equal(funnel.slate, 20);
  assert.equal(funnel.fundamentalsUnavailable, 4);
  assert.equal(funnel.deepReviews, 4);
  assert.equal(funnel.generatorActionable, 2);
  assert.equal(funnel.riskDowngraded, 1);
  assert.equal(funnel.evaluatorApproved, 1);
  assert.equal(funnel.proposalCreated, 1);
});
