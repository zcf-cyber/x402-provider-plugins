# Coder Playbook

**Role**: Coder — the implementer. You write code, unit tests, and submit PRs.
**You report to**: Manager (reviewer/approver).
**Source of truth**: `docs/plan.md`.

---

## 1. Your Workflow

```
Pick next open PR from plan.md
        │
        ▼
Read the PR spec (scope, tasks, boundaries)
        │
        ▼
Create a branch: <pr-id>/<short-description>
        │
        ▼
Implement code + unit tests
        │
        ▼
Verify: build + typecheck + tests pass locally
        │
        ▼
Commit with structured message
        │
        ▼
Push branch → Open PR to main
        │
        ▼
Wait for manager review
        │
        ▼
Address feedback (if any) → push fixes → re-request review
        │
        ▼
Manager approves & merges ✅
```

---

## 2. Branch Naming

```
P0-PR1/evm-signer
P0-PR2/wrap-fetch-integration
P1-PR1/opencode-plugin
...
```

Pattern: `<pr-id>/<kebab-case-description>`

---

## 3. PR Boundaries (Hard Rules)

Every PR must respect these limits. If you exceed them, split the PR further.

| Constraint | Limit |
|---|---|
| Files changed | ≤ 3 files |
| Lines added+removed | ≤ 250 lines |
| New dependencies | 0 (unless explicitly allowed in PR spec) |
| Interface changes | Only additive (no breaking existing exports) |

**If you need to exceed any limit**: stop, push what you have as a partial, and note it in the PR description for manager discussion.

---

## 4. Code Standards

### 4.1 Language & Style

- **TypeScript** only. No `.js` source files.
- ESM modules (`import`/`export`), not CommonJS.
- Follow existing patterns in the package you're editing.
- No `any` types — use `unknown` or proper types.
- No `console.log` in production code — use the audit sink or structured logging.
- Comments in English.

### 4.2 File Layout

```
packages/<pkg>/src/
  index.ts          # public exports only
  types.ts          # type definitions (if new types needed)
  <feature>.ts      # implementation
  __tests__/
    <feature>.test.ts   # unit tests (vitest)
```

### 4.3 Imports

- Use `.js` extension in relative imports (NodeNext module resolution):
  ```typescript
  import { createX402Fetch } from "./client.js";    // ✅
  import { createX402Fetch } from "./client";        // ❌
  ```
- Package imports: use the package name, not relative paths:
  ```typescript
  import { X402Signer } from "@x402-plugins/core";   // ✅
  ```

### 4.4 Error Handling

- Throw `Error` with descriptive, grep-friendly messages prefixed by `x402:`:
  ```typescript
  throw new Error("x402: signer not ready — set X402_PRIVATE_KEY");
  ```
- Never silently swallow errors. If an error is expected, catch and re-throw with context.

### 4.5 Environment Variables

- All config from env vars must have a fallback default:
  ```typescript
  const gatewayUrl = process.env.X402_GATEWAY_URL ?? "http://127.0.0.1:8080";
  ```
- Never hardcode secrets or addresses in source.

---

## 5. Unit Test Standards

### 5.1 Framework

- **vitest** — already compatible with the project's ESM setup.
- Test files go in `src/__tests__/` alongside the code they test.

### 5.2 Test Structure

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("EvmSigner", () => {
  let signer: EvmSigner;

  beforeEach(() => {
    // setup: set env vars, create instances
  });

  afterEach(() => {
    // teardown: clear env vars, reset mocks
    vi.restoreAllMocks();
  });

  it("should return true when private key is set", async () => {
    // arrange → act → assert
  });
});
```

### 5.3 Coverage Requirements

- Every public function must have at least: 1 happy-path test + 1 error-path test.
- Every `if` branch must be exercised.
- Mock external dependencies (`fetch`, signer, etc.) — never hit real network in unit tests.

### 5.4 Running Tests

```bash
# Single test file
npx vitest run packages/x402-core/src/__tests__/signer.test.ts

