import type { SchemeNetworkClient } from "@x402/core/types";

/**
 * Registry for resolving scheme network clients by scheme name.
 *
 * Decouples scheme client lookup from the fetch wrapper so that multiple
 * payment schemes (EVM, Solana, etc.) can be registered and resolved
 * without touching client.ts or ProtocolHandler code.
 */
export interface SchemeRegistry {
  /** Resolve a scheme network client by its scheme name (e.g. "exact") */
  getScheme(name: string): SchemeNetworkClient | undefined;
}
