# CodeImpact - Focused Product Plan

**Goal:** Ship a sellable product in 8 weeks, not 24.

**Positioning:** "The Safety Net for AI-Generated Code"

**Tagline:** "Copilot writes. We verify. You ship."

---

## What's Already Built (Current State)

These features are DONE and working:

| Feature | Status | Quality |
|---------|--------|---------|
| Semantic Code Search | Done | HIGH - Returns 20 relevant files with previews |
| Import Validator | Done | HIGH - Catches hallucinated imports |
| Duplicate Detector | Done | HIGH - Finds similar existing functions |
| Pattern Validator | Done | HIGH - Checks against 16 learned patterns |
| Security Scanner | Done | HIGH - OWASP Top 10 patterns |
| Path Alias Support | Done | HIGH - tsconfig.json, @/, ~/ paths |
| Symbol Search | Done | HIGH - AST-based function/class lookup |
| Architecture Analysis | Done | MEDIUM - Monorepo detection, layer mapping |
| Session Resurrection | Done | MEDIUM - Tracks meaningful files |
| MCP Server | Done | HIGH - Works with Claude Code |

**Bottom Line:** You have a working product. Now make it sellable.

---

## Features That Will Sell (Priority Order)

### TIER 1: Ship in Weeks 1-4 (Core Value)

#### 1. Dead Code Detector
**Effort:** 1 week | **Selling Power:** Very High

**Why it sells:**
- Every codebase has 10-30% dead code
- Developers are AFRAID to delete (might break something)
- You PROVE it's safe with dependency analysis
- Instant "wow" in demos

**Implementation:**
- Scan all exports
- Find exports with zero imports
- Find functions with zero call sites
- Report with confidence score

**Output:**
```
Dead Code Report:
- 4,230 lines of unused code detected
- 12 files with zero imports
- 23 functions never called

Safe to delete: 89% confidence
```

---

#### 2. Test Impact Analysis CLI
**Effort:** 2 weeks | **Selling Power:** Very High

**Why it sells:**
- EVERY enterprise has 30-60 min CI
- "Your 45-min build becomes 5 mins" = instant sale
- Direct, measurable ROI

**Implementation:**
- Parse test files, extract what they import
- When file X changes, find tests that import X (directly or transitively)
- Output: "Run these 8 tests instead of 847"

**Command:**
```bash
codeimpact test-impact --changed src/auth/login.ts

# Output:
Analyzing impact of src/auth/login.ts...

Files affected: 12
Tests to run: 8 (instead of 234)
Estimated time: 2m (instead of 28m)
Time saved: 26 minutes
```

---

#### 3. Blast Radius API
**Effort:** 1 week | **Selling Power:** High

**Why it sells:**
- Risk-averse enterprises LOVE this
- "This change affects 34 files, including payment flow"
- Prevents production incidents

**Implementation:**
- Already have dependency graph
- Traverse dependents recursively
- Score by criticality (payment, auth = high risk)

**Output:**
```json
{
  "file": "src/auth/session.ts",
  "risk_score": 78,
  "direct_dependents": 8,
  "transitive_dependents": 34,
  "critical_paths": ["src/api/checkout.ts", "src/billing/payments.ts"],
  "recommendation": "Senior review required"
}
```

---

#### 4. Cost/Token Dashboard (Basic)
**Effort:** 1 week | **Selling Power:** High

**Why it sells:**
- CFOs need to justify AI spend
- "You saved $4,230 this month" = renewal guaranteed
- Creates urgency to upgrade

**Implementation:**
- Track tokens per query (already have this data)
- Calculate cost at standard rates ($0.03/1K input, $0.06/1K output)
- Show: tokens used, tokens saved, dollar savings

**Output:**
```
This Month:
- Queries: 1,247
- Tokens used: 892K (with CodeImpact context optimization)
- Tokens WITHOUT optimization: ~3.2M (estimated)
- Savings: ~2.3M tokens = ~$138 saved
```

---

### TIER 2: Ship in Weeks 5-8 (Enterprise Ready)

#### 5. GitHub PR Integration
**Effort:** 2 weeks | **Selling Power:** High

**Why it sells:**
- Fits existing workflow
- Zero behavior change required
- Visible to entire team

**Implementation:**
- GitHub App that triggers on PR
- Run blast radius + test impact
- Post comment with analysis

