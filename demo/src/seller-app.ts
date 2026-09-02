import express from "express";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import {
  ACK_PATH,
  ackHandler,
  createMemoryStore,
  slaEndpoint,
  type SettlementStore,
} from "@x402sla/sdk";
import { seller } from "./chain.js";

/**
 * The seller side of the demo: an FX rate feed an agent would actually pay for.
 *
 * A price feed is the honest test case for this protocol — it is worth almost
 * nothing per call, and it is worthless if it arrives late. Exactly the shape
 * that per-call escrow has to serve without eating the margin in gas.
 */

/** The response shape buyers are promised, hashed into the endpoint's SLA. */
export const RATE_SCHEMA = JSON.stringify({
  type: "object",
  required: ["pair", "rate", "asOf"],
  properties: {
    pair: { type: "string" },
    rate: { type: "number" },
    asOf: { type: "integer" },
  },
});

export const SCHEMA_HASH: Hex = keccak256(toBytes(RATE_SCHEMA));

const RATES: Record<string, number> = {
  "CUSD/NGN": 1587.42,
  "CUSD/KES": 129.18,
  "CUSD/GHS": 15.63,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SellerAppConfig {
  escrow: Address;
  chainId: number;
  endpointId: Hex;
  asset: Address;
  price: bigint;
  maxLatencyMs: number;
  port: number;
}

export function createSellerApp(cfg: SellerAppConfig): {
  app: express.Express;
  store: SettlementStore;
} {
  const store = createMemoryStore();
  const app = express();
  app.use(express.json());

  const paid = slaEndpoint(
    {
      account: seller,
      escrow: cfg.escrow,
      chainId: cfg.chainId,
      endpointId: cfg.endpointId,
      asset: cfg.asset,
      price: cfg.price,
      maxLatencyMs: cfg.maxLatencyMs,
      expectedStatus: 200,
      schemaHash: SCHEMA_HASH,
      store,
    },
    async (req) => {
      const query = (req.query ?? {}) as Record<string, string>;
      const pair = (query.pair ?? "CUSD/NGN").toUpperCase();

      // Failure modes the demo drives deliberately, standing in for a degraded
      // upstream or an overloaded box.
      if (query.mode === "slow") await sleep(2500);
      if (query.mode === "broken") throw new Error("upstream rate provider unavailable");

      const rate = RATES[pair];
      if (rate === undefined) throw new Error(`unknown pair ${pair}`);

      return { pair, rate, asOf: Math.floor(Date.now() / 1000) };
    },
  );

  app.get("/api/rate", (req, res) => {
    void paid(req as never, res as never);
  });

  app.post(ACK_PATH, (req, res) => {
    void ackHandler({ escrow: cfg.escrow, chainId: cfg.chainId, store })(
      req as never,
      res as never,
    );
  });

  app.get("/api/ledger", (_req, res) => {
    res.json(
      store.all().map((s) => ({
        requestId: s.auth.requestId,
        buyer: s.auth.buyer,
        amount: s.auth.amount.toString(),
        statusCode: s.receipt.statusCode,
        latencyMs: Number(s.receipt.servedAtMs - s.auth.requestedAtMs),
        acked: Boolean(s.ackSig),
        settledTxHash: s.settledTxHash ?? null,
      })),
    );
  });

  return { app, store };
}
