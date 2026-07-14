# Portfolio Manager — Research and Modeling Policy Questionnaire

**For:** Investing/research partner — mandate, evidence, and modeling-policy
owner  
**How to use this:** Type your answer directly under each question. Short answers
are fine. Prefer a plain rule and an example over abstract wording. This document
sets policy; Codex will later translate approved answers into versioned, testable
rules.

## 1. Agent 1 balance-sheet policy (Q-001)

### 1.1 Strong balance sheet

**In plain English, what makes a company financially strong enough for Agent 1?
Which of these matter most: net debt, free cash flow, interest coverage, liquidity
or runway, leverage trend, dilution risk, or something else?**

Your answer:


### 1.2 Disqualifying weakness

**What makes a company financially weak enough to disqualify it, even if growth
or valuation otherwise looks attractive?**

Your answer:


### 1.3 Sector-specific treatment

**Should banks, insurers, and REITs have their own balance-sheet rules rather
than ordinary-company rules? If yes, what should each sector emphasize?**

Your answer:


### 1.4 Missing data

**If required balance-sheet data cannot be verified, should the system return
“insufficient evidence / no trade” rather than assign a partial score?**

Your answer:


## 2. Analyst-estimate freshness (Q-002)

### 2.1 Normal freshness window

**How old may analyst revenue and EPS estimates be before they are no longer
current enough to influence a decision?**

Your answer:


### 2.2 Event-driven freshness

**Should that window tighten after earnings, new guidance, a major filing, or a
material company event? If yes, what should the tighter rule be?**

Your answer:


### 2.3 Stale estimates

**If estimates are too old, should the system block the candidate, reduce
conviction, or omit that signal?**

Your answer:


## 3. Entry-price freshness (Q-003)

### 3.1 Quote age

**How fresh must a stock quote be before a proposal can be considered
execution-ready during market hours?**

Your answer:


### 3.2 Outside market hours

**May the system perform research using the last close outside market hours while
refusing to create an execution-ready proposal?**

Your answer:


### 3.3 Price movement after research

**What price movement should require a fresh review after research is written:
3%, 5%, another fixed threshold, or a volatility-adjusted rule?**

Your answer:


### 3.4 Material events

**Should earnings, company guidance, a material filing, or a major market event
force a refresh even if the price has not crossed the movement threshold?**

Your answer:


## 4. Consensus and institutional-ownership evidence (Q-004)

### 4.1 Analyst consensus

**How many independent analyst estimates are needed before “consensus” is
meaningful?**

Your answer:


### 4.2 Sparse coverage

**If only one or two analysts cover a company, should the system treat consensus
as unavailable rather than weakly positive or negative?**

Your answer:


### 4.3 Institutional ownership / 13F evidence

**What should count as meaningful institutional-ownership evidence? Is one
respected long-term investor’s filing useful as a qualitative clue, or should
several independent institutions be required?**

Your answer:


### 4.4 Required versus supporting evidence

**Should analyst-consensus or 13F data ever be required for a trade, or should
they only strengthen or weaken conviction?**

Your answer:


## 5. Data-degradation rule — shared decision

**Which data-source failures should merely block an affected candidate, and which
should invalidate the entire observation day?**

Suggested baseline:

- Broker/MCP receipts, ledger integrity, Sheets/Neon parity, approval signatures,
  and unsafe client exposure invalidate the day.
- Yahoo, Athena, and FRED failures block affected research and must be visible,
  but do not automatically invalidate the day if no unsafe action was taken.

Your answer:


## 6. Human-business evidence — later design decision

### 6.1 Factors that matter

**Which human factors are genuinely useful for this strategy: CEO tenure,
capital-allocation record, board quality, incentives, succession, culture,
employee trust, customer trust, or others?**

Your answer:


### 6.2 Evidence standard

**What primary evidence would be trustworthy enough to support a conclusion about
leadership or culture?**

Your answer:


### 6.3 Narrative versus score

**Which human factors should remain a cited narrative judgment rather than become
a numerical score?**

Your answer:


### 6.4 Uncertainty and disagreement

**How should the system represent disagreement, uncertainty, or missing human
evidence without pretending to know more than it does?**

Your answer:

