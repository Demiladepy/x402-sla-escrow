import { keccak256, toBytes, type Address, type Hex } from "viem";

/**
 * Wire format for SLA-escrowed x402.
 *
 * Two headers carry the whole protocol:
 *
 *   X-PAYMENT          buyer -> seller   base64(JSON({ auth, signature }))
 *   X-PAYMENT-RECEIPT  seller -> buyer   base64(JSON({ receipt, signature }))
 *
 * The ack that unlocks the cooperative fast path is posted back separately to
 * the seller's /x402/ack route, because it can only be produced after the buyer
 * has seen the response body.
 */

export const PAYMENT_HEADER = "x-payment";
export const RECEIPT_HEADER = "x-payment-receipt";
export const ACK_PATH = "/x402/ack";

export interface PaymentAuth {
  buyer: Address;
  endpointId: Hex;
  requestId: Hex;
  amount: bigint;
  requestedAtMs: bigint;
  deadline: bigint;
}

export interface ServiceReceipt {
  requestId: Hex;
  statusCode: number;
  servedAtMs: bigint;
  bodyHash: Hex;
}

export interface ReceiptAck {
  requestId: Hex;
  bodyHash: Hex;
}

/** Must match SLAEscrow's EIP712("SLAEscrow", "1") domain exactly. */
export function domain(escrow: Address, chainId: number) {
  return {
    name: "SLAEscrow",
    version: "1",
    chainId,
    verifyingContract: escrow,
  } as const;
}

export const EIP712_TYPES = {
  PaymentAuth: [
    { name: "buyer", type: "address" },
    { name: "endpointId", type: "bytes32" },
    { name: "requestId", type: "bytes32" },
    { name: "amount", type: "uint128" },
    { name: "requestedAtMs", type: "uint64" },
    { name: "deadline", type: "uint64" },
  ],
  ServiceReceipt: [
    { name: "requestId", type: "bytes32" },
    { name: "statusCode", type: "uint16" },
    { name: "servedAtMs", type: "uint64" },
    { name: "bodyHash", type: "bytes32" },
  ],
  ReceiptAck: [
    { name: "requestId", type: "bytes32" },
    { name: "bodyHash", type: "bytes32" },
  ],
} as const;

/**
 * The body commitment both sides sign over. Hashing the raw bytes rather than a
 * parsed object keeps it independent of JSON key ordering and whitespace, so
 * buyer and seller cannot disagree about what was delivered.
 */
export function hashBody(body: string | Uint8Array): Hex {
  return keccak256(typeof body === "string" ? toBytes(body) : body);
}

/** JSON with bigints, since auth/receipt fields are uint128/uint64 on-chain. */
function replacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? `${value}n` : value;
}

function reviver(_key: string, value: unknown) {
  if (typeof value === "string" && /^\d+n$/.test(value)) {
    return BigInt(value.slice(0, -1));
  }
  return value;
}

export function encodeHeader(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload, replacer), "utf8").toString("base64");
}

export function decodeHeader<T>(header: string): T {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"), reviver) as T;
}

export interface PaymentEnvelope {
  auth: PaymentAuth;
  signature: Hex;
}

export interface ReceiptEnvelope {
  receipt: ServiceReceipt;
  signature: Hex;
}

export interface AckEnvelope {
  requestId: Hex;
  bodyHash: Hex;
  signature: Hex;
}

/** The 402 body a seller returns when a request arrives without payment. */
export interface PaymentRequired {
  scheme: "sla-escrow";
  escrow: Address;
  chainId: number;
  endpointId: Hex;
  asset: Address;
  amount: string;
  sla: {
    maxLatencyMs: number;
    expectedStatus: number;
    schemaHash: Hex;
  };
}
