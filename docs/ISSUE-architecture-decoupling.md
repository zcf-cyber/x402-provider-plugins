# Architecture Issue: x402 Protocol Coupling Makes Standard Evolution Expensive

> **Type**: Enhancement / Refactoring  
> **Priority**: P2 (Release-ready)  
> **Labels**: `enhancement`, `architecture`, `refactor`, `P2`, `protocol-evolution`  
> **Created**: 2026-05-26  
> **Target Milestone**: P2-PRx (TBD by Manager)

---

## 1. Problem Statement

The current codebase embeds x402 protocol details (header names, payload structures, version numbers, scheme identifiers) directly into production and test infrastructure code. When the x402 standard evolves—for example, from the current 4-step handshake (request → 402 → sign → retry) to a 6-step handshake with challenge-response—the blast radius of required changes is unacceptably large.

### 1.1 Concrete Example: "What if x402 adds a Challenge step?"

A future protocol revision might require:

1. Client sends request
2. Server responds `402` + `PAYMENT-REQUIRED` + `X402-CHALLENGE`  
3. Client solves challenge (e.g., sign a nonce)
4. Client retries with `PAYMENT-SIGNATURE` + `X402-CHALLENGE-RESPONSE`
5. Server validates both signature and challenge
6. Server returns `200`

**Current impact:**
| Module | Estimated rewrite % | Why |
|---|---|---|
| `scripts/mock-gateway.mjs` | ~70% | Entire request handler assumes 2-step flow; no hook points for challenge |
| `packages/x402-core/src/client.ts` | ~40% | `createX402Fetch` hard-codes retry logic; `EvmSchemeClient` is internal and monolithic |
| `packages/x402-core/src/signer.ts` | ~30% | `createSignMessage` is a hard-coded string builder; cannot inject new fields like `challenge` |
| `packages/x402-core/src/__tests__/client.test.ts` | ~80% | All 23 tests assert on 4-step flow assumptions |
| `packages/x402-core/src/__tests__/signer.test.ts` | ~50% | Tests assert on exact message string shape |

**Root cause:** protocol concerns are not isolated from transport concerns.

---

## 2. Coupling Audit (Current State)

### 2.1 `scripts/mock-gateway.mjs` — Monolithic Test Infrastructure

**Issue:** The file conflates **four responsibilities** into one 150-line script:

| Responsibility | Current Location | Hard-coded Content |
|---|---|---|
| HTTP Transport | `http.createServer(...)` | None (uses Node.js built-in) ✅ |
| Protocol Version | `createPaymentRequired()` | `x402Version: 2` |
| Header Names | Multiple `res.writeHead(...)` | `"PAYMENT-REQUIRED"`, `"PAYMENT-SIGNATURE"`, `"X-PAYMENT"` |
| Payload Schema | `createPaymentRequired()` | `accepts[0].extra.quote_id/expires_at/request_hash/challenge_token` |
| Signature Validation | `isValidSignature()` | Assumes base64 → JSON → `payload.signature.startsWith("0x")` |
| Response Generation | `createChatCompletion()` | Hard-coded OpenAI-compatible JSON |

**Consequence:** Adding a new header, changing a field name, or supporting a new protocol version requires editing the same `http.createServer` callback. There is no seam to swap in a V3 handler.

### 2.2 `packages/x402-core/src/client.ts` — Internal Class, No Injection Point

**Issue:** `EvmSchemeClient` is a **private class** (not exported) instantiated directly inside `createX402Fetch`:

```typescript
// client.ts:126 — no way to inject a different scheme client
const schemeClient = new EvmSchemeClient("exact_evm", signer);
```

**Consequence:**
- Cannot inject a `SolanaSchemeClient` or `BitcoinSchemeClient` without editing `createX402Fetch`.
- Cannot inject a mock scheme client for unit testing without monkey-patching or recompiling.
- The `buildPaymentRequired` method hard-codes field mapping from `@x402/core/types.PaymentRequirements` to a plain object, with no validation or schema.

### 2.3 `packages/x402-core/src/signer.ts` — Hard-coded Message Template

**Issue:** `createSignMessage` is a string concatenation function with no external configuration:

```typescript
const parts: string[] = ["x402 Payment Authorization"];
if (req.x402Version !== undefined) parts.push(`Version: ${String(req.x402Version)}`);
// ... more hard-coded field names
```

**Consequence:**
- Adding a new field (e.g., `nonce`, `deadline`) requires editing the method.
- Message prefix `"x402 Payment Authorization"` cannot be parameterized.
- Unit tests assert on exact string output, making any format change a breaking change for tests.

