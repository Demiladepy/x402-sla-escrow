import { createServer, type Server } from "node:http";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import {
  SLA_ESCROW_ABI,
  attributionCodesFromEnv,
  createBuyerClient,
  createSettler,
} from "@x402sla/sdk";
import { RPC_URL, buyer, deploy, publicClient, seller, walletFor } from "./chain.js";
import { SCHEMA_HASH, createSellerApp } from "./seller-app.js";

/**
 * Long-running demo: stands the whole system up and then keeps an agent calling
 * the endpoint so the dashboard has live traffic to show.
 *
 * `run.ts` is the scripted three-call walkthrough. This is the one to leave
 * running behind the web dashboard.
 */

const PORT = 4021;
const BASE = `http://127.0.0.1:${PORT}`;
const PRICE = parseUnits("0.001", 18);
const MAX_LATENCY_MS = 800;
const BOND = PRICE * 200n;
const DEPOSIT = parseUnits("50", 18);
const CALL_INTERVAL_MS = 3_000;
const SETTLE_INTERVAL_MS = 12_000;

const ERC20 = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * One settlement, with what it actually cost.
 *
 * Gas is recorded per transaction rather than estimated per call, because the
 * amortisation claim — many calls, one transaction — is only worth making if
 * the real number backs it.
 */
interface Settlement {
  txHash: Hex;
  calls: number;
  gasUsed: string;
  blockNumber: string;
  at: number;
}

const PAIRS = ["CUSD/NGN", "CUSD/KES", "CUSD/GHS"];

/**
 * Claims the port before any on-chain work happens.
 *
 * Setup deposits buyer funds and posts the seller's bond, and it used to run
 * before `app.listen`. A second instance started against the same chain would
 * therefore spend money and only then discover the port was taken — harmless on
 * anvil, but a duplicated deposit and bond on a real network.
 */
function reservePort(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(
        err.code === "EADDRINUSE"
          ? new Error(`port ${port} is already serving. Stop that instance first.`)
          : err,
      );
    });
    server.once("listening", () => resolve(server));
    server.listen(port);
  });
}

