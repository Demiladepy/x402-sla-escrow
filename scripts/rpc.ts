export type NetworkKey = "mainnet" | "sepolia";
export type RpcSource = "chainstack" | "env" | "public";

const PUBLIC = {
  mainnet: "https://forno.celo.org",
  sepolia: "https://forno.celo-sepolia.celo-testnet.org",
} as const;

export function looksLikeChainstack(url: string): boolean {
  return /chainstack\.com|p2pify\.com/i.test(url);
}

/**
 * Chainstack first, then an explicit CELO_* URL, then Forno.
 * Never log the URL: Chainstack endpoints carry the node key in the path.
 */
export function resolveCeloRpc(net: NetworkKey): { url: string; source: RpcSource } {
  const dedicated =
    net === "mainnet"
      ? process.env.CHAINSTACK_CELO_RPC_URL
      : process.env.CHAINSTACK_SEPOLIA_RPC_URL;
  if (dedicated) return { url: dedicated, source: "chainstack" };

  const fallback =
    net === "mainnet" ? process.env.CELO_RPC_URL : process.env.CELO_SEPOLIA_RPC_URL;
  if (fallback) {
    return { url: fallback, source: looksLikeChainstack(fallback) ? "chainstack" : "env" };
  }

  return { url: PUBLIC[net], source: "public" };
}

export function rpcLabel(source: RpcSource): string {
  if (source === "chainstack") return "Chainstack";
  if (source === "env") return "custom RPC";
  return "Forno";
}
