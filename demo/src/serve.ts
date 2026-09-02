import { createServer, type Server } from "node:http";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { SLA_ESCROW_ABI, createBuyerClient, createSettler } from "@x402sla/sdk";
import { buyer, deploy, publicClient, seller, walletFor } from "./chain.js";
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
] as const;

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

  await new Promise<void>((resolve) => reserved.close(() => resolve()));

  app.listen(PORT, () => {
    console.log(`seller listening on ${BASE}`);
    console.log(`escrow ${escrow.address}  endpoint ${endpointId}`);
    console.log(`dashboard: npm run dev --workspace web`);
  });

  const client = createBuyerClient({ account: buyer, escrow: escrow.address, chainId });
  const terms = await client.discover(`${BASE}/api/rate`);

  const settler = createSettler({
    wallet: sellerWallet,
    publicClient,
    account: seller,
    escrow: escrow.address,
    store,
  });
  settler.start(SETTLE_INTERVAL_MS, (r) =>
    console.log(`settled ${r.count} call(s) for ${formatUnits(r.grossAmount, 18)} cUSD  ${r.txHash}`),
  );

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
