import type { Account, Address, Hex, PublicClient, WalletClient } from "viem";
import { SLA_ESCROW_ABI } from "./abi.js";
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
   * Celo attribution tag, appended to calldata as an ERC-8021 data suffix.
   *
   * This MUST be present on the very first transaction. The tag lives in the
   * calldata, so it cannot be added to a transaction after it is sent and there
   * is no backfill — anything settled without it is permanently uncounted for
   * the hackathon leaderboards.
   *
   * Produce it with Celo's helper rather than hand-rolling the encoding, e.g.
   * `toDataSuffix(['your_own_code', 'celo_yourAssignedTag'])`, and verify the
   * first settlement with `verifyTx` before letting the agent run unattended.
   */
  dataSuffix?: Hex;
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
      ...(cfg.dataSuffix ? { dataSuffix: cfg.dataSuffix } : {}),
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
   * Confirms the attribution tag actually landed in a settlement's calldata.
   * Run this against your first transaction — checking once, early, is the
   * difference between a wiring mistake costing one transaction and costing the
   * whole event.
   */
  async function verifyAttribution(txHash: Hex): Promise<{ present: boolean; calldata: Hex }> {
    const tx = await cfg.publicClient.getTransaction({ hash: txHash });
    const calldata = tx.input;
    const suffix = cfg.dataSuffix;
    return {
      present: Boolean(suffix) && calldata.toLowerCase().endsWith(suffix!.slice(2).toLowerCase()),
      calldata,
    };
  }

  return { settleOnce, start, verifyAttribution };
}
