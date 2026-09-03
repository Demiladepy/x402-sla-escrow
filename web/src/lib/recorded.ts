import type { LedgerRow, State, System } from "./types";

/**
 * Celo Sepolia dress rehearsal, read back from chain 11142220.
 *
 * Healthy call and settlement come from redeemWithAck
 * 0x6ddd02e0d5762b82769d1f476d75bd7f9edd2d8c76e771ba875834f1c9da8794
 * (block 35105116, gas 207039, Settled latencyMs=21, fastPath=true).
 *
 * The unpaid breach was never redeemed, so it has no on-chain id. The request
 * id below is keccak256("sepolia-rehearsal:unpaid-breach"), used only so the
 * #breach scene has a row to pin. Do not treat it as a transaction.
 */
export const SEPOLIA_SETTLE_TX =
  "0x6ddd02e0d5762b82769d1f476d75bd7f9edd2d8c76e771ba875834f1c9da8794";

export const SEPOLIA_ESCROW = "0x0d58d053cbaf81e480205c7f942d3d065539abca";

const AGENT = "0x922184A4702f0DF95fB86C3879BC3eD935b75721";
const USDC = "0x01C5C0122039549AD1493B8220cABEdD739BC44E";
const ENDPOINT = "0x1a51a9873f82ff773592810de912fcc2cd77234d0ee45fd508cead29cbf53125";
const SCHEMA = "0xff3f0a86d48fcd9eb703c632716363d6a4b1c2b5e239357b54d88ebdf65f24ed";
const HEALTHY_ID = "0x1f254f8bb4f6fcc81ee4085f205097734fb752ece7d14eb69e05563997e38be6";
const BREACH_ID = "0x09380e89413a50da0558741757660aacef14f01339e600cdaaa3cf68cec4f369";
const BODY_HASH = "0x4f85e4c98db98718173526d4ed29758da72ae4d3afe8d7201f5275f99871d03a";

const PRICE = "1000";
const BOND = "200000";
const DEPOSIT = "50000";

export const RECORDED_STATE: State = {
  escrow: SEPOLIA_ESCROW,
  asset: USDC,
  endpointId: ENDPOINT,
  seller: AGENT,
  buyer: AGENT,
  sla: { maxLatencyMs: 800, expectedStatus: 200, price: PRICE },
  bond: BOND,
  deposited: DEPOSIT,
  buyerEscrowBalance: "49000",
  sellerEarned: "1000",
  buyerTxCount: 5,
  buyerTxCountAfterSetup: 5,
  decimals: 6,
  tokenSymbol: "USDC",
};

export const RECORDED_ROWS: LedgerRow[] = [
  {
    requestId: HEALTHY_ID,
    buyer: AGENT,
    endpointId: ENDPOINT,
    amount: PRICE,
    requestedAtMs: 1788389101254,
    deadline: 1788389401,
    statusCode: 200,
    servedAtMs: 1788389101275,
    bodyHash: BODY_HASH,
    latencyMs: 21,
    acked: true,
    settledTxHash: SEPOLIA_SETTLE_TX,
    servedAt: 1788389101275,
    meta: { pair: "CUSD/NGN", mode: "normal" },
    verdict: { ok: true, reason: null },
  },
  {
    requestId: BREACH_ID,
    buyer: AGENT,
    endpointId: ENDPOINT,
    amount: PRICE,
    requestedAtMs: 1788389103400,
    deadline: 1788389701,
    statusCode: 500,
    servedAtMs: 1788389103488,
    bodyHash: "",
    latencyMs: 88,
    acked: false,
    settledTxHash: null,
    servedAt: 1788389103488,
    meta: { pair: "CUSD/NGN", mode: "broken" },
    verdict: { ok: false, reason: "HTTP 500" },
  },
];

export const RECORDED_SYSTEM: System = {
  chain: {
    chainId: 11142220,
    blockNumber: "35105116",
    rpc: "https://forno.celo-sepolia.celo-testnet.org",
  },
  contract: {
    escrow: SEPOLIA_ESCROW,
    asset: USDC,
    endpointId: ENDPOINT,
    seller: AGENT,
    price: PRICE,
    maxLatencyMs: 800,
    expectedStatus: 200,
    schemaHash: SCHEMA,
    challengeWindowSec: "3600",
    active: true,
    bond: BOND,
  },
  solvency: {
    held: "250000",
    owed: "250000",
    ok: true,
    buyerBalance: "49000",
    sellerBalance: "1000",
  },
  settlement: {
    transactions: 1,
    callsSettled: 1,
    gasTotal: "207039",
    gasPerCall: 207039,
    amortisation: [{ size: 1, batches: 1, gasPerBatch: 207039, gasPerCall: 207039 }],
    recent: [
      {
        txHash: SEPOLIA_SETTLE_TX,
        calls: 1,
        gasUsed: "207039",
        blockNumber: "35105116",
        at: 1788389101275,
      },
    ],
  },
  attribution: {
    codes: ["x402_sla", "celo_5ffb6e9c75fb"],
    verifiedCodes: ["x402_sla", "celo_5ffb6e9c75fb"],
    verifiedTx: SEPOLIA_SETTLE_TX,
    required: false,
  },
};
