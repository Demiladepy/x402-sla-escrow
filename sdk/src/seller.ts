import { recoverTypedDataAddress, type Account, type Address, type Hex } from "viem";
import {
  ACK_PATH,
  EIP712_TYPES,
  PAYMENT_HEADER,
  RECEIPT_HEADER,
  decodeHeader,
  domain,
  encodeHeader,
  hashBody,
  type AckEnvelope,
  type PaymentAuth,
  type PaymentEnvelope,
  type PaymentRequired,
  type ServiceReceipt,
} from "./protocol.js";

/** A call that has been served and is waiting to be settled on-chain. */
export interface PendingSettlement {
  auth: PaymentAuth;
  authSig: Hex;
  receipt: ServiceReceipt;
  receiptSig: Hex;
  /** Present once the buyer acknowledges. Without it, only the slow path works. */
  ackSig?: Hex;
  servedAt: number;
  settledTxHash?: Hex;
  /** Whatever `describe` returned for the request. Never signed over. */
  meta?: unknown;
}

export interface SettlementStore {
  put(s: PendingSettlement): void;
  ack(requestId: Hex, ackSig: Hex): PendingSettlement | undefined;
  /** Acked, not yet settled. */
  readyForFastPath(): PendingSettlement[];
  markSettled(requestIds: Hex[], txHash: Hex): void;
  all(): PendingSettlement[];
}

export function createMemoryStore(): SettlementStore {
  const byId = new Map<string, PendingSettlement>();
  return {
    put(s) {
      byId.set(s.auth.requestId.toLowerCase(), s);
    },
    ack(requestId, ackSig) {
      const s = byId.get(requestId.toLowerCase());
      if (s) s.ackSig = ackSig;
      return s;
    },
    readyForFastPath() {
      return [...byId.values()].filter((s) => s.ackSig && !s.settledTxHash);
    },
    markSettled(requestIds, txHash) {
      for (const id of requestIds) {
        const s = byId.get(id.toLowerCase());
        if (s) s.settledTxHash = txHash;
      }
    },
    all() {
      return [...byId.values()];
    },
  };
}

export interface SellerConfig {
  account: Account;
  escrow: Address;
  chainId: number;
  endpointId: Hex;
  asset: Address;
  price: bigint;
  maxLatencyMs: number;
  expectedStatus?: number;
  schemaHash: Hex;
  store: SettlementStore;
  /**
   * Optional label attached to the stored settlement for dashboards and logs.
   * Purely local bookkeeping — it is not part of the receipt and neither side
   * signs it.
   */
  describe?: (req: MinimalReq) => unknown;
}

type MinimalReq = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: unknown;
};

type MinimalRes = {
  status(code: number): MinimalRes;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  send(body: string): void;
};

export type Handler = (req: MinimalReq) => Promise<unknown> | unknown;

/**
 * Wraps a route so it only serves against a valid payment authorization, and
 * signs a receipt for what it served.
 *
 * The receipt is the seller's own attestation, and it is the only way to get
 * paid: SLAEscrow will not release funds for a receipt whose status or latency
 * misses the advertised SLA. Serving slowly is therefore serving for free.
 */
