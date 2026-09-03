export interface LedgerRow {
  requestId: string;
  buyer: string;
  endpointId?: string;
  amount: string;
  requestedAtMs?: number;
  deadline?: number;
  statusCode: number;
  servedAtMs?: number;
  bodyHash?: string;
  latencyMs: number;
  acked: boolean;
  settledTxHash: string | null;
  servedAt: number;
  meta: { pair?: string; mode?: string } | null;
  verdict?: { ok: boolean; reason: string | null };
}

export interface State {
  escrow: string;
  asset: string;
  endpointId: string;
  seller: string;
  buyer: string;
  sla: { maxLatencyMs: number; expectedStatus: number; price: string };
  bond: string;
  deposited: string;
  buyerEscrowBalance: string;
  sellerEarned: string;
  buyerTxCount: number;
  buyerTxCountAfterSetup: number;
  /** Token decimals. Sepolia USDC is 6; mainnet cUSD is 18. */
  decimals?: number;
  tokenSymbol?: string;
}

export interface Settlement {
  txHash: string;
  calls: number;
  gasUsed: string;
  blockNumber: string;
  at: number;
}

/**
 * What the system reports about itself: the chain it is bound to, the invariant
 * it maintains, what settlement costs, and the attribution actually decoded
 * from calldata rather than the codes we intended to send.
 */
export interface System {
  chain: { chainId: number; blockNumber: string; rpc: string };
  contract: {
    escrow: string;
    asset: string;
    endpointId: string;
    seller: string;
    price: string;
    maxLatencyMs: number;
    expectedStatus: number;
    schemaHash: string;
    challengeWindowSec: string;
    active: boolean;
    bond: string;
  };
  solvency: {
    held: string;
    owed: string;
    ok: boolean;
    buyerBalance: string;
    sellerBalance: string;
  };
  settlement: {
    transactions: number;
    callsSettled: number;
    gasTotal: string;
    gasPerCall: number | null;
    amortisation: {
      size: number;
      batches: number;
      gasPerBatch: number;
      gasPerCall: number;
    }[];
    recent: Settlement[];
  };
  attribution: {
    codes: string[];
    verifiedCodes: string[] | null;
    verifiedTx: string | null;
    required: boolean;
  };
}
