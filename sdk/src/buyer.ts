import { toHex, type Account, type Address, type Hex } from "viem";
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
  type ReceiptEnvelope,
} from "./protocol.js";

export interface BuyerClientConfig {
  /** The agent's wallet. Signs authorizations; never sends a transaction. */
  account: Account;
  escrow: Address;
  chainId: number;
  /** How long an authorization stays valid. Short is safer. */
  authTtlSeconds?: number;
  /** Extra slack over the advertised budget before we call it a breach. */
  latencyToleranceMs?: number;
}

export type SlaVerdict =
  | { ok: true }
  | { ok: false; reason: "status" | "latency" | "body-mismatch" | "no-receipt"; detail: string };

export interface SlaResponse<T = unknown> {
  /** Parsed response body, present whether or not the SLA held. */
  data: T;
  raw: string;
  status: number;
  /** What the buyer's own clock measured, end to end. */
  observedLatencyMs: number;
  /** What the seller signed. Undefined if it never sent a receipt. */
  claimedLatencyMs?: number;
  verdict: SlaVerdict;
  /** True when the buyer acked, which is what lets the seller get paid. */
  paid: boolean;
  requestId: Hex;
  price: bigint;
}

function randomRequestId(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * A drop-in `fetch` that pays per call.
 *
 * The buyer signs, the seller serves, and the buyer acknowledges only if the
 * response actually met the advertised SLA. Refusing to acknowledge is the
 * refund: without an ack the seller can only try the unilateral path, where the
 * contract re-checks status and latency and reverts on a breach.
 *
 * The agent's wallet signs but never transacts, so a call costs zero gas.
 */
export function createBuyerClient(cfg: BuyerClientConfig) {
  const authTtl = BigInt(cfg.authTtlSeconds ?? 300);
  const tolerance = cfg.latencyToleranceMs ?? 0;

  async function discover(url: string): Promise<PaymentRequired> {
    const probe = await fetch(url, { method: "GET" });
    if (probe.status !== 402) {
      throw new Error(
        `expected 402 Payment Required from ${url}, got ${probe.status}. ` +
          `Is this endpoint behind slaEndpoint()?`,
      );
    }
    return (await probe.json()) as PaymentRequired;
  }

  async function call<T = unknown>(
    url: string,
    init: RequestInit & { terms?: PaymentRequired } = {},
  ): Promise<SlaResponse<T>> {
    const terms = init.terms ?? (await discover(url));

    const requestId = randomRequestId();
    const requestedAtMs = BigInt(Date.now());
    const auth: PaymentAuth = {
      buyer: cfg.account.address,
      endpointId: terms.endpointId,
      requestId,
      amount: BigInt(terms.amount),
      requestedAtMs,
      deadline: BigInt(Math.floor(Date.now() / 1000)) + authTtl,
    };

    const signature = await cfg.account.signTypedData!({
      domain: domain(cfg.escrow, cfg.chainId),
      types: EIP712_TYPES,
      primaryType: "PaymentAuth",
      message: auth,
    });

    const envelope: PaymentEnvelope = { auth, signature };
    const started = Date.now();
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), [PAYMENT_HEADER]: encodeHeader(envelope) },
    });
    const observedLatencyMs = Date.now() - started;
    const raw = await res.text();

    const base = {
      raw,
      status: res.status,
      observedLatencyMs,
      requestId,
      price: auth.amount,
      data: safeJson<T>(raw),
    };

    const receiptHeader = res.headers.get(RECEIPT_HEADER);
    if (!receiptHeader) {
      return {
        ...base,
        verdict: { ok: false, reason: "no-receipt", detail: "seller returned no signed receipt" },
        paid: false,
      };
    }

    const { receipt } = decodeHeader<ReceiptEnvelope>(receiptHeader);
    const claimedLatencyMs = Number(receipt.servedAtMs - requestedAtMs);
    const verdict = judge({
      receipt,
      raw,
      terms,
      observedLatencyMs,
      claimedLatencyMs,
      tolerance,
    });

    if (!verdict.ok) {
      // No ack. This *is* the refund — the money never leaves the buyer's
      // escrow balance, and the on-chain checks block the unilateral path too.
      return { ...base, claimedLatencyMs, verdict, paid: false };
    }

    const ackSignature = await cfg.account.signTypedData!({
      domain: domain(cfg.escrow, cfg.chainId),
      types: EIP712_TYPES,
      primaryType: "ReceiptAck",
      message: { requestId, bodyHash: receipt.bodyHash },
    });

    const ack: AckEnvelope = { requestId, bodyHash: receipt.bodyHash, signature: ackSignature };
    await postAck(url, ack);

    return { ...base, claimedLatencyMs, verdict, paid: true };
  }

  return { call, discover };
}

function judge(args: {
  receipt: { statusCode: number; servedAtMs: bigint; bodyHash: Hex; requestId: Hex };
  raw: string;
  terms: PaymentRequired;
  observedLatencyMs: number;
  claimedLatencyMs: number;
  tolerance: number;
}): SlaVerdict {
  const { receipt, raw, terms, observedLatencyMs, claimedLatencyMs, tolerance } = args;

  // The receipt must actually commit to the bytes we received, or it is a
  // receipt for some other response.
  const actual = hashBody(raw);
  if (actual.toLowerCase() !== receipt.bodyHash.toLowerCase()) {
    return {
      ok: false,
      reason: "body-mismatch",
      detail: `receipt commits to ${receipt.bodyHash} but body hashes to ${actual}`,
    };
  }

  if (receipt.statusCode !== terms.sla.expectedStatus) {
    return {
      ok: false,
      reason: "status",
      detail: `expected HTTP ${terms.sla.expectedStatus}, served ${receipt.statusCode}`,
    };
  }

  const budget = terms.sla.maxLatencyMs + tolerance;

  // Two clocks have to agree. The seller's signed timestamp is what the chain
  // will check, but the buyer's own measurement is what stops a seller from
  // understating it — we refuse to acknowledge a receipt our own clock
  // contradicts, and an unacknowledged call cannot take the fast path.
  if (claimedLatencyMs > budget) {
    return {
      ok: false,
      reason: "latency",
      detail: `seller attested ${claimedLatencyMs}ms against a ${terms.sla.maxLatencyMs}ms budget`,
    };
  }
  if (observedLatencyMs > budget) {
    return {
      ok: false,
      reason: "latency",
      detail:
        `seller attested ${claimedLatencyMs}ms but we measured ${observedLatencyMs}ms ` +
        `against a ${terms.sla.maxLatencyMs}ms budget`,
    };
  }

  return { ok: true };
}

async function postAck(url: string, ack: AckEnvelope): Promise<void> {
  const target = new URL(url);
  target.pathname = ACK_PATH;
  target.search = "";
  await fetch(target.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ack),
  });
}

function safeJson<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}
