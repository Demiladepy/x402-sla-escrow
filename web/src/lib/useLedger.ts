import { useEffect, useState } from "react";
import type { LedgerRow, State, System } from "./types";

const POLL_MS = 1500;

export { POLL_MS };

async function json<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return (await res.json()) as T;
}

export function useLedger() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [state, setState] = useState<State | null>(null);
  const [system, setSystem] = useState<System | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  /**
   * Distinguishes "still connecting" from "connected and empty". Without it the
   * first paint claims the seller is unreachable before a request has finished.
   */
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let alive = true;

    async function tick() {
      try {
        const [l, s, sys] = await Promise.all([
          json<LedgerRow[]>("/api/ledger"),
          json<State>("/api/state"),
          json<System>("/api/system"),
        ]);
        if (!alive) return;
        setRows(l);
        setState(s);
        setSystem(sys);
        setError(null);
        setFresh(true);
      } catch {
        if (!alive) return;
        setFresh(false);
        setError("offline");
      } finally {
        if (alive) setSettled(true);
      }
    }

    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return { rows, state, system, error, fresh, settled };
}
