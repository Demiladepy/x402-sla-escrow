import { celo, celoSepolia, type Chain } from "viem/chains";
import type { Address } from "viem";

/**
 * TOKEN must match the chain. Shipping a mainnet cUSD address against Sepolia
 * (or the reverse) is the one deploy mistake that cannot be walked back.
 */
export interface NetworkSpec {
  key: "mainnet" | "sepolia";
  chain: Chain;
  label: string;
  tokens: Record<string, { address: Address; decimals: number }>;
}

export const NETWORKS: Record<NetworkSpec["key"], NetworkSpec> = {
  mainnet: {
    key: "mainnet",
    chain: celo,
    label: "Celo mainnet",
    tokens: {
      cUSD: { address: "0x765DE816845861e75A25fCA122bb6898B8B1282a", decimals: 18 },
      USDC: { address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", decimals: 6 },
      NGNm: { address: "0xE2702Bd97ee33c88c8f6f92DA3B733608aa76F71", decimals: 18 },
    },
  },
  sepolia: {
    key: "sepolia",
    chain: celoSepolia,
    label: "Celo Sepolia",
    tokens: {
      cUSD: { address: "0xEF4d55D6dE8e8d73232827Cd1e9b2F2dBb45bC80", decimals: 18 },
      USDC: { address: "0x01C5C0122039549AD1493B8220cABEdD739BC44E", decimals: 6 },
    },
  },
};

export function resolveNetwork(key: string): NetworkSpec {
  const net = NETWORKS[key as NetworkSpec["key"]];
  if (!net) throw new Error(`unknown network "${key}". Use mainnet or sepolia.`);
  return net;
}

export function assertTokenOnChain(net: NetworkSpec, token: Address) {
  const known = Object.entries(net.tokens).find(
    ([, t]) => t.address.toLowerCase() === token.toLowerCase(),
  );
  if (!known) {
    throw new Error(
      `TOKEN ${token} is not a known settlement asset on ${net.label} (chain ${net.chain.id}). ` +
        `Refusing to deploy — this is how an escrow gets pointed at the wrong network.`,
    );
  }
  return { symbol: known[0], ...known[1] };
}
