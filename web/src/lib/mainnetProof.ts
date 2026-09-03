/** Mainnet proof the #settle scene can show even when live traffic is anvil. */
export const MAINNET_PROOF = {
  agentId: 9807,
  agentUrl: "https://8004scan.io/agents/celo/9807",
  escrow: import.meta.env.VITE_MAINNET_ESCROW ?? "",
  deployTx: import.meta.env.VITE_MAINNET_DEPLOY_TX ?? "",
  settleTx: import.meta.env.VITE_MAINNET_SETTLE_TX ?? "",
  tag: "celo_5ffb6e9c75fb",
  ownCode: "x402_sla",
};

export function hasMainnetProof(): boolean {
  return Boolean(MAINNET_PROOF.escrow && MAINNET_PROOF.settleTx);
}
