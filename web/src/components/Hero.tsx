import type { State } from "../lib/types";

interface Props {
  state: State | null;
  callCount: number;
}

export function Hero({ state, callCount }: Props) {
  const buyerTxs = state ? state.buyerTxCount - state.buyerTxCountAfterSetup : null;

  return (
    <section className="hero wrap">
      <span className="eyebrow" data-reveal style={{ "--i": 0 } as React.CSSProperties}>
        Celo · x402 · settled in cUSD
      </span>

      <h1 data-reveal style={{ "--i": 1 } as React.CSSProperties}>
        Serving slowly is serving for free.
      </h1>

      <p className="lede" data-reveal style={{ "--i": 2 } as React.CSSProperties}>
        An agent pays per API call. If the response misses the latency budget or returns the wrong
        status, <strong>the money never moves</strong> — because the escrow re-checks the SLA itself
        and reverts. There is nothing to refund and no dispute to open.
      </p>

      <div className="hero-foot">
        <div className="proof" data-reveal style={{ "--i": 3 } as React.CSSProperties}>
          <span className="proof-label">Buyer transactions since deposit</span>
          <span className="proof-value">{buyerTxs ?? "—"}</span>
          <span className="proof-note">
            {callCount > 0
              ? `The deposit was the last transaction the buyer sent. All ${callCount} calls since cost it no gas.`
              : "The buyer signs authorizations off-chain. It never transacts to pay."}
          </span>
        </div>

        <a
          className="jump"
          href="#ledger"
          data-reveal
          style={{ "--i": 4 } as React.CSSProperties}
        >
          Watch it happen live
          <span className="arrow" aria-hidden="true">
            ↓
          </span>
        </a>
      </div>
    </section>
  );
}
