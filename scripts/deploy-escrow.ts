/**
 * Deploys SLAEscrow after checking that TOKEN belongs on the target chain.
 *
 *   npm run escrow:deploy -- sepolia --dry-run
 *   npm run escrow:deploy -- sepolia
 *   npm run escrow:deploy -- mainnet --dry-run
 *   npm run escrow:deploy -- mainnet
 *
 * Foundry still does the broadcast. This wrapper exists so a TOKEN copied from
 * the wrong network is rejected before gas is spent.
 */
import { execFileSync } from "node:child_process";
import { createPublicClient, http, type Address } from "viem";
import { assertTokenOnChain, resolveNetwork } from "./networks.js";
import { resolveCeloRpc, rpcLabel } from "./rpc.js";

async function main() {
  const key = process.argv[2];
  if (!key) throw new Error("usage: npm run escrow:deploy -- <mainnet|sepolia> [--dry-run]");
  const dryRun = process.argv.includes("--dry-run");
  const net = resolveNetwork(key);

  const fallback = net.key === "mainnet" ? net.tokens.cUSD.address : net.tokens.USDC.address;
  const token = (process.env.TOKEN ?? fallback) as Address;
  const asset = assertTokenOnChain(net, token);

  const rpc = resolveCeloRpc(net.key);

  const client = createPublicClient({ chain: net.chain, transport: http(rpc.url) });
  const chainId = await client.getChainId();
  if (chainId !== net.chain.id) {
    throw new Error(`RPC reports chain ${chainId}, expected ${net.chain.id} (${net.label}).`);
  }

  console.log(`${net.label}  chain ${chainId}`);
  console.log(`TOKEN     ${asset.symbol}  ${asset.address}  ${asset.decimals} decimals`);
  console.log(`ARBITER   ${process.env.ARBITER ?? "(deployer)"}`);
  console.log(`rpc       ${rpcLabel(rpc.source)}`);

  if (dryRun) {
    console.log("\ndry run: chain and TOKEN agree. Nothing was broadcast.");
    return;
  }

  const pk = process.env.AGENT_PRIVATE_KEY;
  if (!pk) throw new Error("AGENT_PRIVATE_KEY is not set.");

  execFileSync(
    "forge",
    [
      "script",
      "script/Deploy.s.sol:Deploy",
      "--root",
      "contracts",
      "--rpc-url",
      rpc.url,
      "--private-key",
      pk,
      "--broadcast",
    ],
    { stdio: "inherit", env: { ...process.env, TOKEN: asset.address } },
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
