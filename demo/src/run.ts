import { spawn, type ChildProcess } from "node:child_process";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import {
  SLA_ESCROW_ABI,
  createBuyerClient,
  createSettler,
  type SlaResponse,
} from "@x402sla/sdk";
import { RPC_URL, buyer, deploy, publicClient, seller, walletFor } from "./chain.js";
import { createSellerApp } from "./seller-app.js";

const PORT = 4021;
const BASE = `http://127.0.0.1:${PORT}`;
const PRICE = parseUnits("0.001", 18); // a tenth of a cent per call
const MAX_LATENCY_MS = 800;
const BOND = PRICE * 200n;
const DEPOSIT = parseUnits("5", 18);

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

const money = (v: bigint) => `${formatUnits(v, 18)} cUSD`;
const rule = (s: string) => console.log(`\n${"─".repeat(72)}\n${s}\n${"─".repeat(72)}`);

async function anvilReachable(): Promise<boolean> {
  try {
    await publicClient.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

async function ensureAnvil(): Promise<ChildProcess | undefined> {
  if (await anvilReachable()) {
    console.log(`• using the chain already at ${RPC_URL}`);
    return undefined;
  }
  console.log("• starting anvil");
  const proc = spawn("anvil", ["--silent"], { stdio: "ignore", shell: true });
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await anvilReachable()) return proc;
  }
  proc.kill();
  throw new Error("anvil did not come up — is Foundry installed?");
}

async function main() {
  const anvil = await ensureAnvil();
  const cleanup = () => anvil?.kill();
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  rule("1. Deploy");

  const token = await deploy("MockERC20", []);
  const escrow = await deploy("SLAEscrow", [token.address, seller.address]);
  console.log(`  settlement asset  ${token.address}`);
  console.log(`  SLAEscrow         ${escrow.address}`);

  const chainId = await publicClient.getChainId();
  const sellerWallet = walletFor(seller);
  const buyerWallet = walletFor(buyer);

  // Fund both sides.
  for (const who of [seller.address, buyer.address]) {
    const hash = await walletFor(seller).writeContract({
      address: token.address,
      abi: ERC20,
      functionName: "mint",
      args: [who, parseUnits("1000", 18)],
      account: seller,
      chain: null,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  rule("2. Seller advertises an SLA and bonds it");

  const { SCHEMA_HASH } = await import("./seller-app.js");

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

  console.log(`  endpoint     ${endpointId as Hex}`);
  console.log(`  price        ${money(PRICE)} per call`);
  console.log(`  latency SLA  ${MAX_LATENCY_MS}ms, HTTP 200`);
  console.log(`  bond posted  ${money(BOND)}  (200x the call price)`);

  rule("3. Buyer deposits once — and never sends another transaction");

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

  const nonceAfterDeposit = await publicClient.getTransactionCount({ address: buyer.address });
  console.log(`  deposited    ${money(DEPOSIT)}`);
  console.log(`  buyer nonce  ${nonceAfterDeposit}  <- watch this number`);

  // Serve.
  const { app, store } = createSellerApp({
    escrow: escrow.address,
    chainId,
    endpointId: endpointId as Hex,
    asset: token.address,
    price: PRICE,
    maxLatencyMs: MAX_LATENCY_MS,
    port: PORT,
  });
  const server = app.listen(PORT);
  await new Promise((r) => server.once("listening", r));

  rule("4. The agent makes three calls");

  const client = createBuyerClient({
    account: buyer,
    escrow: escrow.address,
    chainId,
  });

  const terms = await client.discover(`${BASE}/api/rate`);

  const cases: Array<{ label: string; url: string }> = [
    { label: "healthy response", url: `${BASE}/api/rate?pair=CUSD/NGN` },
    { label: "seller is slow", url: `${BASE}/api/rate?pair=CUSD/KES&mode=slow` },
    { label: "seller is broken", url: `${BASE}/api/rate?pair=CUSD/GHS&mode=broken` },
  ];

  const results: SlaResponse[] = [];
  for (const c of cases) {
    const res = await client.call(c.url, { terms });
    results.push(res);
    const mark = res.paid ? "PAID" : "NOT PAID";
    console.log(`\n  ${c.label}`);
    console.log(`    HTTP ${res.status} in ${res.observedLatencyMs}ms` +
      (res.claimedLatencyMs !== undefined ? ` (seller attested ${res.claimedLatencyMs}ms)` : ""));
    console.log(`    verdict   ${res.verdict.ok ? "SLA met" : `SLA breached — ${res.verdict.detail}`}`);
    console.log(`    outcome   ${mark}`);
  }

  rule("5. Seller settles what it is actually owed");

  const settler = createSettler({
    wallet: sellerWallet,
    publicClient,
    account: seller,
    escrow: escrow.address,
    store,
    // In production this carries your Celo attribution tag. See settle.ts.
    dataSuffix: undefined,
  });

  const settlement = await settler.settleOnce();
  if (settlement) {
    await publicClient.waitForTransactionReceipt({ hash: settlement.txHash });
    console.log(`  settled ${settlement.count} of ${results.length} calls in one transaction`);
    console.log(`  tx      ${settlement.txHash}`);
    console.log(`  gross   ${money(settlement.grossAmount)}`);
  } else {
    console.log("  nothing to settle");
  }

  rule("Result");

  const [buyerBal, sellerBal, finalNonce] = await Promise.all([
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

  const paidCount = results.filter((r) => r.paid).length;
  console.log(`  calls made        ${results.length}`);
  console.log(`  calls paid for    ${paidCount}`);
  console.log(`  buyer escrow      ${money(buyerBal as bigint)}  (charged ${money(DEPOSIT - (buyerBal as bigint))})`);
  console.log(`  seller earned     ${money(sellerBal as bigint)}`);
  console.log(`  buyer nonce       ${finalNonce}  (unchanged since the deposit)`);
  console.log(
    `\n  The two breaches cost the buyer nothing. No refund was requested, no\n` +
      `  dispute was opened, and no arbiter was involved — an unmet SLA simply\n` +
      `  never becomes a payment.\n`,
  );

  server.close();
  anvil?.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