**PR Comment:**
```markdown
## CodeImpact Analysis

| Metric | Value |
|--------|-------|
| Risk Score | 72/100 |
| Blast Radius | 23 files |
| Tests Needed | 8 |

### Attention
- `src/auth/middleware.ts` affects 15 downstream files
- Missing test coverage for `validateToken()`

### Suggested Reviewers
@alice (auth owner)
```

---

#### 6. Complexity Hotspots
**Effort:** 1 week | **Selling Power:** Medium-High

**Why it sells:**
- Shows exactly where to focus engineering effort
- Engineering managers love this for planning
- Easy to build (we have the data)

**Implementation:**
- Calculate cyclomatic complexity per file
- Cross-reference with: dependency count, test coverage, change frequency
- Rank by "risk score"

**Output:**
```
Complexity Hotspots:

1. src/billing/payments.ts
   Complexity: 89/100 | Dependents: 34 | Coverage: 23%
   RECOMMENDATION: Urgent refactor needed

2. src/auth/session.ts
   Complexity: 76/100 | Circular dependency detected
   RECOMMENDATION: Break circular dependency

3. src/api/legacy/v1.ts
   Complexity: 71/100 | Coverage: 0%
   RECOMMENDATION: Add tests or deprecate
```

---

#### 7. CLI Polish + Documentation
**Effort:** 1 week | **Selling Power:** Required

**Why it matters:**
- First impression
- Developers judge tools by CLI experience
- Good docs = fewer support requests

**Tasks:**
- Consistent command structure
- Colored output with clear formatting
- `--help` on every command
- Quick start guide (5 minutes to value)
- Example workflows

---

## Features to SKIP (For Now)

| Feature | Why Skip |
|---------|----------|
| Dependency Graph UI | Fancy, low retention. Build after 50 paying customers. |
| Migration Assistant | Cool but rare need. Not a buying trigger. |
| Real-time Collaboration | VS Code Live Share exists. Not your fight. |
| Architecture Drift Detector | Only 5% of teams have rules defined. |
| Multi-project Support | Only needed for large enterprises. Premature. |
| VS Code Extension | HTTP API + MCP covers 90% of use cases. |
| Custom Security Rules | Snyk/SonarQube dominate. Not your differentiator. |

**Rule:** If a feature doesn't help close a sale in the next 60 days, don't build it.

---

## 8-Week Roadmap

### Week 1-2: Dead Code + Test Impact Foundation
| Day | Task |
|-----|------|
| 1-2 | Dead Code Detector - scan exports/imports |
| 3-4 | Dead Code Detector - confidence scoring, CLI output |
| 5 | Dead Code Detector - testing and polish |
| 6-8 | Test Impact - parse test files, build test→file mapping |
| 9-10 | Test Impact - CLI command, output formatting |

**Deliverable:** `codeimpact deadcode` and `codeimpact test-impact` commands

### Week 3-4: Blast Radius + Cost Tracking
| Day | Task |
|-----|------|
| 1-3 | Blast Radius API - recursive dependency traversal |
| 4-5 | Blast Radius - risk scoring, critical path detection |
| 6-7 | Cost Dashboard - token tracking per query |
| 8-10 | Cost Dashboard - savings calculation, CLI report |

**Deliverable:** `codeimpact impact <file>` and `codeimpact stats` commands

### Week 5-6: GitHub Integration
| Day | Task |
|-----|------|
| 1-3 | GitHub App setup, webhook handling |
| 4-6 | PR analysis - run impact + test analysis on PR diff |
| 7-8 | Comment formatting, posting to PR |
| 9-10 | Testing with real PRs, edge cases |

**Deliverable:** GitHub App that comments on PRs

### Week 7-8: Polish + Launch Prep
| Day | Task |
|-----|------|
| 1-3 | Complexity Hotspots command |
| 4-5 | CLI polish - colors, formatting, help text |
| 6-7 | Documentation - quick start, examples, API reference |
| 8-9 | Landing page copy, demo video script |
| 10 | Launch prep, Product Hunt draft |

**Deliverable:** Production-ready product

---

## Pricing Strategy

### Free Tier
- Single project
- 100 queries/month
- Basic commands (search, verify)
- **Purpose:** Adoption, word of mouth

