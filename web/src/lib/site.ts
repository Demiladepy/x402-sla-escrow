/** Public origin: the existing Vercel deployment. */
export const APP_DOMAIN = (
  import.meta.env.VITE_APP_DOMAIN ?? "https://web-one-drab-31.vercel.app"
).replace(/\/$/, "");

export const AGENT = {
  id: 9807,
  url: "https://8004scan.io/agents/celo/9807",
  wallet: "0x922184A4702f0DF95fB86C3879BC3eD935b75721",
  repo: "https://github.com/Demiladepy/x402-sla-escrow",
} as const;
