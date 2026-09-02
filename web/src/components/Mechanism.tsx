const STEPS = [
  {
    n: "01",
    title: "Buyer deposits once",
    body: "A single on-chain transaction funds the balance. Nothing after this point costs the buyer gas.",
  },
  {
    n: "02",
    title: "Endpoint quotes its terms",
    body: "A 402 response carries the price, the latency budget, the expected status, and the schema the seller is bound to.",
  },
  {
    n: "03",
    title: "Buyer signs, off-chain",
    body: "The request carries a signed authorization in the X-PAYMENT header. A signature, not a transaction.",
  },
  {
    n: "04",
    title: "Seller returns a signed receipt",
    body: "The response carries the served timestamp and status, signed by the seller. Evidence it can be held to.",
  },
  {
    n: "05",
    title: "The escrow checks the work",
    body: "At redemption it re-derives latency and compares status against the advertised terms. A breach reverts.",
    pivot: true,
  },
];

export function Mechanism() {
  return (
    <section className="band" id="mechanism">
      <div className="wrap">
        <div className="band-head">
          <div data-reveal>
            <span className="index">01 — Mechanism</span>
            <h2>The payment is conditional, not reversible.</h2>
          </div>
          <div data-reveal style={{ "--i": 1 } as React.CSSProperties}>
            <p>
              Ordinary escrow makes the wronged party go and ask for its money back. That assumes
              somebody is watching. An agent spending money unattended, thousands of times a day,
              is not.
            </p>
            <p>
              So the money is never sent in the first place. The failure mode becomes inaction,
              which is the one thing an unattended agent is reliably good at.
            </p>
          </div>
        </div>

        <div className="flow">
          {STEPS.map((s, i) => (
            <article
              key={s.n}
              className={`step${s.pivot ? " pivot" : ""}`}
              data-reveal
              style={{ "--i": i } as React.CSSProperties}
            >
              <span className="step-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
