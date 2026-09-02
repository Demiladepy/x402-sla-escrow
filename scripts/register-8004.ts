/**
 * Registers the agent's ERC-8004 identity on Celo mainnet.
 *
 * Mints an identity NFT from the Identity Registry and prints the agent id plus
 * the two URL forms the hackathon accepts. Requires AGENT_PRIVATE_KEY in .env
 * and a little CELO in that account for gas.
 *
 *   npx tsx scripts/register-8004.ts
 *
 * Checks that AGENT_URI actually resolves before spending anything, because an
 * identity pointing at a 404 is worse than no identity.
 */
import { createPublicClient, createWalletClient, decodeEventLog, http, type Hex } from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;

const REGISTRY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Add it to .env.`);
  return value;
}

async function main() {
  const privateKey = required("AGENT_PRIVATE_KEY") as Hex;
  const agentUri = required("AGENT_URI");
  const rpcUrl = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: celo, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain: celo, transport: http(rpcUrl) });

  console.log(`agent uri: ${agentUri}`);
  console.log(`owner:     ${account.address}`);

  const probe = await fetch(agentUri).catch((err: Error) => {
    throw new Error(`could not fetch AGENT_URI: ${err.message}`);
  });
  if (!probe.ok) {
    throw new Error(`AGENT_URI returned HTTP ${probe.status}. Push it public first.`);
  }
  const body = (await probe.json()) as { type?: string; name?: string };
  if (body.type !== "Agent") {
    throw new Error(`AGENT_URI is reachable but its "type" is not "Agent".`);
  }
  console.log(`uri resolves, describes: ${body.name}`);

  // FEE_CURRENCY lets this run on an account holding no CELO at all: gas is
  // charged in the allowlisted ERC-20 instead. Use the adapter address, not the
  // token address, for anything that is not 18 decimals (USDC, USD₮, USA₮).
  const feeCurrency = process.env.FEE_CURRENCY as Hex | undefined;

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`balance:   ${balance} wei CELO`);
  if (balance === 0n && !feeCurrency) {
    throw new Error(
      `${account.address} holds no CELO. Either fund it, or set FEE_CURRENCY to ` +
        `pay gas in an ERC-20 (see .env.example).`,
    );
  }
  if (feeCurrency) console.log(`gas paid in: ${feeCurrency}`);

  const { result: simulatedId } = await publicClient.simulateContract({
    address: IDENTITY_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "register",
    args: [agentUri],
    account,
  });
  console.log(`simulated agent id: ${simulatedId}`);

  const hash = await wallet.writeContract({
    address: IDENTITY_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "register",
    args: [agentUri],
    account,
    chain: celo,
    feeCurrency,
  });
  console.log(`submitted: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`registration reverted: ${hash}`);

  let agentId: bigint | undefined;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== IDENTITY_REGISTRY.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: REGISTRY_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "Registered") {
        agentId = decoded.args.agentId;
        break;
      }
    } catch {
      // Not the event we are after; the registry emits ERC-721 logs too.
    }
  }
  if (agentId === undefined) throw new Error("registered, but no Registered event found");

  console.log(`\nagent id: ${agentId}`);
  console.log(`8004scan:  https://8004scan.io/agents/celo/${agentId}`);
  console.log(`celoscan:  https://celoscan.io/nft/${IDENTITY_REGISTRY.toLowerCase()}/${agentId}`);
  console.log("\nUse either URL as erc8004Url when registering for the hackathon.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
