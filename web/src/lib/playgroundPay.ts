import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toHex, type Address, type Hex } from "viem";

const ESCROW = "0x0d58d053cbaf81e480205c7f942d3d065539abca" as Address;
const ENDPOINT =
  "0x1a51a9873f82ff773592810de912fcc2cd77234d0ee45fd508cead29cbf53125" as Hex;
const AMOUNT = 1000n;

const EIP712_TYPES = {
  PaymentAuth: [
    { name: "buyer", type: "address" },
    { name: "endpointId", type: "bytes32" },
    { name: "requestId", type: "bytes32" },
    { name: "amount", type: "uint128" },
    { name: "requestedAtMs", type: "uint64" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

function encodeHeader(payload: unknown): string {
  const json = JSON.stringify(payload, (_key, value) =>
    typeof value === "bigint" ? `${value}n` : value,
  );
  return btoa(json);
}

let buyer: ReturnType<typeof privateKeyToAccount> | null = null;

function playgroundBuyer() {
  if (!buyer) buyer = privateKeyToAccount(generatePrivateKey());
  return buyer;
}

export interface PaymentRequired {
  scheme: string;
  amount: string;
  sla: { maxLatencyMs: number; expectedStatus: number };
}

export async function signPayment(): Promise<{ header: string; requestId: Hex; buyer: Address }> {
  const account = playgroundBuyer();
  const requestId = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const auth = {
    buyer: account.address,
    endpointId: ENDPOINT,
    requestId,
    amount: AMOUNT,
    requestedAtMs: BigInt(Date.now()),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
  };
  const signature = await account.signTypedData({
    domain: {
      name: "SLAEscrow",
      version: "1",
      chainId: 11142220,
      verifyingContract: ESCROW,
    },
    types: EIP712_TYPES,
    primaryType: "PaymentAuth",
    message: auth,
  });
  return { header: encodeHeader({ auth, signature }), requestId, buyer: account.address };
}
