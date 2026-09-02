import type { Account, Address, Hex, PublicClient, WalletClient } from "viem";
import { SLA_ESCROW_ABI } from "./abi.js";
import { type AttributionCheck, checkTxAttribution, resolveDataSuffix } from "./attribution.js";
import type { PendingSettlement, SettlementStore } from "./seller.js";

export interface SettlerConfig {
  wallet: WalletClient;
  publicClient: PublicClient;
  account: Account;
  escrow: Address;
  store: SettlementStore;
  /** Max calls per settlement transaction. */
  batchSize?: number;
  /**
   * Attribution codes to encode into every settlement's calldata, in order —
   * typically your own project code followed by the tag an event assigned you.
   *
   * Preferred over `dataSuffix`: the encoding is done by Celo's own helper, and
   * on Celo mainnet an empty list is a hard error rather than a silent omission,
   * because calldata cannot be amended after a send and there is no backfill.
   */
  attributionCodes?: readonly string[];
  /**
   * Pre-encoded ERC-8021 suffix, for callers who already built one.
   * Ignored when `attributionCodes` is supplied.
   */
  dataSuffix?: Hex;
  /**
   * Pay gas in an ERC-20 instead of CELO (Celo fee abstraction). Must be the
   * token's *adapter* address for tokens that are not 18 decimals.
   */
  feeCurrency?: Address;
}

export interface SettlementResult {
  txHash: Hex;
  requestIds: Hex[];
  count: number;
  grossAmount: bigint;
}

/**
 * Batches acknowledged calls into single on-chain settlements.
 *
 * This is the other half of the zero-gas-for-buyers claim: per-call cost is
 * amortised across a batch rather than paid per request, so an endpoint priced
 * in fractions of a cent stays economic.
 */
export function createSettler(cfg: SettlerConfig) {
  const batchSize = cfg.batchSize ?? 25;

  // Resolved once, at construction, so a missing mainnet tag fails before the
  // settler is wired into anything rather than on the first settlement.
  const codes = cfg.attributionCodes?.filter((c) => c.trim().length > 0) ?? [];
  const chainId = cfg.wallet.chain?.id ?? 0;
  const dataSuffix =
    codes.length > 0
      ? resolveDataSuffix({ chainId, codes })
      : (cfg.dataSuffix ?? resolveDataSuffix({ chainId, codes: [] }));

  async function settleOnce(): Promise<SettlementResult | undefined> {
    const ready = cfg.store.readyForFastPath().slice(0, batchSize);
    if (ready.length === 0) return undefined;

    const txHash = await submit(ready);
    const requestIds = ready.map((s) => s.auth.requestId);
    cfg.store.markSettled(requestIds, txHash);

    return {
      txHash,
      requestIds,
      count: ready.length,
      grossAmount: ready.reduce((sum, s) => sum + BigInt(s.auth.amount), 0n),
    };
  }

  async function submit(batch: PendingSettlement[]): Promise<Hex> {
    const shared = {
      address: cfg.escrow,
      abi: SLA_ESCROW_ABI,
      account: cfg.account,
      chain: cfg.wallet.chain,
      // Attribution rides on every settlement we send.
      ...(dataSuffix ? { dataSuffix } : {}),
      ...(cfg.feeCurrency ? { feeCurrency: cfg.feeCurrency } : {}),
    } as const;

    if (batch.length === 1) {
      const s = batch[0]!;
      return cfg.wallet.writeContract({
        ...shared,
        functionName: "redeemWithAck",
        args: [s.auth, s.authSig, s.receipt, s.receiptSig, s.ackSig!],
      });
    }

    return cfg.wallet.writeContract({
      ...shared,
      functionName: "batchRedeemWithAck",
      args: [
        batch.map((s) => s.auth),
        batch.map((s) => s.authSig),
        batch.map((s) => s.receipt),
        batch.map((s) => s.receiptSig),
        batch.map((s) => s.ackSig!),
      ],
    });
  }

  /** Settle on an interval. Returns a stop function. */
  function start(intervalMs = 15_000, onSettled?: (r: SettlementResult) => void) {
    const timer = setInterval(async () => {
      try {
        const result = await settleOnce();
        if (result && onSettled) onSettled(result);
      } catch (err) {
        console.error("[settler] settlement failed:", err);
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }

  /**
   * Decodes the attribution actually recorded on a settlement.
   *
   * Run this against your first transaction. Checking once, early, is the
   * difference between a wiring mistake costing one transaction and costing the
   * whole event.
   */
  function verifyAttribution(txHash: Hex): Promise<AttributionCheck> {
    return checkTxAttribution({
      client: cfg.publicClient,
      hash: txHash,
      expect: codes,
    });
  }

  return { settleOnce, start, verifyAttribution, dataSuffix, attributionCodes: codes };
}