async function main() {
  const reserved = await reservePort(PORT);

  await publicClient.getBlockNumber().catch(() => {
    throw new Error(`no chain at the RPC url. Start one with: anvil`);
  });

  const token = await deploy("MockERC20", []);
  const escrow = await deploy("SLAEscrow", [token.address, seller.address]);
  const chainId = await publicClient.getChainId();
  const sellerWallet = walletFor(seller);
  const buyerWallet = walletFor(buyer);

  for (const who of [seller.address, buyer.address]) {
    const hash = await sellerWallet.writeContract({
      address: token.address,
      abi: ERC20,
      functionName: "mint",
      args: [who, parseUnits("10000", 18)],
      account: seller,
      chain: null,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  let hash = await sellerWallet.writeContract({
    address: token.address,
    abi: ERC20,
    functionName: "approve",
    args: [escrow.address, BOND * 10n],
    account: seller,
    chain: null,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  const registerArgs = [PRICE, MAX_LATENCY_MS, 200, SCHEMA_HASH, 3600n, BOND] as const;
  const { result: endpointId } = await publicClient.simulateContract({
    address: escrow.address,
    abi: SLA_ESCROW_ABI,
    functionName: "registerEndpoint",
    args: registerArgs as never,
    account: seller,
  });
  hash = await sellerWallet.writeContract({
    address: escrow.address,
    abi: SLA_ESCROW_ABI,
    functionName: "registerEndpoint",
    args: registerArgs as never,
    account: seller,
    chain: null,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  hash = await buyerWallet.writeContract({
    address: token.address,
    abi: ERC20,
    functionName: "approve",
    args: [escrow.address, DEPOSIT],
    account: buyer,
    chain: null,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  hash = await buyerWallet.writeContract({
    address: escrow.address,
    abi: SLA_ESCROW_ABI,
    functionName: "deposit",
    args: [DEPOSIT],
    account: buyer,
    chain: null,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  const buyerNonceAfterSetup = await publicClient.getTransactionCount({ address: buyer.address });

  const { app, store } = createSellerApp({
    escrow: escrow.address,
    chainId,
    endpointId: endpointId as Hex,
    asset: token.address,
    price: PRICE,
    maxLatencyMs: MAX_LATENCY_MS,
    port: PORT,
  });

  const settlements: Settlement[] = [];
  let attributionVerified: { codes: string[]; txHash: Hex } | null = null;

  const settler = createSettler({
    wallet: sellerWallet,
    publicClient,
    account: seller,
    escrow: escrow.address,
    store,
    attributionCodes: attributionCodesFromEnv(),
    feeCurrency: process.env.FEE_CURRENCY as Address | undefined,
  });

  // State the dashboard needs, so the browser never has to reach the chain.
  app.get("/api/state", async (_req, res) => {
    const [buyerBal, sellerBal, nonce] = await Promise.all([
      publicClient.readContract({
        address: escrow.address,
        abi: SLA_ESCROW_ABI,
        functionName: "buyerBalance",
        args: [buyer.address as Address],
      }),
      publicClient.readContract({
        address: escrow.address,
        abi: SLA_ESCROW_ABI,
        functionName: "sellerBalance",
        args: [seller.address as Address],
      }),
      publicClient.getTransactionCount({ address: buyer.address }),
    ]);

    res.json({
      escrow: escrow.address,
      asset: token.address,
      endpointId,
      seller: seller.address,
      buyer: buyer.address,
      sla: { maxLatencyMs: MAX_LATENCY_MS, expectedStatus: 200, price: PRICE.toString() },
      bond: BOND.toString(),
      deposited: DEPOSIT.toString(),
      buyerEscrowBalance: (buyerBal as bigint).toString(),
      sellerEarned: (sellerBal as bigint).toString(),
      buyerTxCount: nonce,
      buyerTxCountAfterSetup: buyerNonceAfterSetup,
    });
  });

  /**
   * The system describing itself: what it is bound to, what it holds against
   * what it owes, and what settlement actually costs.
   *
   * Separate from /api/state because this is the part that does not change
   * call-to-call, and it is read from the chain and from transaction receipts
   * rather than from the seller's own bookkeeping.
   */
  app.get("/api/system", async (_req, res) => {
    const [blockNumber, endpoint, held, buyerBal, sellerBal] = await Promise.all([
      publicClient.getBlockNumber(),
      publicClient.readContract({
        address: escrow.address,
        abi: SLA_ESCROW_ABI,
        functionName: "endpoints",
        args: [endpointId as Hex],
      }) as Promise<readonly [Address, bigint, number, number, Hex, bigint, boolean]>,
      publicClient.readContract({
        address: token.address,
        abi: ERC20,
        functionName: "balanceOf",
        args: [escrow.address],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: escrow.address,
        abi: SLA_ESCROW_ABI,
        functionName: "buyerBalance",
        args: [buyer.address as Address],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: escrow.address,
        abi: SLA_ESCROW_ABI,
        functionName: "sellerBalance",
        args: [seller.address as Address],
      }) as Promise<bigint>,
    ]);

    // The invariant the contract test asserts, recomputed live: the escrow must
    // hold at least every balance it is on the hook for, bond included.
    const owed = buyerBal + sellerBal + BOND;

    const callsSettled = settlements.reduce((n, s) => n + s.calls, 0);
    const gasTotal = settlements.reduce((n, s) => n + BigInt(s.gasUsed), 0n);

    // Gas grouped by how many calls the transaction carried. This is the
    // amortisation claim measured rather than asserted: a fixed per-transaction
    // overhead spread across more calls should show up as a falling per-call
    // cost, and if it does not, the claim was wrong.
    const bySize = new Map<number, { batches: number; gas: bigint }>();
    for (const s of settlements) {
      const seen = bySize.get(s.calls) ?? { batches: 0, gas: 0n };
      seen.batches += 1;
      seen.gas += BigInt(s.gasUsed);
      bySize.set(s.calls, seen);
    }
    const amortisation = [...bySize.entries()]
      .sort(([a], [b]) => a - b)
      .map(([size, agg]) => ({
        size,
        batches: agg.batches,
        gasPerBatch: Number(agg.gas / BigInt(agg.batches)),
        gasPerCall: Number(agg.gas / BigInt(agg.batches * size)),
      }));

    res.json({
      chain: { chainId, blockNumber: blockNumber.toString(), rpc: RPC_URL },
      contract: {
        escrow: escrow.address,
        asset: token.address,
        endpointId,
        seller: endpoint[0],
        price: endpoint[1].toString(),
        maxLatencyMs: endpoint[2],
        expectedStatus: endpoint[3],
        schemaHash: endpoint[4],
        challengeWindowSec: endpoint[5].toString(),
        active: endpoint[6],
        bond: BOND.toString(),
      },
      solvency: {
        held: held.toString(),
        owed: owed.toString(),
        ok: held >= owed,
        buyerBalance: buyerBal.toString(),
        sellerBalance: sellerBal.toString(),
      },
      settlement: {
        transactions: settlements.length,
        callsSettled,
        gasTotal: gasTotal.toString(),
        gasPerCall: callsSettled > 0 ? Number(gasTotal / BigInt(callsSettled)) : null,
        amortisation,
        recent: settlements.slice(-12).reverse(),
      },
      attribution: {
        codes: settler.attributionCodes,
        // Decoded from calldata, so this reports what an indexer would read
        // rather than what we intended to send.
        verifiedCodes: attributionVerified?.codes ?? null,
        verifiedTx: attributionVerified?.txHash ?? null,
        required: chainId === 42220,
      },
    });
  });

  await new Promise<void>((resolve) => reserved.close(() => resolve()));

  app.listen(PORT, () => {
    console.log(`seller listening on ${BASE}`);
    console.log(`escrow ${escrow.address}  endpoint ${endpointId}`);
    console.log(`dashboard: npm run dev --workspace web`);
  });

  const client = createBuyerClient({ account: buyer, escrow: escrow.address, chainId });
  const terms = await client.discover(`${BASE}/api/rate`);

  settler.start(SETTLE_INTERVAL_MS, async (r) => {
    console.log(`settled ${r.count} call(s) for ${formatUnits(r.grossAmount, 18)} cUSD  ${r.txHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: r.txHash });
    settlements.push({
      txHash: r.txHash,
      calls: r.count,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber.toString(),
      at: Date.now(),
    });

    // Verified on the first settlement only: if the tag is wrong we want to
    // know at call one, not after a night of unattributed traffic.
    if (attributionVerified === null && settler.attributionCodes.length > 0) {
      const attr = await settler.verifyAttribution(r.txHash);
      if (attr.ok) {
        attributionVerified = { codes: attr.codes, txHash: r.txHash };
        console.log(`attribution verified on-chain: ${attr.codes.join(", ")}`);
      } else {
        console.error(`ATTRIBUTION MISSING from ${r.txHash} — expected ${attr.missing.join(", ")}`);
      }
    }
  });

  // A buyer agent that keeps working. Roughly one call in four hits a degraded
  // endpoint, which is what makes the ledger worth looking at.
  setInterval(async () => {
    const pair = PAIRS[Math.floor(Math.random() * PAIRS.length)]!;
    const roll = Math.random();
    const mode = roll < 0.15 ? "slow" : roll < 0.25 ? "broken" : undefined;
    const url = `${BASE}/api/rate?pair=${encodeURIComponent(pair)}${mode ? `&mode=${mode}` : ""}`;

    try {
      const res = await client.call(url, { terms });
      const verdict = res.verdict.ok ? "SLA met" : res.verdict.detail;
      console.log(`${res.paid ? "paid    " : "not paid"}  ${pair}  ${res.observedLatencyMs}ms  ${verdict}`);
    } catch (err) {
      console.error("call failed:", err instanceof Error ? err.message : err);
    }
  }, CALL_INTERVAL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
