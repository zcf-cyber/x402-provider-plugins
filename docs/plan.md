# x402-plugins Implementation Plan

**SSOT for milestone / PR decomposition / acceptance criteria.**
**Coder reads this → picks next open PR → executes per `coder_playbook.md`.**
**Manager reviews PR → approves/returns per `manager_playbook.md`.**

---

## 0. Current State Baseline

| Asset | Status |
|---|---|
| Monorepo scaffold (npm workspaces) | ✅ M0 done |
| TypeScript configs (tsconfig.base.json + per-pkg) | ✅ |
| `x402-core` types + interfaces | ✅ |
| `x402-core` `createX402Fetch` stub | ⚠️ throws on 402, no real signing |
| `pi-x402` 3 extensions (provider/wallet/discovery) | ⚠️ skeletons only |
| `opencode-x402` plugin entry | ⚠️ skeleton only |
| `openclaw-x402` plugin entry | ⚠️ skeleton only |
| Build pipeline (`npm run build`) | ✅ all 4 packages compile |
| Typecheck (`npm run typecheck`) | ✅ zero errors |
| Tests | ❌ none |
| Real wallet signer | ❌ none |
| `@x402/fetch` integration | ❌ not wired |

---

## 1. Priority Legend

| Priority | Meaning | Must ship before |
|---|---|---|
| **P0** | Core payment flow — without this, nothing works | Any release |
| **P1** | Multi-runtime coverage — pi/opencode/openclaw all usable | v0.2.0 |
| **P2** | Discovery, polish, docs, release automation | v1.0.0 |

---

## 2. P0 — Core Payment Flow (x402-core + Pi vertical slice)

> **Goal**: A Pi user can register the x402 provider, send a chat, trigger a 402, auto-sign with their wallet, and get a model response — all via the mock gateway.

---

### P0-PR1: EvmSigner — wallet signer implementation

**Scope**: `packages/x402-core/src/signer.ts` (new file)

**Why first**: Every other PR depends on a real signer. Currently `signPayment()` throws.

**Code tasks**:
- [ ] Create `packages/x402-core/src/signer.ts`
- [ ] Implement `EvmSigner` class conforming to `X402Signer` interface
- [ ] Read private key from `X402_PRIVATE_KEY` env var (dev-only)
- [ ] Derive address from private key (ethers.js or viem)
- [ ] Implement `signPayment(paymentRequiredRaw)` — EIP-712 typed data or personal_sign
- [ ] Implement `isReady()` — verify key is loaded and address derivable
- [ ] Export from `packages/x402-core/src/index.ts`

**Unit tests** (`packages/x402-core/src/__tests__/signer.test.ts`):
- [ ] `isReady()` returns true when `X402_PRIVATE_KEY` set
- [ ] `isReady()` returns false when env var missing
- [ ] `address` matches derived address from known test key
- [ ] `signPayment()` returns `{ "PAYMENT-SIGNATURE": "<hex>" }` shape
- [ ] `signPayment()` throws on invalid/missing key
- [ ] Deterministic signature for same payload

**Build verification**:
- [ ] `npm run build -w @x402-plugins/core` passes
- [ ] `npm run typecheck -w @x402-plugins/core` passes

**E2E deliverable**:
- [ ] Manager runs `npx vitest run packages/x402-core/src/__tests__/signer.test.ts` — all green

**PR boundaries**: 1 new file (`signer.ts`), 1 test file, 1 modified file (`index.ts` re-export). ≤200 lines.

---

### P0-PR2: wrapFetchWithPayment integration into createX402Fetch

**Scope**: `packages/x402-core/src/client.ts` (rewrite stub)

**Code tasks**:
- [ ] Import `wrapFetchWithPayment` from `@x402/fetch`
- [ ] Import scheme client (e.g. `ExactEvmScheme`) from `@x402/core`
- [ ] Rewrite `createX402Fetch` to:
  - Accept `X402ClientConfig` + `X402Signer` + optional `X402AuditSink`
  - Call `wrapFetchWithPayment` with the scheme bound to signer
  - Handle V2 headers: `PAYMENT-REQUIRED` → `PAYMENT-SIGNATURE` → retry
  - Emit audit log entries at each phase (402_received, signed, retry, settled, error)
  - Respect `maxRetries` and `requestTimeoutMs` from config
- [ ] Handle V1 fallback (`X-PAYMENT` header) when `protocolVersion: 1`