### 2.4 `packages/x402-core/src/__tests__/*.test.ts` — Tests Assert on Implementation Details

**Issue:** Tests for `client.ts` and `signer.ts` make assertions about internal behavior (header names, exact retry counts, exact message strings) rather than on observable outcomes.

**Consequence:** When protocol details change, tests break even if the observable behavior ("402 → sign → 200") remains correct.

---

## 3. Why New Modules Are Needed

### 3.1 Separation of Concerns

The **Single Responsibility Principle** demands that:
- `mock-gateway` should only know about **HTTP** (status codes, headers, body).
- A `protocol-handler` module should only know about **x402 wire format** (base64 encoding, field names, version numbers).
- `x402-core` should only know about **business logic** (signer readiness, retry policy, audit).

### 3.2 Dependency Inversion

High-level modules (`createX402Fetch`) should not depend on low-level details (`"exact_evm"` scheme name). Instead, both should depend on abstractions:

```typescript
// Instead of:
const schemeClient = new EvmSchemeClient("exact_evm", signer);

// Prefer:
const schemeClient = config.schemeFactory(signer, config.network);
```

### 3.3 Testability

A decoupled `ProtocolHandler` interface allows:
- **Mock protocol handlers** in unit tests (no real HTTP, no real base64).
- **Property-based tests** for message serialization ("does every field in PaymentRequirements appear in the signed message?").
- **Snapshot tests** for wire format changes ("did V3 change the base64 structure?").

### 3.4 Protocol Evolution Without Code Churn

When x402 V3 is released, the ideal diff should look like:

```diff
- import { V2ProtocolHandler } from "./protocol/v2.js";
+ import { V3ProtocolHandler } from "./protocol/v3.js";

- const handler = new V2ProtocolHandler();
+ const handler = new V3ProtocolHandler();
```

Not a 70% rewrite of `mock-gateway.mjs`.

---

## 4. Proposed New Module Structure

### 4.1 `packages/x402-core/src/protocol/` (new directory)

```
packages/x402-core/src/protocol/
  index.ts              # exports ProtocolHandler interface + factory
  v2.ts                 # V2ProtocolHandler implementation
  v2.test.ts            # unit tests for V2 wire format
  types.ts              # ProtocolMessage, ProtocolHeader, etc.
```

**`ProtocolHandler` Interface:**

```typescript
export interface ProtocolHandler {
  readonly version: number;
  readonly scheme: string;

  // Server-side (used by mock-gateway)
  createPaymentRequired(requirements: PaymentRequirements): string; // base64 header value
  validateSignature(headerValue: string): boolean;
  createSuccessResponse(): string; // response body
  createErrorResponse(reason: string): string;

  // Client-side (used by x402-core)
  parsePaymentRequired(headerValue: string): PaymentRequirements;
  buildPaymentSignature(
    paymentRequired: PaymentRequirements,
    signer: X402Signer,
  ): Promise<Record<string, string>>; // header name → value
}
```

### 4.2 `scripts/mock-gateway/` (new directory)

```
scripts/mock-gateway/
  index.mjs             # HTTP server (thin transport layer)
  handler.mjs           # wires ProtocolHandler to HTTP
```

**`index.mjs` responsibility:**
- Parse CLI args (`--port`, `--require-amount`).
- Create `http.createServer`.
- Delegate all protocol logic to `handler.mjs`.

**`handler.mjs` responsibility:**
- Import `V2ProtocolHandler` from `@x402-plugins/core/protocol/v2.js`.
- Map HTTP headers ↔ protocol methods.
- No hard-coded header names.

### 4.3 `packages/x402-core/src/scheme/` (new directory)

```
packages/x402-core/src/scheme/
  index.ts              # exports SchemeClient interface + registry
  evm.ts                # EvmSchemeClient (moved from client.ts)
  svm.ts                # placeholder for Solana
  registry.ts           # maps scheme name → factory
```

**`SchemeRegistry`:**

```typescript
export interface SchemeFactory {
  create(scheme: string, signer: X402Signer): SchemeNetworkClient;
}

export class SchemeRegistry {
  register(name: string, factory: SchemeFactory): void;
  create(name: string, signer: X402Signer): SchemeNetworkClient;
}
```

### 4.4 `packages/x402-core/src/message/` (new directory)

```
packages/x402-core/src/message/
  index.ts              # exports MessageBuilder interface
  template.ts           # default template builder
```

**`MessageBuilder` Interface:**

```typescript
export interface MessageBuilder {
  build(paymentRequired: unknown): string;
}

// Default implementation uses a template string
export class TemplateMessageBuilder implements MessageBuilder {
  constructor(template: string) { ... }
  build(paymentRequired: unknown): string { ... }
}
```

