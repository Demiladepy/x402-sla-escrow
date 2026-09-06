import { keccak256, recoverTypedDataAddress, toBytes, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { domain, EIP712_TYPES, RATES, TERMS } from "./terms.js";

/** Ephemeral. Signs receipts for this process only. Holds nothing. */
const seller = privateKeyToAccount(generatePrivateKey());

export type RateResult = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

type PaymentAuth = {
  buyer: Address;
  endpointId: Hex;
  requestId: Hex;
  amount: bigint;
  requestedAtMs: bigint;
  deadline: bigint;
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): RateResult {
  return {
    status,
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

function replacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? `${value}n` : value;
}

function reviver(_key: string, value: unknown) {
  if (typeof value === "string" && /^\d+n$/.test(value)) {
    return BigInt(value.slice(0, -1));
  }
  return value;
}

function encodeHeader(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload, replacer), "utf8").toString("base64");
}

function decodeHeader<T>(header: string): T {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"), reviver) as T;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Public seller for the Call playground. Same 402 / receipt wire as slaEndpoint.
 * Does not settle. The chain proof on the page is the Sepolia rehearsal.
 */
export async function serveRate(url: URL, paymentHeader: string | undefined): Promise<RateResult> {
  if (!paymentHeader) {
    return json(402, TERMS);
  }

  let envelope: { auth: PaymentAuth; signature: Hex };
  try {
    envelope = decodeHeader(paymentHeader);
  } catch {
    return json(400, { error: "malformed X-PAYMENT header" });
  }

  const { auth, signature } = envelope;
  const recovered = await recoverTypedDataAddress({
    domain: domain(),
    types: EIP712_TYPES,
    primaryType: "PaymentAuth",
    message: auth,
    signature,
  });
  if (recovered.toLowerCase() !== auth.buyer.toLowerCase()) {
    return json(401, { error: "authorization not signed by the stated buyer" });
  }
  if (auth.endpointId.toLowerCase() !== TERMS.endpointId.toLowerCase()) {
    return json(400, { error: "authorization is for a different endpoint" });
  }
  if (BigInt(auth.amount) !== BigInt(TERMS.amount)) {
    return json(400, { error: `expected ${TERMS.amount}, authorized ${auth.amount}` });
  }
  if (BigInt(auth.deadline) < BigInt(Math.floor(Date.now() / 1000))) {
    return json(400, { error: "authorization expired" });
  }
  const skew = Date.now() - Number(auth.requestedAtMs);
  if (skew > TERMS.sla.maxLatencyMs) {
    return json(400, { error: `stale authorization: ${skew}ms of budget already spent` });
  }

  const pair = (url.searchParams.get("pair") ?? "CUSD/NGN").toUpperCase();
  const mode = url.searchParams.get("mode") ?? "normal";

  let statusCode = 200;
  let payload: unknown;
  if (mode === "slow") await sleep(920);
  if (mode === "broken") {
    statusCode = 500;
    payload = { error: "upstream rate provider unavailable" };
  } else {
    const rate = RATES[pair];
    if (rate === undefined) {
      statusCode = 400;
      payload = { error: `unknown pair ${pair}` };
    } else {
      payload = { pair, rate, asOf: Math.floor(Date.now() / 1000) };
    }
  }

  const body = JSON.stringify(payload);
  const receipt = {
    requestId: auth.requestId,
    statusCode,
    servedAtMs: BigInt(Date.now()),
    bodyHash: keccak256(toBytes(body)),
  };
  const receiptSig = await seller.signTypedData({
    domain: domain(),
    types: EIP712_TYPES,
    primaryType: "ServiceReceipt",
    message: receipt,
  });

  return {
    status: statusCode,
    headers: {
      "content-type": "application/json",
      "x-payment-receipt": encodeHeader({ receipt, signature: receiptSig }),
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, x-payment",
      "access-control-expose-headers": "x-payment-receipt",
    },
    body,
  };
}