export function slaEndpoint(cfg: SellerConfig, handler: Handler) {
  const expectedStatus = cfg.expectedStatus ?? 200;

  const terms: PaymentRequired = {
    scheme: "sla-escrow",
    escrow: cfg.escrow,
    chainId: cfg.chainId,
    endpointId: cfg.endpointId,
    asset: cfg.asset,
    amount: cfg.price.toString(),
    sla: {
      maxLatencyMs: cfg.maxLatencyMs,
      expectedStatus,
      schemaHash: cfg.schemaHash,
    },
  };

  return async function handle(req: MinimalReq, res: MinimalRes): Promise<void> {
    const header = req.headers[PAYMENT_HEADER];
    if (!header || typeof header !== "string") {
      res.status(402).json(terms);
      return;
    }

    let envelope: PaymentEnvelope;
    try {
      envelope = decodeHeader<PaymentEnvelope>(header);
    } catch {
      res.status(400).json({ error: "malformed X-PAYMENT header" });
      return;
    }

    const { auth, signature } = envelope;

    const recovered = await recoverTypedDataAddress({
      domain: domain(cfg.escrow, cfg.chainId),
      types: EIP712_TYPES,
      primaryType: "PaymentAuth",
      message: auth,
      signature,
    });
    if (recovered.toLowerCase() !== auth.buyer.toLowerCase()) {
      res.status(401).json({ error: "authorization not signed by the stated buyer" });
      return;
    }

    // Terms the chain will re-check at redemption. Refusing here rather than
    // serving for nothing.
    if (auth.endpointId.toLowerCase() !== cfg.endpointId.toLowerCase()) {
      res.status(400).json({ error: "authorization is for a different endpoint" });
      return;
    }
    if (BigInt(auth.amount) !== cfg.price) {
      res.status(400).json({ error: `expected ${cfg.price}, authorized ${auth.amount}` });
      return;
    }
    if (BigInt(auth.deadline) < BigInt(Math.floor(Date.now() / 1000))) {
      res.status(400).json({ error: "authorization expired" });
      return;
    }

    // A buyer that backdates requestedAtMs would burn our latency budget before
    // we ever saw the request, so treat a stale clock as unservable.
    const skew = Date.now() - Number(auth.requestedAtMs);
    if (skew > cfg.maxLatencyMs) {
      res.status(400).json({ error: `stale authorization: ${skew}ms of budget already spent` });
      return;
    }

    let payload: unknown;
    let statusCode = expectedStatus;
    try {
      payload = await handler(req);
    } catch (err) {
      statusCode = 500;
      payload = { error: err instanceof Error ? err.message : "handler failed" };
    }

    const body = JSON.stringify(payload);
    const receipt: ServiceReceipt = {
      requestId: auth.requestId,
      statusCode,
      servedAtMs: BigInt(Date.now()),
      bodyHash: hashBody(body),
    };

    const receiptSig = await cfg.account.signTypedData!({
      domain: domain(cfg.escrow, cfg.chainId),
      types: EIP712_TYPES,
      primaryType: "ServiceReceipt",
      message: receipt,
    });

    cfg.store.put({
      auth,
      authSig: signature,
      receipt,
      receiptSig,
      servedAt: Date.now(),
      meta: cfg.describe?.(req),
    });

    res.setHeader(RECEIPT_HEADER, encodeHeader({ receipt, signature: receiptSig }));
    res.setHeader("content-type", "application/json");
    res.status(statusCode).send(body);
  };
}

/**
 * Route that receives buyer acknowledgements. Mount at ACK_PATH.
 */
export function ackHandler(cfg: Pick<SellerConfig, "escrow" | "chainId" | "store">) {
  return async function handle(req: MinimalReq, res: MinimalRes): Promise<void> {
    const ack = req.body as AckEnvelope;
    if (!ack?.requestId || !ack?.signature) {
      res.status(400).json({ error: "malformed ack" });
      return;
    }

    const pending = cfg.store.all().find(
      (s) => s.auth.requestId.toLowerCase() === ack.requestId.toLowerCase(),
    );
    if (!pending) {
      res.status(404).json({ error: "unknown requestId" });
      return;
    }

    const recovered = await recoverTypedDataAddress({
      domain: domain(cfg.escrow, cfg.chainId),
      types: EIP712_TYPES,
      primaryType: "ReceiptAck",
      message: { requestId: ack.requestId, bodyHash: ack.bodyHash },
      signature: ack.signature,
    });

    if (recovered.toLowerCase() !== pending.auth.buyer.toLowerCase()) {
      res.status(401).json({ error: "ack not signed by the buyer" });
      return;
    }
    if (ack.bodyHash.toLowerCase() !== pending.receipt.bodyHash.toLowerCase()) {
      res.status(400).json({ error: "ack is for a different body" });
      return;
    }

    cfg.store.ack(ack.requestId, ack.signature);
    res.status(200).json({ ok: true });
  };
}

export { ACK_PATH };
