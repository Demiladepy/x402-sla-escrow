import type { LedgerRow } from "./types";

/** Hash scenes a judge can land on without scrolling the argument. */
export const SCENES = ["healthy", "breach", "settle", "system"] as const;
export type Scene = (typeof SCENES)[number];

export function parseScene(hash: string): Scene | null {
  const id = hash.replace(/^#/, "");
  return (SCENES as readonly string[]).includes(id) ? (id as Scene) : null;
}

export function pickPinnedRow(rows: LedgerRow[], scene: Scene | null): LedgerRow | null {
  if (scene === "healthy") {
    return rows.find((r) => r.acked) ?? null;
  }
  if (scene === "breach") {
    return rows.find((r) => !r.acked) ?? null;
  }
  if (scene === "settle") {
    return rows.find((r) => r.settledTxHash) ?? rows.find((r) => r.acked) ?? null;
  }
  return null;
}
