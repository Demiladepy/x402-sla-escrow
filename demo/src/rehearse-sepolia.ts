/**
 * Dress rehearsal of the mainnet session, against Celo Sepolia.
 *
 * Uses the USDC the agent already holds on Sepolia. Same steps as 8 Sep:
 * deploy, register, deposit, one healthy call, one breach, settle, decode tag.
 *
 *   npm run rehearse:sepolia -- --dry-run
 *   npm run rehearse:sepolia
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
import { celoSepolia } from "viem/chains";
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

const PORT = 4022;
const MAX_LATENCY_MS = 800;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set.`);
  return v;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const net = NETWORKS.sepolia;
  const token = (process.env.TOKEN ?? net.tokens.USDC.address) as Address;
  const asset = assertTokenOnChain(net, token);

  const account = privateKeyToAccount(required("AGENT_PRIVATE_KEY") as Hex);
  const rpc = resolveCeloRpc("sepolia");
  const publicClient = createPublicClient({ chain: celoSepolia, transport: http(rpc.url) });
  const wallet = createWalletClient({ account, chain: celoSepolia, transport: http(rpc.url) });

  const chainId = await publicClient.getChainId();
  if (chainId !== celoSepolia.id) throw new Error(`RPC is chain ${chainId}, not Sepolia.`);

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

  console.log(`owner    ${account.address}`);
  console.log(`network  ${net.label}  ${chainId}`);
  console.log(`rpc      ${rpcLabel(rpc.source)}`);
  console.log(`token    ${asset.symbol}  ${asset.address}`);
  console.log(`CELO     ${formatUnits(celoBal, 18)}`);
  console.log(`${asset.symbol.padEnd(8)}${formatUnits(tokenBal, asset.decimals)}`);
  console.log(`need     ${formatUnits(needed, asset.decimals)} ${asset.symbol} (bond + deposit)`);

  if (tokenBal < needed) {
    throw new Error(
      `${asset.symbol} balance is short of ${formatUnits(needed, asset.decimals)}. Top up Sepolia ${asset.symbol} first.`,
    );
  }
  if (celoBal === 0n) throw new Error("No Sepolia CELO for gas.");

  const codes = attributionCodesFromEnv();
  console.log(`tag      ${codes.length ? codes.join(", ") : "(none — allowed on Sepolia)"}`);

  if (dryRun) {
    console.log("\ndry run: balances and TOKEN check out. Nothing was sent.");
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
      chain: celoSepolia,
    });
    const deployed = await publicClient.waitForTransactionReceipt({ hash: deployHash });
    if (!deployed.contractAddress) throw new Error("deploy produced no address");
    escrow = deployed.contractAddress;
    console.log(`escrow   ${escrow}  ${deployHash}`);
  }

  // Circle USDC rejects a non-zero approve unless the current allowance is 0.
  const current = await publicClient.readContract({
    address: asset.address,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, escrow],
  });
  let hash: Hex;
  if (current >= needed) {
    hash = "0x" as Hex;
    console.log(`approve  reused allowance ${formatUnits(current, asset.decimals)}`);
  } else {
    if (current > 0n) {
      const zero = await wallet.writeContract({
        address: asset.address,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [escrow, 0n],
        account,
        chain: celoSepolia,
      });
      await publicClient.waitForTransactionReceipt({ hash: zero });
    }
    hash = await wallet.writeContract({
      address: asset.address,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [escrow, needed],
      account,
      chain: celoSepolia,
    });
    const approved = await publicClient.waitForTransactionReceipt({ hash });
    if (approved.status !== "success") throw new Error(`approve reverted: ${hash}`);

    const allowance = await publicClient.readContract({
      address: asset.address,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [account.address, escrow],
    });
    if (allowance < needed) {
      throw new Error(`allowance ${allowance} < ${needed} after approve ${hash}`);
    }
  }

  const registerArgs = [price, MAX_LATENCY_MS, 200, SCHEMA_HASH, 3600n, bond] as const;
  const { result: endpointId } = await publicClient.simulateContract({
    address: escrow,
    abi: SLA_ESCROW_ABI,
    functionName: "registerEndpoint",
    args: registerArgs as never,
    account,
  });
  hash = await wallet.writeContract({
    address: escrow,
    abi: SLA_ESCROW_ABI,
    functionName: "registerEndpoint",
    args: registerArgs as never,
    account,
    chain: celoSepolia,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`endpoint ${endpointId}`);

  hash = await wallet.writeContract({
    address: escrow,
    abi: SLA_ESCROW_ABI,
    functionName: "deposit",
    args: [deposit],
    account,
    chain: celoSepolia,
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
    console.log(`healthy  paid=${healthy.paid}  ${healthy.observedLatencyMs}ms  ${healthy.verdict.ok ? "ok" : healthy.verdict.detail}`);

    const breach = await client.call(`${base}/api/rate?pair=CUSD/NGN&mode=broken`, { terms });
    console.log(`breach   paid=${breach.paid}  ${breach.observedLatencyMs}ms  ${breach.verdict.ok ? "ok" : breach.verdict.detail}`);

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

    if (codes.length > 0) {
      const attr = await settler.verifyAttribution(settlement.txHash);
      console.log(
        attr.ok
          ? `tag      verified — ${attr.codes.join(", ")}`
          : `tag      MISSING — ${attr.missing.join(", ")}`,
      );
      if (!attr.ok) process.exitCode = 1;
    } else {
      console.log("tag      skipped (set CELO_ATTRIBUTION_TAG to exercise the same path as mainnet)");
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