**Unit tests** (`packages/x402-core/src/__tests__/client.test.ts`):
- [ ] Non-402 response passes through unchanged
- [ ] 402 → signer called → retry with `PAYMENT-SIGNATURE` header → 200 returned
- [ ] 402 → signer not ready → throws with descriptive error
- [ ] 402 → retry count exceeds `maxRetries` → gives up and throws
- [ ] Audit sink receives entries for each phase
- [ ] Timeout (`requestTimeoutMs`) aborts fetch
- [ ] V1 protocol version uses `X-PAYMENT` header path

**Build verification**:
- [ ] `npm run build -w @x402-plugins/core` passes
- [ ] `npm run typecheck -w @x402-plugins/core` passes

**E2E deliverable**:
- [ ] `npx vitest run packages/x402-core/src/__tests__/client.test.ts` — all green

**PR boundaries**: 1 modified file (`client.ts`), 1 new test file. ≤250 lines.

---

### P0-PR3: Mock x402 gateway for local testing

**Scope**: `scripts/mock-gateway.mjs` (new)

**Code tasks**:
- [ ] Standalone Node.js HTTP server (no extra deps)
- [ ] On first request (no `PAYMENT-SIGNATURE`): respond `402` with `PAYMENT-REQUIRED` header
  - Include `quote_id`, `amount`, `asset`, `chain`, `expires_at`, `request_hash`, `challenge_token`
- [ ] On retry with valid `PAYMENT-SIGNATURE`: respond `200` with a fake chat completion JSON
- [ ] On retry with invalid/missing signature: respond `402` again
- [ ] Configurable via CLI args: `--port`, `--require-amount`
- [ ] Log each request to stdout for debugging

**No unit tests** (this is test infrastructure itself).

**Build verification**:
- [ ] `node scripts/mock-gateway.mjs --port 8080` starts and listens
- [ ] `curl -v http://127.0.0.1:8080/v1/chat/completions` → 402 + `PAYMENT-REQUIRED` header

**E2E deliverable**:
- [ ] Manager starts mock gateway → verifies 402 response → verifies 200 on retry with header

**PR boundaries**: 1 new file. ≤150 lines.

---

### P0-PR4: x402-core integration test against mock gateway

**Scope**: `packages/x402-core/src/__tests__/integration.test.ts` (new)

**Code tasks**:
- [ ] Start mock gateway as child process (or in-process) before tests
- [ ] Create `createX402Fetch` with `EvmSigner` pointed at mock gateway
- [ ] Send request → receive 402 → auto-sign → retry → receive 200
- [ ] Assert final response contains expected chat completion body
- [ ] Assert audit log captured all phases: `402_received`, `signed`, `retry`, `settled`
- [ ] Test: insufficient funds scenario (mock returns permanent 402)
- [ ] Test: gateway timeout scenario

**Build verification**:
- [ ] `npm run build -w @x402-plugins/core` passes

**E2E deliverable**:
- [ ] `npx vitest run packages/x402-core/src/__tests__/integration.test.ts` — all green
- [ ] This is the **gate check** for P0 core — if this passes, core is real.

**PR boundaries**: 1 new test file. ≤200 lines.

---

### P0-PR5: Pi-x402 provider — streamSimple implementation

**Scope**: `packages/pi-x402/extensions/x402-provider.ts` (rewrite stub)

**Code tasks**:
- [ ] Import `createX402Fetch` + `EvmSigner` from `@x402-plugins/core`
- [ ] Implement `streamSimple` in provider definition:
  - Create x402-wrapped fetch on provider init
  - Use it to call the gateway's `/v1/chat/completions`
  - Stream response chunks back to Pi's coding agent
- [ ] Wire env vars: `X402_GATEWAY_URL`, `X402_PRIVATE_KEY`, `X402_CHAIN_ID`
- [ ] Remove the `// M2: implement streamSimple` TODO comment
- [ ] Handle errors gracefully (gateway down, 402 loop, signer failure) → surface via Pi's `ctx.ui.notify`

**Unit tests** (`packages/pi-x402/src/__tests__/provider.test.ts`):
- [ ] `registerProvider` is called with expected provider id
- [ ] `streamSimple` calls the wrapped fetch with correct URL
- [ ] `streamSimple` returns chunks in expected format
- [ ] Error from fetch → error notification surfaced

**Build verification**:
- [ ] `npm run build -w @x402-plugins/pi-x402` passes
- [ ] `npm run typecheck -w @x402-plugins/pi-x402` passes

**E2E deliverable**:
- [ ] `npm run install:pi-extensions` → extensions copied
- [ ] Start mock gateway → `pi -e extensions/x402-provider.ts -e extensions/x402-wallet.ts`
- [ ] In Pi: `/providers` shows "X402 Gateway"
- [ ] Chat message → 402 → auto-sign → model response appears

