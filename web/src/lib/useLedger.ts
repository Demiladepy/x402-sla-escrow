import { useEffect, useState } from "react";
import { RECORDED_ROWS, RECORDED_STATE, RECORDED_SYSTEM } from "./recorded";
import type { LedgerRow, State, System } from "./types";

const POLL_MS = 1500;

export { POLL_MS };

export type LedgerSource = "live" | "recorded";

const SELLER = (import.meta.env.VITE_SELLER_URL as string | undefined)?.replace(/\/$/, "") ?? "";

async function json<T>(path: string): Promise<T> {
  const res = await fetch(`${SELLER}${path}`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return (await res.json()) as T;
}

export function useLedger() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [state, setState] = useState<State | null>(null);
  const [system, setSystem] = useState<System | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const [source, setSource] = useState<LedgerSource | null>(null);
  /**
   * Distinguishes "still connecting" from "connected and empty". Without it the
   * first paint claims the seller is unreachable before a request has finished.
   */
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let alive = true;
    let hadLive = false;

    function showRecorded() {
      setRows(RECORDED_ROWS);
      setState(RECORDED_STATE);
      setSystem(RECORDED_SYSTEM);
      setError(null);
      setFresh(false);
      setSource("recorded");
    }

    async function tick() {
      try {
        const [l, s, sys] = await Promise.all([
          json<LedgerRow[]>("/api/ledger"),
          json<State>("/api/state"),
          json<System>("/api/system"),
        ]);
        if (!alive) return;
        hadLive = true;
        setRows(l);
        setState(s);
        setSystem(sys);
        setError(null);
        setFresh(true);
        setSource("live");
      } catch {
        if (!alive) return;
        if (hadLive) {
          setFresh(false);
          return;
        }
        showRecorded();
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

  return { rows, state, system, error, fresh, settled, source };
}