### Pro ($29/month)
- Unlimited queries
- Dead code detector
- Test impact analysis
- Cost tracking
- **Purpose:** Individual developers, small teams

### Team ($99/month)
- Up to 10 users
- All Pro features
- GitHub PR integration
- Shared project settings
- **Purpose:** Team conversion

### Enterprise (Custom)
- Unlimited users
- Self-hosted option
- SSO/SAML
- Priority support
- **Purpose:** Large deals ($500+/month)

---

## Success Metrics

### Week 4 Goals
- [ ] Dead Code Detector shipping
- [ ] Test Impact Analysis shipping
- [ ] 5 developers using daily (can be friends/colleagues)

### Week 8 Goals
- [ ] GitHub integration live
- [ ] Documentation complete
- [ ] 3 paying customers (any tier)
- [ ] Product Hunt launch ready

### Month 3 Goals
- [ ] 50 free users
- [ ] 10 paying customers
- [ ] $500 MRR
- [ ] First enterprise conversation

---

## Go-To-Market Strategy

### Phase 1: Developer Adoption (Weeks 1-8)
1. **Dogfood it** - Use CodeImpact on GlassHire daily
2. **Twitter/X threads** - "I built a tool that catches AI hallucinations"
3. **Dev.to / Hashnode posts** - Tutorial-style content
4. **Reddit** - r/programming, r/webdev (no spam, genuine value)

### Phase 2: Launch (Week 8-10)
1. **Product Hunt** - Prepare assets, get hunter
2. **Hacker News** - "Show HN: CodeImpact - Safety net for AI-generated code"
3. **Direct outreach** - 20 CTOs/Engineering Managers on LinkedIn

### Phase 3: Enterprise (Month 3+)
1. **Case study** - Document one customer's savings
2. **Webinar** - "How we reduced CI time by 80%"
3. **Enterprise landing page** - Focus on security, compliance, ROI

---

## The 5-Minute Demo Script

```
1. PROBLEM (30 sec)
   "AI coding assistants are amazing, but they make mistakes.
   They hallucinate imports, duplicate existing code, and ignore your patterns.
   50% of AI-generated code has potential bugs."

2. SOLUTION (30 sec)
   "CodeImpact is the safety net. It catches AI mistakes before they reach production."

3. DEMO: Import Validation (1 min)
   - Show AI suggesting broken import
   - Run `codeimpact verify`
   - Show it catching the error + suggesting fix

4. DEMO: Duplicate Detection (1 min)
   - Show AI writing new function
   - Run `codeimpact verify`
   - Show "similar function exists at src/utils/format.ts:23"

5. DEMO: Test Impact (1 min)
   - Show changed file
   - Run `codeimpact test-impact`
   - Show "Run 8 tests instead of 234, save 26 minutes"

6. CLOSE (1 min)
   "Works with Claude, Copilot, Cursor - any AI tool.
   Runs locally, your code never leaves your machine.
   Free tier available, Pro is $29/month.
   Questions?"
```

---

## What NOT To Do

1. **Don't build more features before validating** - You have enough
2. **Don't optimize prematurely** - Ship ugly, fix later
3. **Don't build enterprise features before enterprise customers** - They'll tell you what they need
4. **Don't spend weeks on the landing page** - Simple > Fancy
5. **Don't wait for "perfect"** - Ship at 80%, iterate

---

## Daily Checklist During Build Phase

- [ ] Did I ship something today?
- [ ] Did I talk to a potential user today?
- [ ] Did I write down what I learned?
- [ ] Is this feature helping close a sale?

---

## Summary

| What | When | Why |
|------|------|-----|
| Dead Code Detector | Week 1-2 | High wow factor, easy to build |
| Test Impact Analysis | Week 2-3 | Enterprise hook, measurable ROI |
| Blast Radius API | Week 3-4 | Risk prevention, enterprise value |
| Cost Dashboard | Week 4 | Justifies purchase |
| GitHub Integration | Week 5-6 | Fits workflow, visible to team |
| Complexity Hotspots | Week 7 | Planning tool for managers |
| Polish + Launch | Week 8 | First impressions matter |

**Total: 8 weeks to sellable product**

**Then: STOP BUILDING. START SELLING.**

---

*Created: March 2026*
*Goal: 10 paying customers by Month 3*
