import { useEffect, useState } from "react";
import type { LedgerRow, State } from "./types";

const POLL_MS = 1500;

export { POLL_MS };

export function useLedger() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    let alive = true;

    async function tick() {
      try {
        const [l, s] = await Promise.all([
          fetch("/api/ledger").then((r) => r.json()),
          fetch("/api/state").then((r) => r.json()),
        ]);
        if (!alive) return;
        setRows(l as LedgerRow[]);
        setState(s as State);
        setError(null);
        setFresh(true);
      } catch {
        if (!alive) return;
        setFresh(false);
        setError("Can't reach the seller. Start it with `npm run serve --workspace demo`.");
      }
    }

    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return { rows, state, error, fresh };
}
