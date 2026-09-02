export interface LedgerRow {
  requestId: string;
  buyer: string;
  amount: string;
  statusCode: number;
  latencyMs: number;
  acked: boolean;
  settledTxHash: string | null;
  servedAt: number;
  meta: { pair?: string; mode?: string } | null;
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
}
