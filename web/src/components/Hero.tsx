import type { State } from "../lib/types";

interface Props {
  state: State | null;
  callCount: number;
  settled: boolean;
}

export function Hero({ state, callCount, settled }: Props) {
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
        <div className="claim" data-reveal style={{ "--i": 3 } as React.CSSProperties}>
          {buyerTxs === null ? (
            <p className="claim-line pending">
              {settled
                ? "The live figures on this page come from a running instance. Start it with npm run serve --workspace demo."
                : "Reading the buyer's transaction count from the chain…"}
            </p>
          ) : (
            <p className="claim-line">
              The buyer has sent <em>{buyerTxs}</em> transactions since its deposit, across{" "}
              <em>{callCount.toLocaleString()}</em> paid calls.
            </p>
          )}
          <span className="claim-note">
            Authorizations are signed off-chain. Paying costs the buyer no gas and no transaction.
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