**PR boundaries**: 1 modified file (`x402-provider.ts`), 1 new test file. ≤200 lines.

---

### P0-PR6: Pi-x402 wallet extension — real signer integration

**Scope**: `packages/pi-x402/extensions/x402-wallet.ts` (rewrite stub)

**Code tasks**:
- [ ] Import `EvmSigner` from `@x402-plugins/core`
- [ ] Replace `process.env.X402_WALLET_ADDRESS` boolean check with real `EvmSigner.isReady()`
- [ ] On `session_start`: if signer ready, display masked address; if not, warn
- [ ] On `tool_call`: before any paid tool, verify signer ready + `ctx.ui.confirm` with cost estimate
- [ ] Integration with Pi's cost/quote hooks if available

**Unit tests** (`packages/pi-x402/src/__tests__/wallet.test.ts`):
- [ ] `session_start` with ready signer → notification with address
- [ ] `session_start` without signer → warning notification
- [ ] `tool_call` with ready signer + confirm yes → not blocked
- [ ] `tool_call` with ready signer + confirm no → blocked with reason
- [ ] `tool_call` without signer → blocked with "wallet required"

**Build verification**:
- [ ] `npm run build -w @x402-plugins/pi-x402` passes

**E2E deliverable**:
- [ ] Manager starts Pi with both extensions loaded
- [ ] No wallet → Pi warns "未配置钱包"
- [ ] With wallet → Pi shows address → paid tool triggers confirm → confirmed → proceeds

**PR boundaries**: 1 modified file (`x402-wallet.ts`), 1 new test file. ≤150 lines.

---

## 3. P1 — Multi-Runtime Coverage

---

### P1-PR1: OpenCode plugin — full provider request interception

**Scope**: `packages/opencode-x402/src/index.ts` (rewrite stub)

**Code tasks**:
- [ ] Align with OpenCode Plugin API contract (`@opencode-ai/plugin` types if available)
- [ ] `onProviderRequest`: replace fetch with `createX402Fetch` wrapped version
- [ ] `toolExecuteBefore`: budget check via signer + optional cost estimate
- [ ] Export plugin default function compatible with `opencode.json` loader
- [ ] Remove all `M3` TODO markers

**Unit tests** (`packages/opencode-x402/src/__tests__/plugin.test.ts`):
- [ ] Plugin exports expected shape (`name`, `version`, `onProviderRequest`, `toolExecuteBefore`)
- [ ] `onProviderRequest` injects x402 fetch wrapper when enabled
- [ ] `onProviderRequest` passes through when `enabled: false`
- [ ] `toolExecuteBefore` blocks when signer not ready
- [ ] `toolExecuteBefore` allows when signer ready

**Build verification**:
- [ ] `npm run build -w @x402-plugins/opencode-x402` passes

**E2E deliverable**:
- [ ] Manager copies `examples/opencode/opencode.json` to OpenCode project
- [ ] With mock gateway running, OpenCode chat → 402 → sign → response

**PR boundaries**: 1 modified file (`index.ts`), 1 new test file. ≤200 lines.

---

### P1-PR2: OpenClaw plugin — runAttempt implementation

**Scope**: `packages/openclaw-x402/src/index.ts` (rewrite stub)

**Code tasks**:
- [ ] Align with OpenClaw plugin-sdk `registerProvider` contract
- [ ] Implement `runAttempt`: use `createX402Fetch` to call gateway
- [ ] Parse response and return in OpenClaw expected format
- [ ] Error handling: gateway errors, 402 loop, signer failures
- [ ] Log via `api.log` for observability
- [ ] Remove all `M4` TODO markers

**Unit tests** (`packages/openclaw-x402/src/__tests__/plugin.test.ts`):
- [ ] `registerProvider` is called with correct provider id and config
- [ ] `runAttempt` calls wrapped fetch
- [ ] `runAttempt` returns response in expected format
- [ ] Error path logs and throws appropriately

**Build verification**:
- [ ] `npm run build -w @x402-plugins/openclaw-x402` passes

**E2E deliverable**:
- [ ] Manager installs `openclaw-x402` into OpenClaw project
- [ ] OpenClaw provider list shows "X402 Gateway Provider"
- [ ] Inference attempt → 402 → sign → response

**PR boundaries**: 1 modified file (`index.ts`), 1 new test file. ≤200 lines.

---

### P1-PR3: Cross-package integration smoke test

**Scope**: `scripts/smoke-test.mjs` (new)

