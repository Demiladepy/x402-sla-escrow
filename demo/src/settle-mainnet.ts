/**
 * The 8 Sep mainnet session: two calls, one tagged settlement.
 *
 * Refuses to broadcast unless --broadcast is passed, TOKEN is a known mainnet
 * stablecoin (USAT, USDC, USDT, or cUSD), chain id is 42220, and the wallet
 * holds that token. Do not point serve.ts here.
 *
 *   npm run settle:mainnet -- --dry-run
 *   npm run settle:mainnet -- --broadcast
 */
import { createServer } from "node:http";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import {
  ERC20_ABI,
  SLA_ESCROW_ABI,
  attributionCodesFromEnv,
  createBuyerClient,
  createSettler,
} from "@x402sla/sdk";
import { assertTokenOnChain, NETWORKS } from "../../scripts/networks.js";
import { resolveCeloRpc, rpcLabel } from "../../scripts/rpc.js";
import { SCHEMA_HASH, createSellerApp } from "./seller-app.js";
import { artifact } from "./chain.js";

const PORT = 4023;
const MAX_LATENCY_MS = 800;
const USAT = "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771" as Address;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set.`);
  return v;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run") || !process.argv.includes("--broadcast");
  const net = NETWORKS.mainnet;
  const token = (process.env.TOKEN ?? USAT) as Address;
  const asset = assertTokenOnChain(net, token);

  const account = privateKeyToAccount(required("AGENT_PRIVATE_KEY") as Hex);
  const rpc = resolveCeloRpc("mainnet");
  const publicClient = createPublicClient({ chain: celo, transport: http(rpc.url) });
  const wallet = createWalletClient({ account, chain: celo, transport: http(rpc.url) });

  const chainId = await publicClient.getChainId();
  if (chainId !== celo.id) throw new Error(`RPC is chain ${chainId}, not Celo mainnet.`);

  const price = parseUnits("0.001", asset.decimals);
  const bond = price * 200n;
  const deposit = parseUnits("0.05", asset.decimals);
  const needed = bond + deposit;

  const [celoBal, tokenBal] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({
      address: asset.address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    }),
  ]);

  const codes = attributionCodesFromEnv();
  console.log(`owner    ${account.address}`);
  console.log(`network  ${net.label}  ${chainId}`);
  console.log(`rpc      ${rpcLabel(rpc.source)}`);
  console.log(`token    ${asset.symbol}  ${asset.address}`);
  console.log(`CELO     ${formatUnits(celoBal, 18)}`);
  console.log(`${asset.symbol.padEnd(8)}${formatUnits(tokenBal, asset.decimals)}`);
  console.log(`need     ${formatUnits(needed, asset.decimals)} ${asset.symbol} (bond + deposit)`);
  console.log(`tag      ${codes.join(", ") || "(MISSING)"}`);

  if (codes.length === 0) {
    throw new Error("CELO_ATTRIBUTION_TAG is required on mainnet. The settler will refuse to construct.");
  }
  if (tokenBal < needed) {
    throw new Error(
      `Need ${formatUnits(needed, asset.decimals)} ${asset.symbol} on ${account.address} (chain 42220). Claim USAT from the Google Cloud / Self faucet, or bridge via Squid, then re-run.`,
    );
  }
  if (celoBal < parseUnits("0.15", 18)) {
    throw new Error("Keep at least ~0.2 CELO for deploy + 2–3 settlements.");
  }

  if (dryRun) {
    console.log("\ndry run: chain, TOKEN, tag and balances check out. Pass --broadcast to send.");
    return;
  }

  const existing = process.env.ESCROW as Address | undefined;
  let escrow: Address;

  if (existing) {
    escrow = existing;
    console.log(`escrow   ${escrow}  (reused)`);
  } else {
    const art = artifact("SLAEscrow");
    const deployHash = await wallet.deployContract({
      abi: art.abi,
      bytecode: art.bytecode.object,
      args: [asset.address, account.address],
      account,
      chain: celo,
    });
    const deployed = await publicClient.waitForTransactionReceipt({ hash: deployHash });
    if (!deployed.contractAddress) throw new Error("deploy produced no address");
    escrow = deployed.contractAddress;
    console.log(`escrow   ${escrow}  ${deployHash}`);
  }

  const current = await publicClient.readContract({
    address: asset.address,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, escrow],
  });
  if (current < needed) {
    if (current > 0n) {
      const zero = await wallet.writeContract({
        address: asset.address,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [escrow, 0n],
        account,
        chain: celo,
      });
      await publicClient.waitForTransactionReceipt({ hash: zero });
    }
    const approveHash = await wallet.writeContract({
      address: asset.address,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [escrow, needed],
      account,
      chain: celo,
    });
    const approved = await publicClient.waitForTransactionReceipt({ hash: approveHash });
    if (approved.status !== "success") throw new Error(`approve reverted: ${approveHash}`);
  }

  const registerArgs = [price, MAX_LATENCY_MS, 200, SCHEMA_HASH, 3600n, bond] as const;
  const { result: endpointId } = await publicClient.simulateContract({
    address: escrow,
    abi: SLA_ESCROW_ABI,
    functionName: "registerEndpoint",
    args: registerArgs as never,
    account,
  });
  let hash = await wallet.writeContract({
    address: escrow,
    abi: SLA_ESCROW_ABI,
    functionName: "registerEndpoint",
    args: registerArgs as never,
    account,
    chain: celo,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`endpoint ${endpointId}`);

  hash = await wallet.writeContract({
    address: escrow,
    abi: SLA_ESCROW_ABI,
    functionName: "deposit",
    args: [deposit],
    account,
    chain: celo,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`deposited ${formatUnits(deposit, asset.decimals)} ${asset.symbol}`);

  const { app, store } = createSellerApp({
    escrow,
    chainId,
    endpointId: endpointId as Hex,
    asset: asset.address,
    price,
    maxLatencyMs: MAX_LATENCY_MS,
    port: PORT,
    account,
  });

  const reserved = createServer();
  await new Promise<void>((resolve, reject) => {
    reserved.once("error", reject);
    reserved.listen(PORT, () => resolve());
  });
  await new Promise<void>((resolve) => reserved.close(() => resolve()));

  const server = app.listen(PORT);
  const base = `http://127.0.0.1:${PORT}`;

  try {
    const client = createBuyerClient({ account, escrow, chainId });
    const terms = await client.discover(`${base}/api/rate`);

    const healthy = await client.call(`${base}/api/rate?pair=CUSD/NGN`, { terms });
    console.log(`healthy  paid=${healthy.paid}  ${healthy.observedLatencyMs}ms`);

    const breach = await client.call(`${base}/api/rate?pair=CUSD/NGN&mode=broken`, { terms });
    console.log(`breach   paid=${breach.paid}  ${breach.observedLatencyMs}ms`);

    const settler = createSettler({
      wallet,
      publicClient,
      account,
      escrow,
      store,
      attributionCodes: codes,
    });

    const settlement = await settler.settleOnce();
    if (!settlement) throw new Error("nothing to settle after the healthy call");
    await publicClient.waitForTransactionReceipt({ hash: settlement.txHash });
    console.log(`settled  ${settlement.count} call(s)  ${settlement.txHash}`);

    const attr = await settler.verifyAttribution(settlement.txHash);
    console.log(
      attr.ok
        ? `tag      verified — ${attr.codes.join(", ")}`
        : `tag      MISSING — ${attr.missing.join(", ")}`,
    );
    if (!attr.ok) process.exitCode = 1;

    const deployTx = process.env.VITE_MAINNET_DEPLOY_TX ?? "";
    console.log("\nWrite these into the draft and the #settle scene:");
    console.log(`  OWN_CONTRACTS=${escrow}`);
    console.log(`  VITE_MAINNET_ESCROW=${escrow}`);
    console.log(`  VITE_MAINNET_SETTLE_TX=${settlement.txHash}`);
    if (deployTx) console.log(`  VITE_MAINNET_DEPLOY_TX=${deployTx}`);

    const { writeFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    writeFileSync(
      resolve(process.cwd(), "../web/.env.local"),
      [
        `VITE_MAINNET_ESCROW=${escrow}`,
        `VITE_MAINNET_SETTLE_TX=${settlement.txHash}`,
        deployTx ? `VITE_MAINNET_DEPLOY_TX=${deployTx}` : "",
      ]
        .filter(Boolean)
        .join("\n") + "\n",
    );
    console.log("wrote web/.env.local (gitignored)");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
