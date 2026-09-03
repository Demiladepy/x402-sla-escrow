/** Fixed-point formatting for token amounts, without pulling in a big-number lib. */
export function units(raw: string | bigint, decimals = 18, places = 4): string {
  const v = typeof raw === "bigint" ? raw : BigInt(raw || "0");
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = ((v % base) * 10n ** BigInt(places)) / base;
  return `${whole}.${frac.toString().padStart(places, "0")}`;
}

export const short = (h: string, n = 6) => (h ? `${h.slice(0, 2 + n)}…${h.slice(-4)}` : "pending");

export function decimalsOf(state: { decimals?: number } | null | undefined): number {
  return state?.decimals ?? 18;
}

export function tokenOf(state: { tokenSymbol?: string } | null | undefined): string {
  return state?.tokenSymbol ?? "cUSD";
}

export function explorerTx(chainId: number | undefined, hash: string): string | null {
  if (!hash) return null;
  if (chainId === 11142220) return `https://sepolia.celoscan.io/tx/${hash}`;
  if (chainId === 42220) return `https://celoscan.io/tx/${hash}`;
  return null;
}

export function explorerAddress(chainId: number | undefined, address: string): string | null {
  if (!address) return null;
  if (chainId === 11142220) return `https://sepolia.celoscan.io/address/${address}`;
  if (chainId === 42220) return `https://celoscan.io/address/${address}`;
  return null;
}
