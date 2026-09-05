import type { Address, Hex } from "viem";

/** Same escrow and SLA the Sepolia rehearsal already settled against. */
export const TERMS = {
  scheme: "sla-escrow" as const,
  escrow: "0x0d58d053cbaf81e480205c7f942d3d065539abca" as Address,
  chainId: 11142220,
  endpointId: "0x1a51a9873f82ff773592810de912fcc2cd77234d0ee45fd508cead29cbf53125" as Hex,
  asset: "0x01C5C0122039549AD1493B8220cABEdD739BC44E" as Address,
  amount: "1000",
  sla: {
    maxLatencyMs: 800,
    expectedStatus: 200,
    schemaHash: "0xff3f0a86d48fcd9eb703c632716363d6a4b1c2b5e239357b54d88ebdf65f24ed" as Hex,
  },
};

export const RATES: Record<string, number> = {
  "CUSD/NGN": 1587.42,
  "CUSD/KES": 129.18,
  "CUSD/GHS": 15.63,
};

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
} as const;

export function domain() {
  return {
    name: "SLAEscrow",
    version: "1",
    chainId: TERMS.chainId,
    verifyingContract: TERMS.escrow,
  } as const;
}
