import { useMemo } from "react";
import { POLL_MS } from "../lib/useLedger";
import { short, units } from "../lib/format";
import type { LedgerRow, State } from "../lib/types";

/** The ledger grows without bound; the page should not. */
const VISIBLE_ROWS = 25;

interface Props {
  rows: LedgerRow[];
  state: State | null;
  error: string | null;
}

export function Dashboard({ rows, state, error }: Props) {
  const ordered = useMemo(() => [...rows].sort((a, b) => b.servedAt - a.servedAt), [rows]);

  const budget = state?.sla.maxLatencyMs ?? 800;
  const expectedStatus = state?.sla.expectedStatus ?? 200;

  const paid = ordered.filter((r) => r.acked).length;
  const breached = ordered.length - paid;

  const charged = state ? BigInt(state.deposited) - BigInt(state.buyerEscrowBalance) : 0n;
  const wouldHaveCost = state ? BigInt(state.sla.price) * BigInt(ordered.length) : 0n;
  const avoided = wouldHaveCost - charged;

  return (
    <section className="band" id="ledger">
      <div className="wrap">
        <div className="band-head">
          <div data-reveal>
            <span className="index">03 — Live</span>
            <h2>A running system, not a screenshot.</h2>
          </div>
          <div data-reveal style={{ "--i": 1 } as React.CSSProperties}>
            <p>
              A buyer agent calls the endpoint every few seconds. Roughly one call in four hits a
              deliberately degraded route, so the ledger below shows real breaches alongside real
              settlements.
            </p>
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        <dl className="terms" data-reveal>
          <div className="term">
            <dt>Endpoint</dt>
            <dd className="code">{short(state?.endpointId ?? "")}</dd>
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
            <dd className="code">{short(state?.escrow ?? "")}</dd>
          </div>
        </dl>

        <div className="stats" data-reveal>
          <div className="stat">
            <h3>Calls served</h3>
            <div className="value">{ordered.length}</div>
            <p className="note">
              {paid} met the SLA, {breached} breached
            </p>
          </div>

          <div className="stat">
            <h3>Buyer charged</h3>
            <div className="value">
              {units(charged)}
              <span className="unit">cUSD</span>
            </div>
            <p className="note">{units(wouldHaveCost)} without SLA enforcement</p>
          </div>

          <div className="stat avoided">
            <h3>Never paid out</h3>
            <div className="value">
              {units(avoided > 0n ? avoided : 0n)}
              <span className="unit">cUSD</span>
            </div>
            <p className="note">No refund requested, no dispute opened</p>
          </div>

          <div className="stat">
            <h3>Seller earned</h3>
            <div className="value">
              {state ? units(state.sellerEarned) : "—"}
              <span className="unit">cUSD</span>
            </div>
            <p className="note">Settled on-chain, in batches</p>
          </div>

          <div className="stat">
            <h3>Buyer txs since deposit</h3>
            <div className="value">
              {state ? state.buyerTxCount - state.buyerTxCountAfterSetup : "—"}
            </div>
            <p className="note">Unchanged no matter how many calls are made</p>
          </div>
        </div>

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
                    <tr key={r.requestId}>
                      <td className="hash">{short(r.requestId, 4)}</td>
                      <td>{r.meta?.pair ?? "—"}</td>
                      <td>
                        {badStatus ? (
                          <span className="tag breach">{r.statusCode}</span>
                        ) : (
                          r.statusCode
                        )}
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
          transaction count never moved. The seller could not have been paid for those calls even
          if it tried: <span className="code">SLAEscrow</span> re-checks the signed status and
          latency at redemption and reverts on a breach. Refusing to acknowledge is the entire
          refund mechanism.
        </p>

        <div className="caveat">
          <div data-reveal>
            <h3>The arbiter is one key in v1</h3>
            <p>
              Schema challenges are resolved by a single arbiter. That is a real trust assumption,
              and it is named rather than buried. Status and latency never touch it.
            </p>
          </div>
          <div data-reveal style={{ "--i": 1 } as React.CSSProperties}>
            <h3>The served timestamp is the seller's own clock</h3>
            <p>
              On the unilateral path the bond is what makes lying irrational, not cryptography. On
              the fast path it does not matter, because a buyer will not acknowledge a receipt that
              contradicts its own measurement.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function LatencyBar({ latencyMs, budget }: { latencyMs: number; budget: number }) {
  // The track spans two budgets, so the threshold sits dead centre and an
  // overrun reads immediately as "past the line".
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
