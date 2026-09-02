import { useEffect, useMemo, useState } from "react";

interface LedgerRow {
  requestId: string;
  buyer: string;
  amount: string;
  statusCode: number;
  latencyMs: number;
  acked: boolean;
  settledTxHash: string | null;
  servedAt: number;
  meta: { pair?: string; mode?: string } | null;
}

interface State {
  escrow: string;
  asset: string;
  endpointId: string;
  seller: string;
  buyer: string;
  sla: { maxLatencyMs: number; expectedStatus: number; price: string };
  bond: string;
  deposited: string;
  buyerEscrowBalance: string;
  sellerEarned: string;
  buyerTxCount: number;
  buyerTxCountAfterSetup: number;
}

const POLL_MS = 1500;

/** The ledger grows without bound; the page should not. */
const VISIBLE_ROWS = 25;

function units(raw: string | bigint, decimals = 18, places = 4): string {
  const v = typeof raw === "bigint" ? raw : BigInt(raw || "0");
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = ((v % base) * 10n ** BigInt(places)) / base;
  return `${whole}.${frac.toString().padStart(places, "0")}`;
}

const short = (h: string, n = 6) => (h ? `${h.slice(0, 2 + n)}…${h.slice(-4)}` : "—");

function useLedger() {
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

export default function App() {
  const { rows, state, error, fresh } = useLedger();

  const ordered = useMemo(() => [...rows].sort((a, b) => b.servedAt - a.servedAt), [rows]);

  const budget = state?.sla.maxLatencyMs ?? 800;
  const expectedStatus = state?.sla.expectedStatus ?? 200;

  const paid = ordered.filter((r) => r.acked).length;
  const breached = ordered.length - paid;

  const charged = state
    ? BigInt(state.deposited) - BigInt(state.buyerEscrowBalance)
    : 0n;
  const wouldHaveCost = state ? BigInt(state.sla.price) * BigInt(ordered.length) : 0n;
  const avoided = wouldHaveCost - charged;

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <h1>SLA-escrowed x402</h1>
          <p>
            Pay-per-call payments where the payment is conditional on the response meeting the
            endpoint's advertised SLA. A breach is not refunded — it never becomes a payment.
          </p>
        </div>
        <span className="live">
          <span className={`dot${fresh ? "" : " stale"}`} />
          {fresh ? "live" : "offline"}
        </span>
      </header>

      {error && (
        <div className="error" style={{ marginTop: 22 }}>
          {error}
        </div>
      )}

      <dl className="terms">
        <div className="term">
          <dt>Endpoint</dt>
          <dd>{short(state?.endpointId ?? "")}</dd>
        </div>
        <div className="term">
          <dt>Price</dt>
          <dd>{state ? `${units(state.sla.price)} cUSD` : "—"}</dd>
        </div>
        <div className="term">
          <dt>Latency SLA</dt>
          <dd>{budget}ms</dd>
        </div>
        <div className="term">
          <dt>Expected status</dt>
          <dd>HTTP {expectedStatus}</dd>
        </div>
        <div className="term">
          <dt>Seller bond</dt>
          <dd>{state ? `${units(state.bond)} cUSD` : "—"}</dd>
        </div>
        <div className="term">
          <dt>Escrow</dt>
          <dd>{short(state?.escrow ?? "")}</dd>
        </div>
      </dl>

      <section className="stats">
        <div className="stat feature">
          <h2>Buyer txs since deposit</h2>
          <div className="value">
            {state ? state.buyerTxCount - state.buyerTxCountAfterSetup : "—"}
          </div>
          <div className="note">
            {ordered.length > 0
              ? `The deposit was the last transaction the buyer sent. All ${ordered.length} calls since were gasless.`
              : "The buyer signs authorizations; it never transacts to pay."}
          </div>
        </div>

        <div className="stat">
          <h2>Calls served</h2>
          <div className="value">{ordered.length}</div>
          <div className="note">
            {paid} met the SLA, {breached} breached
          </div>
        </div>

        <div className="stat">
          <h2>Buyer charged</h2>
          <div className="value">
            {units(charged)}
            <span className="unit">cUSD</span>
          </div>
          <div className="note">
            {units(wouldHaveCost)} without SLA enforcement
          </div>
        </div>

        <div className="stat">
          <h2>Never paid out</h2>
          <div className="value">
            {units(avoided > 0n ? avoided : 0n)}
            <span className="unit">cUSD</span>
          </div>
          <div className="note">No refund requested, no dispute opened</div>
        </div>

        <div className="stat">
          <h2>Seller earned</h2>
          <div className="value">
            {state ? units(state.sellerEarned) : "—"}
            <span className="unit">cUSD</span>
          </div>
          <div className="note">Settled on-chain, in batches</div>
        </div>
      </section>

      <div className="section-head">
        <h2>Call ledger</h2>
        <span>
          {ordered.length > VISIBLE_ROWS
            ? `Latest ${VISIBLE_ROWS} of ${ordered.length} · `
            : "Newest first · "}
          refreshes every {POLL_MS / 1000}s
        </span>
      </div>

      <div className="table-wrap">
        {ordered.length === 0 ? (
          <div className="empty">
            No calls yet. The buyer agent makes one every few seconds once the demo is running.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Request</th>
                <th>Pair</th>
                <th>Status</th>
                <th>Latency vs {budget}ms budget</th>
                <th>Verdict</th>
                <th>Charged</th>
                <th>Settlement</th>
              </tr>
            </thead>
            <tbody>
              {ordered.slice(0, VISIBLE_ROWS).map((r) => {
                const overLatency = r.latencyMs > budget;
                const badStatus = r.statusCode !== expectedStatus;
                const ok = r.acked;
                const reason = overLatency ? "latency" : badStatus ? `HTTP ${r.statusCode}` : "—";

                return (
                  <tr key={r.requestId} className={ok ? undefined : "breach"}>
                    <td className="hash">{short(r.requestId, 4)}</td>
                    <td className="mono">{r.meta?.pair ?? "—"}</td>
                    <td className={`mono${badStatus ? " " : " dim"}`}>
                      <span className={badStatus ? "tag breach" : ""}>{r.statusCode}</span>
                    </td>
                    <td>
                      <LatencyBar latencyMs={r.latencyMs} budget={budget} />
                    </td>
                    <td>
                      {ok ? (
                        <span className="tag ok">SLA met</span>
                      ) : (
                        <span className="tag breach">breached · {reason}</span>
                      )}
                    </td>
                    <td className={`charged${ok ? "" : " zero"}`}>
                      {ok ? units(r.amount) : "0.0000"}
                    </td>
                    <td className="hash">
                      {r.settledTxHash ? (
                        short(r.settledTxHash, 5)
                      ) : ok ? (
                        <span className="tag pending">queued</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="footnote">
        <strong>What to watch.</strong> Every breached row was charged nothing, and the buyer's
        transaction count never moved. The seller could not have been paid for those calls even if
        it tried: <span className="mono">SLAEscrow</span> re-checks the signed status and latency at
        redemption and reverts on a breach. Refusing to acknowledge is the entire refund mechanism.
      </p>
    </div>
  );
}

function LatencyBar({ latencyMs, budget }: { latencyMs: number; budget: number }) {
  // Track spans two budgets, so the marker sits dead centre and an overrun is
  // immediately readable as "past the line".
  const pct = Math.min((latencyMs / (budget * 2)) * 100, 100);
  const over = latencyMs > budget;
  return (
    <div className="lat">
      <span className="num">{latencyMs}ms</span>
      <span className="track">
        <span className={`fill${over ? " over" : ""}`} style={{ width: `${pct}%` }} />
        <span className="budget" />
      </span>
    </div>
  );
}
