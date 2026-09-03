/**
 * Reports what the agent wallet actually holds, per network.
 *
 *   npm run agent:balance              # both networks
 *   npm run agent:balance -- mainnet
 *   npm run agent:balance -- sepolia
 *
 * Exists because "I sent it" and "it arrived on the right chain" are different
 * claims, and the difference stays invisible until something reverts.
 */
import { createPublicClient, formatUnits, http, type Address, type Chain } from "viem";
import { celo, celoSepolia } from "viem/chains";

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

interface Token {
  symbol: string;
  address: Address;
  decimals: number;
}

interface Network {
  key: string;
  label: string;
  chain: Chain;
  rpcUrl?: string;
  tokens: Token[];
}

const NETWORKS: Network[] = [
  {
    key: "mainnet",
    label: "Celo mainnet",
    chain: celo,
    rpcUrl: process.env.CELO_RPC_URL,
    tokens: [
      { symbol: "cUSD", address: "0x765DE816845861e75A25fCA122bb6898B8B1282a", decimals: 18 },
      { symbol: "USDC", address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", decimals: 6 },
      { symbol: "USDT", address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6 },
      { symbol: "NGNm", address: "0xE2702Bd97ee33c88c8f6f92DA3B733608aa76F71", decimals: 18 },
    ],
  },
  {
    key: "sepolia",
    label: "Celo Sepolia",
    chain: celoSepolia,
    rpcUrl: process.env.CELO_SEPOLIA_RPC_URL,
    tokens: [
      { symbol: "cUSD", address: "0xEF4d55D6dE8e8d73232827Cd1e9b2F2dBb45bC80", decimals: 18 },
      { symbol: "USDC", address: "0x01C5C0122039549AD1493B8220cABEdD739BC44E", decimals: 6 },
      { symbol: "USDm", address: "0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b", decimals: 18 },
    ],
  },
];

async function report(net: Network, address: Address) {
  const client = createPublicClient({
    chain: net.chain,
    transport: http(net.rpcUrl ?? net.chain.rpcUrls.default.http[0]),
  });

  console.log(`\n${net.label}  (chain ${net.chain.id})`);
  console.log("─".repeat(38));

  let native: bigint;
  try {
    native = await client.getBalance({ address });
  } catch (err) {
    console.log(`  unreachable: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    return;
  }

  console.log(`  CELO   ${formatUnits(native, 18)}`);

  const balances = await Promise.all(
    net.tokens.map((t) =>
      client
        .readContract({
          address: t.address,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        })
        .catch(() => null),
    ),
  );

  net.tokens.forEach((t, i) => {
    const b = balances[i];
    console.log(`  ${t.symbol.padEnd(6)} ${b === null ? "—" : formatUnits(b, t.decimals)}`);
  });

  const funded = native > 0n || balances.some((b) => b !== null && b > 0n);
  if (!funded) console.log("  (empty)");

  if (net.key === "mainnet") {
    const cusd = balances[net.tokens.findIndex((t) => t.symbol === "cUSD")];
    if (cusd === 0n || cusd === null) {
      console.log("  NOT FUNDED: send $5–10 cUSD to this address on chain 42220.");
    } else {
      console.log(`  cUSD funded: ${formatUnits(cusd, 18)}`);
    }
  }
}

async function main() {
  const address = (process.env.AGENT_ADDRESS ?? process.argv[3]) as Address | undefined;
  if (!address) throw new Error("Set AGENT_ADDRESS in .env, or pass an address as an argument.");

  const requested = process.argv[2];
  const selected = requested ? NETWORKS.filter((n) => n.key === requested) : NETWORKS;
  if (selected.length === 0) {
    throw new Error(`unknown network "${requested}". Use mainnet or sepolia.`);
  }

  console.log(`address: ${address}`);
  for (const net of selected) await report(net, address);

  const mainnet = createPublicClient({
    chain: celo,
    transport: http(process.env.CELO_RPC_URL ?? celo.rpcUrls.default.http[0]),
  });
  const gas = await mainnet.getBalance({ address }).catch(() => 0n);

  console.log("");
  if (gas > 0n) {
    console.log("Mainnet-ready: holds CELO, so the ERC-8004 mint can pay its own gas.");
  } else {
    console.log(
      "Not mainnet-ready. Registration needs one mainnet transaction; set FEE_CURRENCY to\n" +
        "pay that gas in a stablecoin, or fund this address with a little CELO on Celo mainnet.",
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
