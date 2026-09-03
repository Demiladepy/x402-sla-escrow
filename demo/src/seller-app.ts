import express from "express";
import { keccak256, toBytes, type Account, type Address, type Hex } from "viem";
import {
  ACK_PATH,
  ackHandler,
  createMemoryStore,
  slaEndpoint,
  type SettlementStore,
} from "@x402sla/sdk";
import { seller as localSeller } from "./chain.js";

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
  /** Defaults to the local anvil seller. Override on a real network. */
  account?: Account;
}

export function createSellerApp(cfg: SellerAppConfig): {
  app: express.Express;
  store: SettlementStore;
} {
  const store = createMemoryStore();
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, x-payment");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (_req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json());

  const paid = slaEndpoint(
    {
      account: cfg.account ?? localSeller,
      escrow: cfg.escrow,
      chainId: cfg.chainId,
      endpointId: cfg.endpointId,
      asset: cfg.asset,
      price: cfg.price,
      maxLatencyMs: cfg.maxLatencyMs,
      expectedStatus: 200,
      schemaHash: SCHEMA_HASH,
      store,
      describe: (req) => {
        const q = (req.query ?? {}) as Record<string, string>;
        return { pair: (q.pair ?? "CUSD/NGN").toUpperCase(), mode: q.mode ?? "normal" };
      },
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

  app.get("/api/catalog", (_req, res) => {
    res.json({
      name: "FX rate",
      pairs: Object.keys(RATES),
      price: cfg.price.toString(),
      maxLatencyMs: cfg.maxLatencyMs,
      expectedStatus: 200,
      path: "/api/rate",
    });
  });

  app.post(ACK_PATH, (req, res) => {
    void ackHandler({ escrow: cfg.escrow, chainId: cfg.chainId, store })(
      req as never,
      res as never,
    );
  });

  app.get("/api/ledger", (_req, res) => {
    res.json(
      store.all().map((s) => {
        const requestedAtMs = Number(s.auth.requestedAtMs);
        const servedAtMs = Number(s.receipt.servedAtMs);
        const latencyMs = servedAtMs - requestedAtMs;
        const overLatency = latencyMs > cfg.maxLatencyMs;
        const badStatus = s.receipt.statusCode !== 200;
        const ok = Boolean(s.ackSig);
        return {
          requestId: s.auth.requestId,
          buyer: s.auth.buyer,
          endpointId: s.auth.endpointId,
          amount: s.auth.amount.toString(),
          requestedAtMs,
          deadline: Number(s.auth.deadline),
          statusCode: s.receipt.statusCode,
          servedAtMs,
          bodyHash: s.receipt.bodyHash,
          latencyMs,
          acked: ok,
          settledTxHash: s.settledTxHash ?? null,
          servedAt: s.servedAt,
          meta: s.meta ?? null,
          verdict: {
            ok,
            reason: ok ? null : overLatency ? "latency" : badStatus ? `HTTP ${s.receipt.statusCode}` : "unacked",
          },
        };
      }),
    );
  });

  return { app, store };
}
