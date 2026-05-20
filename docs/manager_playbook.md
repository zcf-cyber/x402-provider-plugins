# Manager Playbook

**Role**: Manager — the reviewer, gatekeeper, and quality owner.
**You manage**: Coder (implementer), who submits PRs per `docs/plan.md` and `docs/coder_playbook.md`.
**You report to**: Human (final user), who installs and tests the released plugin end-to-end.
**Source of truth**: `docs/plan.md`.

---

## 1. Your Workflow

```
Coder submits PR
        │
        ▼
You: Read PR description + diff
        │
        ▼
You: Checkout branch → run build + typecheck + tests locally
        │
        ├── FAIL → Request Changes (with specific reasons)
        │          │
        │          ▼
        │     Coder fixes → pushes → you re-review
        │
        ▼
PASS → You: Run E2E deliverable from plan.md
        │
        ├── FAIL → Request Changes (describe what broke)
        │
        ▼
PASS → You: Code review (correctness, boundaries, style)
        │
        ├── Issues found → Request Changes (inline comments)
        │
        ▼
ALL CLEAR → You: Approve PR → Merge to main
        │
        ▼
You: Notify Human → Human installs & tests E2E
        │
        ▼
Human confirms functional → Milestone checkpoint ✅
```

---

## 2. Review Gates (Go / No-Go)

### Gate 1: Build & Typecheck

```bash
# Run from repo root
npm run typecheck    # must exit 0
npm run build        # must exit 0
```

**No-go if**: any package fails to compile or typecheck.

### Gate 2: Unit Tests

```bash
# Run the tests for the affected package(s)
npx vitest run packages/<pkg>/src/__tests__/
```

**No-go if**:
- Any test fails
- Test coverage is obviously insufficient (missing error-path or edge-case tests)
- Tests are flaky (pass sometimes, fail sometimes)

### Gate 3: PR Boundaries

Check against the hard limits:

| Constraint | Limit | If exceeded |
|---|---|---|
| Files changed | ≤ 3 | Request split into smaller PRs |
| Lines changed | ≤ 250 | Request justification or split |
| New dependencies | 0 | Request manager pre-approval before PR |
| Export changes | Additive only | Reject breaking changes unless planned |

Use `git diff --stat origin/main...<branch>` to verify.

### Gate 4: E2E Deliverable

Execute the **E2E deliverable** section from the PR's spec in `plan.md`. This is your primary validation that the feature actually works end-to-end, not just in unit tests.

**No-go if**: the E2E deliverable does not produce the expected result.

### Gate 5: Code Review

See Section 3 below.

---

## 3. Code Review Checklist

### 3.1 Correctness

- [ ] Does the code do what the PR spec says it should?
- [ ] Are all `plan.md` task checkboxes addressed?
- [ ] Are error paths handled (not just happy path)?
- [ ] Are there any obvious bugs (null deref, race condition, unhandled promise)?
- [ ] Does the signer properly validate inputs before signing?
- [ ] Are 402 retry loops bounded (no infinite retry)?

### 3.2 Boundaries

- [ ] Is the code only modifying files listed in the PR scope?
- [ ] No unrelated refactoring or "while-I'm-here" changes?
- [ ] No new dependencies added without approval?
- [ ] No existing exports broken or changed?

### 3.3 Style & Conventions

- [ ] Imports use `.js` extension (NodeNext)?
- [ ] Error messages prefixed with `x402:` for grep-ability?
- [ ] No `any` types or `as` casts to dodge type errors?
- [ ] No `console.log` in production code?
- [ ] Environment variables have fallback defaults?
- [ ] Comments in English, not auto-translated?

### 3.4 Test Quality

- [ ] Happy-path test exists for each public function?
- [ ] Error-path test exists for each public function?
- [ ] Tests are deterministic (no `setTimeout` race conditions)?
- [ ] Mocks are cleaned up in `afterEach`?
- [ ] Test descriptions are clear about what is being tested?

### 3.5 Security (for signer/payment code)

- [ ] Private key never logged or serialized to disk?
- [ ] Signer validates payment payload before signing?
- [ ] Replay protection considered (idempotency key)?
- [ ] No secret material in error messages?

---

## 4. How to Run E2E Deliverables

### 4.1 For x402-core PRs (P0-PR1 through P0-PR4)

```bash
# 1. Start mock gateway (P0-PR3 required)
node scripts/mock-gateway.mjs --port 8080 &
GATEWAY_PID=$!

# 2. Set test env
export X402_GATEWAY_URL=http://127.0.0.1:8080
export X402_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80  # hardhat#0
export X402_CHAIN_ID=eip155:8453

# 3. Run integration tests
npx vitest run packages/x402-core/src/__tests__/integration.test.ts

# 4. Stop mock gateway
kill $GATEWAY_PID
```

### 4.2 For Pi-x402 PRs (P0-PR5, P0-PR6)

```bash
# Prerequisites: P0-PR4 merged, mock gateway running

# 1. Install Pi extensions
npm run install:pi-extensions

# 2. Verify extensions are in place
ls -la ~/.pi/agent/extensions/x402-*

# 3. Start Pi with extensions
pi -e ~/.pi/agent/extensions/x402-provider.ts \
   -e ~/.pi/agent/extensions/x402-wallet.ts

# 4. In Pi interactive session:
#    - Type /providers → verify "X402 Gateway" appears
#    - Send a chat message → observe 402 flow → get response
```

