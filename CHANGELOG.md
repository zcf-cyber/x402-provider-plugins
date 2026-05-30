# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.1.0] - 2026-05-30

### Added
- `x402-core`: EvmSigner with EIP-712 payment signing and address derivation.
- `x402-core`: `createX402Fetch` wrapper with automatic 402 retry, audit sink, and V1/V2 header support.
- `pi-x402`: Provider extension (`streamSimple`), wallet extension (`isReady` gating), and discovery extension (keyword search + allowlist).
- `opencode-x402`: Plugin with `onProviderRequest` interception and `toolExecuteBefore` budget checks.
- `openclaw-x402`: Plugin with `runAttempt` implementation for x402 gateway inference.
- `scripts/mock-gateway.mjs`: Standalone mock x402 gateway for local development and testing.
- `scripts/smoke-test.mjs`: Cross-package smoke test runner.