**Code tasks**:
- [ ] Script that:
  1. Starts mock gateway
  2. For each package, runs its test suite
  3. Stops mock gateway
  4. Reports pass/fail summary
- [ ] Can be run as `npm run smoke`

**Build verification**:
- [ ] `npm run smoke` exits 0 when all tests pass

**PR boundaries**: 1 new file. ≤100 lines.

---

## 4. P2 — Discovery, Polish, Release

---

### P2-PR1: Discovery service — keyword search + allowlist

**Scope**: `packages/pi-x402/extensions/x402-discovery.ts` (rewrite stub)

**Code tasks**:
- [ ] Implement `registerCommand("discover")` handler:
  - Query configurable discovery index URL
  - Return summary rows (name, endpoint, cost range)
  - Allowlist check before displaying
- [ ] Implement `registerTool("x402_list_services")`:
  - Return allowlisted services from local config
  - Keyword filter support
- [ ] Allowlist: JSON file or env var `X402_ALLOWLIST`

**Unit tests**: TBD by coder — at minimum:
- [ ] Discovery command returns results from mock index
- [ ] Unlisted endpoints filtered by allowlist
- [ ] Empty allowlist → no results

**PR boundaries**: 1 modified file, 1 new test file. ≤200 lines.

---

### P2-PR2: Release automation + changelog

**Scope**: `scripts/release.sh` (new), `CHANGELOG.md` (new)

**Code tasks**:
- [ ] Shell script: clean → install → build → typecheck → test → pack → gh release create
- [ ] Generates `.tgz` artifacts for each package
- [ ] Creates GitHub Release with version tag
- [ ] `CHANGELOG.md` with versioned entries

**PR boundaries**: 2 new files. ≤100 lines.

---

### P2-PR3: README polish + quickstart validation

**Scope**: `README.md` (update)

**Code tasks**:
- [ ] Verify all quickstart commands work on a clean checkout
- [ ] Add architecture diagram (mermaid)
- [ ] Add troubleshooting section
- [ ] Add link to GitHub Releases

**E2E deliverable**:
- [ ] Human follows README from scratch → all steps succeed

**PR boundaries**: 1 modified file. ≤100 lines.

---

## 5. PR Summary Table

| PR | Package | Files | Est. Lines | Depends On |
|---|---|---|---|---|
| P0-PR1 | x402-core | 3 (1 new) | ~150 | — |
| P0-PR2 | x402-core | 2 (1 new) | ~200 | P0-PR1 |
| P0-PR3 | scripts | 1 new | ~120 | — |
| P0-PR4 | x402-core | 1 new (test) | ~180 | P0-PR2, P0-PR3 |
| P0-PR5 | pi-x402 | 2 (1 new) | ~180 | P0-PR4 |
| P0-PR6 | pi-x402 | 2 (1 new) | ~130 | P0-PR5 |
| P1-PR1 | opencode-x402 | 2 (1 new) | ~180 | P0-PR4 |
| P1-PR2 | openclaw-x402 | 2 (1 new) | ~180 | P0-PR4 |
| P1-PR3 | scripts | 1 new | ~80 | P1-PR1, P1-PR2 |
| P2-PR1 | pi-x402 | 2 (1 new) | ~180 | P1-PR3 |
| P2-PR2 | scripts | 2 new | ~80 | P1-PR3 |
| P2-PR3 | root | 1 modified | ~80 | P2-PR2 |

---

## 6. Done Definition (per PR)

A PR is **done** when:

1. ✅ Code implements the specified tasks
2. ✅ Unit tests pass (`npx vitest run <test-file>`)
3. ✅ `npm run build` passes for affected package(s)
4. ✅ `npm run typecheck` passes for affected package(s)
5. ✅ E2E deliverable verified by manager
6. ✅ Manager approves and merges PR

---

## 7. Done Definition (per Milestone)

### P0 Done = Core x402 flow works end-to-end
- [ ] `EvmSigner` signs real EIP-712 payloads
- [ ] `createX402Fetch` retries with `PAYMENT-SIGNATURE` after 402
- [ ] Mock gateway responds correctly to signed/unsigned requests
- [ ] Pi extension loads, registers provider, and completes a chat via mock gateway
- [ ] Human confirms: Pi chat → 402 → auto-sign → model response

### P1 Done = All 3 runtimes usable
- [ ] Pi, OpenCode, OpenClaw each complete an inference via x402
- [ ] Smoke test (`npm run smoke`) passes

### P2 Done = Release-ready
- [ ] Discovery command returns real results
- [ ] `npm run release` creates GitHub Release
- [ ] Human follows README from scratch → fully functional
