export type Stack = {
  rpc: "chainstack" | "forno";
  upstream: "cencori" | "static";
  cencoriConfigured: boolean;
};

function chainstackSet(): boolean {
  const urls = [
    process.env.CHAINSTACK_CELO_RPC_URL,
    process.env.CHAINSTACK_SEPOLIA_RPC_URL,
    process.env.CELO_RPC_URL,
    process.env.CELO_SEPOLIA_RPC_URL,
  ];
  return urls.some((u) => !!u && /chainstack\.com|p2pify\.com/i.test(u));
}

export function describeStack(): Stack {
  const cencoriConfigured = Boolean(process.env.CENCORI_API_KEY);
  return {
    rpc: chainstackSet() ? "chainstack" : "forno",
    upstream: cencoriConfigured ? "cencori" : "static",
    cencoriConfigured,
  };
}