# All tests in a package
npx vitest run packages/x402-core/src/__tests__/

# Watch mode (during development)
npx vitest packages/x402-core/src/__tests__/
```

---

## 6. Build Verification (Before PR)

Run these commands in order. All must exit 0 before you push.

```bash
# 1. Typecheck
npm run typecheck -w @x402-plugins/<package>

# 2. Build
npm run build -w @x402-plugins/<package>

# 3. Unit tests
npx vitest run packages/<package>/src/__tests__/
```

If any step fails, fix it. Do not submit a PR that fails build/typecheck/tests.

---

## 7. Commit Message Format

```
<pr-id>: <imperative-verb summary>

- bullet point of what changed
- bullet point of why
- any note for reviewer
```

Example:

```
P0-PR1: Implement EvmSigner with EIP-712 signing

- Add signer.ts with EvmSigner class conforming to X402Signer
- Read X402_PRIVATE_KEY from env, derive address via ethers
- signPayment returns PAYMENT-SIGNATURE header shape
- Export from x402-core index
- Unit tests: isReady, address derivation, signature shape
```

---

## 8. PR Description Template

When opening a PR, fill out:

```markdown
## PR: <pr-id> — <title>

### Scope
- Package(s) affected: <list>
- Files changed: <count>
- Lines: +<added> / -<removed>

### What
<2-3 sentence summary of what this PR implements>

### Test Evidence
```
<paste the output of npx vitest run>
```

### Build Verification
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npx vitest run` passes

### Risk Notes
- Breaking changes: none / <describe>
- New dependencies: none / <list with justification>
- Rollback: <how to revert if this breaks>
```

---

## 9. Addressing Manager Feedback

When the manager requests changes:

1. Read every comment. If unclear, ask for clarification in the PR thread.
2. Make minimal, targeted fixes — do not refactor unrelated code.
3. Push fix commits to the same branch.
4. Reply to each review comment with what you changed.
5. Re-request review.

Do NOT:
- Argue about style preferences — follow the manager's direction.
- Force-push after review has started (use `--force-with-lease` only if necessary and communicate it).
- Close the PR and open a new one for the same task.

---

## 10. Quick Reference: Project Map

```
x402-plugins/
  packages/
    x402-core/           ← shared types, fetch wrapper, signer interface
      src/
        index.ts         ← public exports
        types.ts         ← X402Signer, X402ClientConfig, X402AuditSink, etc.
        client.ts        ← createX402Fetch (stub → real in P0-PR2)
        signer.ts        ← EvmSigner (new in P0-PR1)
    pi-x402/             ← Pi coding-agent extensions
      src/index.ts       ← extension path exports
      extensions/
        x402-provider.ts ← registerProvider + streamSimple
        x402-wallet.ts   ← session gates + confirm
        x402-discovery.ts← /discover command (P2)
    opencode-x402/       ← OpenCode plugin
      src/index.ts       ← plugin entry + hooks
    openclaw-x402/       ← OpenClaw plugin
      src/index.ts       ← registerProvider + runAttempt
  scripts/
    mock-gateway.mjs     ← local 402 test server (P0-PR3)
    smoke-test.mjs       ← cross-package smoke (P1-PR3)
    install-pi-extensions.mjs ← symlink Pi extensions
    release.sh           ← release automation (P2-PR2)
  docs/
    plan.md              ← SSOT for PR tasks
    coder_playbook.md    ← this file
    manager_playbook.md  ← manager's review guide
```

---

## 11. Anti-Patterns (Don't Do These)

- ❌ Submitting a PR without running `npm run build` first
- ❌ Adding a dependency without manager approval
- ❌ Changing the signature of an exported function without updating all callers
- ❌ Mixing unrelated changes (e.g., fixing a typo in README inside a signer PR)
- ❌ Deleting or commenting out existing tests to make yours pass
- ❌ Using `as any` to silence type errors
- ❌ Hardcoding values that should come from env vars
- ❌ Skipping the PR description template
