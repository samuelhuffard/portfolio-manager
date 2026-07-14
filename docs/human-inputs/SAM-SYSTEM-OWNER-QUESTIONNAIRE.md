# Portfolio Manager — System Owner Questionnaire

**For:** Sam — system builder, operator, and API-budget owner  
**How to use this:** Type your answer directly under each question. Short answers
are fine. Leave anything you want to discuss blank. This document is a decision
record, not a commitment to deploy or enable anything immediately.

## 1. Observation-window audit cleanup

### 1.1 Smoke reconciliation artifacts — shared decision

Two open reconciliation records were created by production smoke testing. They
are not broker orders, but they currently appear as failed-integrity P1 alerts.

**Do you approve an auditable closure that labels both records as test artifacts,
preserves their history, and removes them from the open reconciliation queue?**

Your answer: Yes I do


### 1.2 Historical unsigned NVDA approval — shared decision

One historical NVDA approval predates the signature system. It is not safe to
treat it as a current signed authorization, but deleting it would erase history.

**Do you approve preserving it as a legacy unsigned record with a signed human
attestation that it predates signing and cannot authorize a current action?**

Your answer: You can consider it something I made the system propose to test the routing of the system, making sure it can execute when i press "Approve"


## 2. Release and branch ownership

### 2.1 Production branch

The Jetson is currently running the reviewed `mandate-v3` branch. Future deploys
must always prove the exact branch and commit running in production.

**Which policy do you want?**

- Keep `mandate-v3` as the temporary production branch until this roadmap is
  complete.
- Merge reviewed work into `main`, then deploy only `main`.
- Another approach (describe it).

Your answer: Whatever moves the project forward the most. Mandate V3 is the future isnt it, so lets make everything run on the most advanced and developed mandate


### 2.2 Deploy rule

**Who may authorize production deployment, migration, flag changes, and rollback?
What proof must be shown before you approve each?**

Your answer: I trust any coding agents that show me porper testing before production deployment, and reach the standards we set up in the planning of new features/workflows


## 3. AI model and spending policy

### 3.1 Research budget

**What maximum spend are you comfortable with for research models? Please give
any limits that matter to you.**

- Per research run:
- Per day:
- Per week or month:
- Emergency stop rule:

Your answer: $40 a month, but I dont want me being cheap to limit our new firm from being able to compete in a competetive market of new funds, so set it at that for now, we can revisit if it becomes an issue. Let the day/week total to be what it needs to make a truly competitive analysis. The goal would be to take pressure off of it using local models, not to simply remove tasks from the workflow.


### 3.2 Model routing

**Which model should be the normal model for routine research? May the system
fall back to a cheaper model when close to budget, and if so, when?**

Your answer: Opus should be used for anything that will certainly touch a proposal (judgement reasoning), but just about any model (inclusing the jetson) can scape the internet and do other small tasks, so fall back as low cost as possible. Use your judgement on what model is needed, use the jetson as much as possible.


### 3.3 Provider outage behavior — shared decision

**If the model provider is unavailable, rate-limited, or over budget, should the
system record a clear blocked/failed review and continue safely, rather than
quietly turning it into HOLD?**

Your answer: It should not consider it a hold, since that would go into the history as a hold. It should record it as a failed review and alert me immidiately.


## 4. What invalidates an observation day — shared decision

**Which failures should invalidate a Phase 0 observation day?**

Suggested baseline:

- Broker/MCP receipt failure, ledger-integrity failure, Sheets/Neon parity
  failure, approval-signature failure, or unsafe client exposure: invalidates
  the day.
- Yahoo, Athena, or FRED data-source failure: blocks affected research and is
  logged, but does not automatically invalidate the full day if no unsafe action
  was taken.

Your answer: I like your suggestion, pretty hard to do the suffucuent research without any of those.


## 5. Measurement and promotion governance — shared decision

### 5.1 Outcome review

**Who reviews outcome reports, how often, and what would make you pause the
research program for investigation?**

Your answer: Should probably be a report sent to the fund managers through email, so both me and my partner. If its just an outcome report on the investments, i think once every two weeks, and i will let my partner tell me what he thinks calls for investigation.


### 5.2 Evidence before claims

**How much evidence is required before saying the research process improves
decisions? Consider both number of observations and elapsed time.**

Your answer: well we would need a baseline first, so we need at least a month of real trading before that, and then we could judge the baseline and the imorovements from there no?


### 5.3 Promotion and rollback

**What evidence must exist before shadow research can move to a small canary?
What evidence must exist before any broader autonomy? What is the rollback rule?**

Your answer: This is a tough one. I am wokring under significant trust for this model and its judgement. It is already better than mine with little investment experience, so I would say autonomy is reached as soon as evidence of working wihtout error is shown through the observation period. The rollback rule is decided when the system starts making erraneous decisions that dont allign with the funds investment philosophy, or that dont prove sufficient results (doing at least the same as the SP500). I belive that the shadow research is ready right now for a small canary.


### 5.4 Financial-data source of truth

**What proof must exist before Neon/Postgres can become the source of truth for
money reads instead of Google Sheets?**

Your answer: the 10 days of perfect tracking between the two, but honestly it might be less. Google sheets was only used when we had at most one investnmetn, so whos to say that google sheets is more truthful than the Neon/posgres we have been working so hard on recently?


## 6. Decisions that should wait for evidence

### 6.1 Q-005 — material score changes

**After we observe real score changes, what size/type of change should trigger
renewed research?**

Your answer: Wait on these


### 6.2 Q-006 — cash challenger

**When may a new idea compete with holding cash? What exceptions should exist?**

Your answer: Wait on these


### 6.3 Q-007 — net-return assumptions

**Before we report net returns or claim an edge, what assumptions should apply
for spread, slippage, liquidity, taxes, and other real-world costs?**

Your answer: Wait on these

