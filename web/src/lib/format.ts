/** Fixed-point formatting for token amounts, without pulling in a big-number lib. */
export function units(raw: string | bigint, decimals = 18, places = 4): string {
  const v = typeof raw === "bigint" ? raw : BigInt(raw || "0");
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = ((v % base) * 10n ** BigInt(places)) / base;
  return `${whole}.${frac.toString().padStart(places, "0")}`;
}

export const short = (h: string, n = 6) => (h ? `${h.slice(0, 2 + n)}…${h.slice(-4)}` : "—");
