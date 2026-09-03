import { useEffect, useState } from "react";

const FALLBACK = {
  name: "FX rate",
  pairs: ["CUSD/NGN", "CUSD/KES", "CUSD/GHS"],
  price: "1000000000000000",
  maxLatencyMs: 800,
  expectedStatus: 200,
  path: "/api/rate",
};

type Catalog = typeof FALLBACK;

const SELLER = (import.meta.env.VITE_SELLER_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export function Call() {
  const [catalog, setCatalog] = useState<Catalog>(FALLBACK);

  useEffect(() => {
    let alive = true;
    fetch(`${SELLER}/api/catalog`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((c: Catalog) => {
        if (alive && Array.isArray(c.pairs) && c.pairs.length) setCatalog(c);
      })
      .catch(() => {
        /* Static fallback is the product contract: those three pairs, 800ms, 0.001. */
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="band" id="call">
      <div className="wrap">
        <div className="band-head">
          <div data-reveal>
            <span className="index">01 Call</span>
            <h2>A rate feed an agent would actually pay for.</h2>
          </div>
          <div data-reveal style={{ "--i": 1 } as React.CSSProperties}>
            <p>
              Price is 0.001 cUSD. The SLA is HTTP 200 inside {catalog.maxLatencyMs}ms. Miss either
              and the buyer does not acknowledge, so the seller is never paid. Settlement is a
              later batch on the seller side. It is not the product.
            </p>
          </div>
        </div>

        <div className="call-grid">
          <article className="call-card" data-reveal>
            <h3>Pairs</h3>
            <ul className="call-pairs">
              {catalog.pairs.map((p) => (
                <li key={p} className="code">
                  {p}
                </li>
              ))}
            </ul>
            <p>
              GET {catalog.path}?pair=CUSD/NGN. Without a payment header the seller answers 402 with
              the terms. With a signed X-PAYMENT header it answers the rate.
            </p>
          </article>

          <article className="call-card" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
            <h3>What the buyer signs</h3>
            <p>
              One deposit, then off-chain PaymentAuth on every call. The wallet never sends a
              transaction after that. Refusing to ack is the refund: the contract re-checks status
              and latency and reverts on a breach.
            </p>
            <pre className="call-code">{`GET ${catalog.path}?pair=CUSD/NGN
X-PAYMENT: base64({ auth, signature })

# SLA held: POST /x402/ack
# SLA missed: do nothing`}</pre>
          </article>

          <article className="call-card" data-reveal style={{ "--i": 2 } as React.CSSProperties}>
            <h3>Deliberate failure modes</h3>
            <p>
              mode=slow waits 2.5s. mode=broken returns HTTP 500. Both are unpaid, so the ledger
              can show a real miss next to a real payment without a dispute flow.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
