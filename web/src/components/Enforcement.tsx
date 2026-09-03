const ROWS = [
  {
    term: "HTTP status",
    kind: "chain" as const,
    label: "On-chain",
    note: "Compared against the advertised status at every redemption. Objective, and checked by the contract.",
  },
  {
    term: "Latency",
    kind: "chain" as const,
    label: "On-chain",
    note: "Derived from signed timestamps and compared to the budget. Jointly attested on the fast path.",
  },
  {
    term: "Response body matches schema",
    kind: "bonded" as const,
    label: "Bonded",
    note: "Not checkable on-chain, so it is not pretended to be. Challengeable within the window, with a bond posted on both sides.",
  },
];

export function Enforcement() {
  return (
    <section className="band" id="enforcement">
      <div className="wrap">
        <div className="band-head">
          <div data-reveal>
            <span className="index">03 Trust boundary</span>
            <h2>What is trustless, and what is merely bonded.</h2>
          </div>
          <div data-reveal style={{ "--i": 1 } as React.CSSProperties}>
            <p>
              Being precise about this is the whole design. Two of the three SLA terms are decided
              by the contract. The third cannot be, so it is priced instead, and labelled as such.
            </p>
            <p>
              Forging a receipt to steal one call's revenue puts a bond worth many times that
              revenue at risk. Forgery is not forbidden, it is made irrational.
            </p>
          </div>
        </div>

        <div className="enforce" data-reveal>
          <div className="enforce-row head">
            <span>SLA term</span>
            <span>Enforcement</span>
            <span>How</span>
          </div>
          {ROWS.map((r) => (
            <div className="enforce-row" key={r.term}>
              <span className="enforce-term">{r.term}</span>
              <span>
                <span className={`badge ${r.kind}`}>{r.label}</span>
              </span>
              <span className="enforce-note">{r.note}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
