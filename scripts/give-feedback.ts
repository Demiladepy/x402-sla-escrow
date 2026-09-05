/**
 * Posts SLA-derived feedback to the ERC-8004 Reputation Registry.
 *
 * The agent owner cannot rate itself. BUYER_PRIVATE_KEY must be a different
 * address — typically the wallet that actually paid for the calls.
 *
 *   npm run agent:feedback -- --dry-run
 *   npm run agent:feedback
 */
import { createPublicClient, createWalletClient, http, keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { resolveCeloRpc, rpcLabel } from "./rpc.js";

const REPUTATION = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as const;
const AGENT_ID = 9807n;

const ABI = [
  {
    type: "function",
    name: "giveFeedback",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set.`);
  return v;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const owner = (process.env.AGENT_ADDRESS ?? "").toLowerCase();
  const buyerKey = process.env.BUYER_PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY;
  if (!buyerKey) throw new Error("BUYER_PRIVATE_KEY is not set.");

  const account = privateKeyToAccount(buyerKey as Hex);
  if (account.address.toLowerCase() === owner) {
    throw new Error(
      `${account.address} owns agent ${AGENT_ID}. The registry rejects self-ratings. ` +
        `Set BUYER_PRIVATE_KEY to the wallet that paid for the calls.`,
    );
  }

  const score = Number(process.env.FEEDBACK_SCORE ?? "100");
  const tag = process.env.FEEDBACK_TAG ?? "successRate";
  const detail = JSON.stringify({
    type: "sla-feedback",
    agentId: Number(AGENT_ID),
    tag,
    score,
    note: "Derived from on-chain SLA outcomes: a breach is never paid, so successRate is paid/served.",
  });
  const feedbackHash = keccak256(toBytes(detail));

  console.log(`client   ${account.address}`);
  console.log(`agent    ${AGENT_ID}`);
  console.log(`tag      ${tag}  score ${score}`);
  console.log(`hash     ${feedbackHash}`);

  const rpc = resolveCeloRpc("mainnet");
  const publicClient = createPublicClient({ chain: celo, transport: http(rpc.url) });
  console.log(`rpc      ${rpcLabel(rpc.source)}`);

  await publicClient.simulateContract({
    address: REPUTATION,
    abi: ABI,
    functionName: "giveFeedback",
    args: [AGENT_ID, BigInt(score), 0, tag, "", "https://github.com/Demiladepy/x402-sla-escrow", "", feedbackHash],
    account,
  });
  console.log("simulated: giveFeedback would succeed");

  if (dryRun) {
    console.log("\ndry run: nothing sent.");
    return;
  }

  const wallet = createWalletClient({ account, chain: celo, transport: http(rpc.url) });
  const hash = await wallet.writeContract({
    address: REPUTATION,
    abi: ABI,
    functionName: "giveFeedback",
    args: [AGENT_ID, BigInt(score), 0, tag, "", "https://github.com/Demiladepy/x402-sla-escrow", "", feedbackHash],
    account,
    chain: celo,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`feedback reverted: ${hash}`);
  console.log(`submitted ${hash}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