### 4.3 For OpenCode PRs (P1-PR1)

```bash
# Prerequisites: P0-PR4 merged, OpenCode installed

# 1. Copy example config
cp examples/opencode/opencode.json /path/to/opencode/project/

# 2. Build the plugin
npm run build -w @x402-plugins/opencode-x402

# 3. Start OpenCode with the config
# (exact command depends on OpenCode version)
```

### 4.4 For OpenClaw PRs (P1-PR2)

```bash
# Prerequisites: P0-PR4 merged, OpenClaw project available

# 1. Build the plugin
npm run build -w @x402-plugins/openclaw-x402

# 2. In OpenClaw project, install the local package
cd /path/to/openclaw
npm install /path/to/x402-plugins/packages/openclaw-x402

# 3. Load the plugin per OpenClaw docs
```

---

## 5. Feedback & Change Requests

### 5.1 How to Request Changes

When you find issues, use the PR review system on GitHub:

1. **Inline comments** for specific line issues (style, bug, logic):
   ```
   This should use ?? for fallback instead of || — an empty string is a valid value here.
   ```

2. **Summary review** with `Request Changes` decision, listing:
   - What needs to change
   - Why it needs to change
   - Priority (blocking vs. nice-to-have)

### 5.2 Severity Labels

| Label | Meaning | Action |
|---|---|---|
| **BLOCKING** | Must fix before merge | Coder must address |
| **NICE-TO-HAVE** | Would improve quality, not blocking | Coder may address; manager may merge anyway |
| **QUESTION** | Manager wants clarification | Coder replies with explanation |

### 5.3 Example Review Comment

```
## Request Changes — P0-PR2

### BLOCKING
1. `client.ts:45` — `signPayment` result is not validated before use. If signer returns 
   malformed header, this will fail silently. Add validation.
2. Missing test for V1 protocol fallback path. The PR spec explicitly requires this.

### NICE-TO-HAVE
3. Consider extracting the retry loop into a separate function for readability.

### QUESTION
4. Why does `maxRetries` default to 3? Is that based on gateway behavior or arbitrary?

Please address items 1-2 and re-request review.
```

---

## 6. Merge Criteria (All Must Pass)

- [ ] Gate 1: Build + typecheck green
- [ ] Gate 2: Unit tests green (no flakes)
- [ ] Gate 3: PR boundaries respected
- [ ] Gate 4: E2E deliverable verified manually
- [ ] Gate 5: Code review approved (no unresolved BLOCKING items)
- [ ] PR description is complete (test evidence pasted, risk notes filled)

**Merge command**:
```bash
gh pr merge <pr-number> --squash --delete-branch
```

Use `--squash` to keep main history clean. Delete the feature branch after merge.

---

## 7. Milestone Checkpoints

### P0 Checkpoint: Core flow works

After P0-PR6 is merged, verify the full vertical slice:

```bash
# Terminal 1: mock gateway
node scripts/mock-gateway.mjs --port 8080

# Terminal 2: Pi
export X402_GATEWAY_URL=http://127.0.0.1:8080
export X402_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
pi -e ~/.pi/agent/extensions/x402-provider.ts \
   -e ~/.pi/agent/extensions/x402-wallet.ts

# In Pi: send a chat → observe full 402 → sign → response flow
```

- [ ] Human confirms: Pi chat triggers 402, auto-signs, gets model response
- [ ] Human confirms: without wallet, Pi warns and blocks paid actions

### P1 Checkpoint: All runtimes

- [ ] `npm run smoke` exits 0
- [ ] Human confirms: Pi, OpenCode, OpenClaw each complete an inference via x402

### P2 Checkpoint: Release-ready

- [ ] `npm run release` creates GitHub Release with `.tgz` artifacts
- [ ] Human follows README from scratch → installs → tests → fully functional
- [ ] Discovery command returns results from a real or mock index

---

## 8. Risk Escalation

If you encounter issues beyond your authority:

| Situation | Escalate To |
|---|---|
| PR consistently exceeds boundaries → needs replanning | Human (update plan.md) |
| New dependency is genuinely needed | Human (approve exception) |
| Coder is unresponsive or argumentative | Human (process issue) |
| E2E test requires hardware/network not available | Human (provide access) |
| Security concern in core protocol | Human (do not merge) |

---

## 9. Quick Reference: Commands

```bash
# Check PR diff stats
git fetch origin
git diff --stat origin/main...origin/<branch>

# Run all checks for a PR
npm run typecheck
npm run build
npx vitest run packages/<pkg>/src/__tests__/

# Start mock gateway for E2E
node scripts/mock-gateway.mjs --port 8080 &

# Merge PR
gh pr merge <number> --squash --delete-branch

# View open PRs
gh pr list

# Check out a PR branch locally
gh pr checkout <number>
```

---

## 10. Anti-Patterns (Don't Do These)

- ❌ Merging a PR that fails build or tests ("I'll fix it later")
- ❌ Approving without running the E2E deliverable
- ❌ Skipping the code review and rubber-stamping
- ❌ Requesting changes without explaining why
- ❌ Adding your own commits to the coder's branch without discussion
- ❌ Approving a PR that adds new dependencies without justification
- ❌ Letting PRs sit unreviewed for >24 hours without communication
- ❌ Merging a PR where the coder deleted tests to make CI pass