---

## 5. Migration Impact (What Changes for Each Module)

| Current File | Change | Notes |
|---|---|---|
| `scripts/mock-gateway.mjs` | **Split** into `scripts/mock-gateway/index.mjs` + `handler.mjs` | HTTP layer stays; protocol logic moves to `@x402-plugins/core/protocol/v2.js` |
| `packages/x402-core/src/client.ts` | **Extract** `EvmSchemeClient` → `packages/x402-core/src/scheme/evm.ts` | Add `config.schemeClient?: SchemeNetworkClient` injection point |
| `packages/x402-core/src/signer.ts` | **Extract** `createSignMessage` → `packages/x402-core/src/message/template.ts` | `EvmSigner` receives `MessageBuilder` via constructor |
| `packages/x402-core/src/__tests__/client.test.ts` | **Refactor** to use mock `ProtocolHandler` | Remove assertions on internal header names; assert on observable outcomes |
| `packages/x402-core/src/__tests__/signer.test.ts` | **Refactor** to use `TemplateMessageBuilder` | Remove assertions on exact string; assert on field presence |

---

## 6. Phase Recommendation: When to Introduce Each Module

### P0 (Current): Do NOT refactor
- **Reason:** P0 is the "make it work" phase. The first integration test (P0-PR4) needs a working mock gateway and client. Refactoring now would destabilize the vertical slice before it is proven.
- **Risk:** Delayed P0 milestone, blocked P0-PR4/P0-PR5.

### P1 (Multi-Runtime): Extract `SchemeRegistry` only
- **Reason:** P1 requires supporting Pi, OpenCode, and OpenClaw. If any runtime needs a different scheme (e.g., SVM on Solana), a `SchemeRegistry` is the minimal abstraction needed.
- **Scope:** Move `EvmSchemeClient` to `src/scheme/evm.ts`, add `SchemeRegistry`, keep everything else hard-coded.

### P2 (Polish & Release): Full decoupling
- **Reason:** After P1, the full feature set is complete. P2 is the right time to pay down technical debt before v1.0.0 release.
- **Scope:** All modules proposed in Section 4.

### Post-v1.0.0: Protocol Version Switching
- **Reason:** Once released, x402 V3 may arrive. With the decoupled architecture, adding `V3ProtocolHandler` is a matter of implementing the interface and wiring it in config.
- **Scope:** Add `src/protocol/v3.ts`, update `ProtocolHandlerFactory`.

---

## 7. Acceptance Criteria (for the Refactoring PR)

1. **`mock-gateway.mjs` does not contain hard-coded header names.**
   - All header names come from `ProtocolHandler` interface.
2. **`createX402Fetch` accepts an optional `schemeClient` injection.**
   - Default behavior unchanged (uses `EvmSchemeClient`).
3. **`EvmSigner` accepts an optional `MessageBuilder` injection.**
   - Default behavior unchanged (uses `TemplateMessageBuilder`).
4. **All existing tests pass without modification.**
   - Or, if tests must change, only the test setup changes (injecting mocks), not the assertions.
5. **New unit tests exist for `ProtocolHandler`, `SchemeRegistry`, and `MessageBuilder`.**
   - Coverage: happy path + error path for each public method.
6. **Build and typecheck pass for all packages.**
   - `npm run build` and `npm run typecheck` exit 0.

---

## 8. Rollback Plan

If the refactoring introduces regressions:

1. Revert the refactoring PR.
2. The pre-refactor code is preserved in git history (tag `pre-protocol-decoupling` if desired).
3. Re-run P0-PR4 integration tests to confirm core flow still works.

---

## 9. Related Documents

- `docs/plan.md` — Milestone and PR decomposition
- `docs/coder_playbook.md` — Coding standards and file layout
- `docs/ENGINEERING_PLAYBOOK.md` — General engineering practices (if available)
- `@x402/fetch` source — Reference for actual protocol implementation

---

## 10. Next Steps

1. **Manager**: Review this issue, assign to a P2-PR, and create a GitHub Issue referencing this document.
2. **Coder (P2)**: When assigned, implement the modules in the order:
   - `ProtocolHandler` interface + `V2ProtocolHandler`
   - `SchemeRegistry` + extract `EvmSchemeClient`
   - `MessageBuilder` + extract `TemplateMessageBuilder`
   - Refactor `mock-gateway.mjs` to use `ProtocolHandler`
   - Refactor tests to use mocks
3. **QA**: After refactoring, run full integration test suite (`npm run smoke`) to verify no regressions.

---

*End of Architecture Issue*
