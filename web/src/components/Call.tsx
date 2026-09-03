import { useState } from "react";

const RATES: Record<string, number> = {
  "CUSD/NGN": 1587.42,
  "CUSD/KES": 129.18,
  "CUSD/GHS": 15.63,
};

const PAIRS = Object.keys(RATES);
const BUDGET_MS = 800;

type Mode = "healthy" | "broken" | "slow";

interface Step {
  k: string;
  v: string;
  kind?: "ok" | "bad" | "dim";
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function Call() {
  const [pair, setPair] = useState(PAIRS[0]);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [paid, setPaid] = useState<boolean | null>(null);

  async function run(mode: Mode) {
    if (busy) return;
    setBusy(true);
    setVerdict(null);
    setPaid(null);
    const log: Step[] = [];
    const push = (step: Step) => {
      log.push(step);
      setSteps([...log]);
    };

    push({ k: "GET", v: `/api/rate?pair=${pair}`, kind: "dim" });
    await wait(200);
    push({ k: "402", v: "Payment Required. 0.001. HTTP 200. 800ms." });
    await wait(240);
    push({ k: "X-PAYMENT", v: "signed PaymentAuth. Off-chain. No transaction.", kind: "dim" });

    if (mode === "broken") {
      await wait(160);
      push({ k: "500", v: "upstream rate provider unavailable", kind: "bad" });
      push({ k: "ack", v: "refused. Charged 0.", kind: "bad" });
      setPaid(false);
      setVerdict("The money never moved. There is nothing to refund.");
    } else if (mode === "slow") {
      await wait(920);
      push({ k: "200", v: `${pair}  ${RATES[pair]}  ·  920ms over an 800ms budget`, kind: "bad" });
      push({ k: "ack", v: "refused. Latency missed. Charged 0.", kind: "bad" });
      setPaid(false);
      setVerdict("Late data is free data. The buyer does nothing, and that is the refund.");
    } else {
      await wait(160);
      push({ k: "200", v: `${pair}  ${RATES[pair]}  ·  18ms`, kind: "ok" });
      push({ k: "receipt", v: "seller-signed ServiceReceipt", kind: "dim" });
      push({ k: "ack", v: "buyer acknowledged. Queued for the seller to settle.", kind: "ok" });
      setPaid(true);
      setVerdict("Charged 0.001. The buyer sent no transaction.");
    }

    setBusy(false);
  }

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
              Price is 0.001. The SLA is HTTP 200 inside {BUDGET_MS}ms. Miss either and the buyer
              does not acknowledge, so the seller is never paid. Press a button. That is the
              product.
            </p>
          </div>
        </div>

        <div className="call-stage">
          <article className="call-card" data-reveal>
            <h3>Pairs</h3>
            <ul className="call-pairs">
              {PAIRS.map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    className={`call-pair${p === pair ? " on" : ""}`}
                    onClick={() => setPair(p)}
                    disabled={busy}
                  >
                    {p}
                  </button>
                </li>
              ))}
            </ul>
            <p>
              GET /api/rate?pair={pair}. Without a payment header the seller answers 402 with the
              terms. With a signed X-PAYMENT header it answers the rate.
            </p>
            <dl className="call-terms">
              <div>
                <dt>Price</dt>
                <dd>0.001</dd>
              </div>
              <div>
                <dt>SLA</dt>
                <dd>HTTP 200 / {BUDGET_MS}ms</dd>
              </div>
              <div>
                <dt>Refund</dt>
                <dd>do nothing</dd>
              </div>
            </dl>
          </article>

          <article className="call-run" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
            <h3>Run a call</h3>
            <div className="call-actions">
              <button type="button" className="call-btn" disabled={busy} onClick={() => void run("healthy")}>
                Meet the SLA
              </button>
              <button type="button" className="call-btn" disabled={busy} onClick={() => void run("broken")}>
                Miss: HTTP 500
              </button>
              <button type="button" className="call-btn" disabled={busy} onClick={() => void run("slow")}>
                Miss: latency
              </button>
            </div>

            {steps.length === 0 ? (
              <p className="call-wait">No call yet. The log is the HTTP dance, not a screenshot of it.</p>
            ) : (
              <ol className="call-log">
                {steps.map((s, i) => (
                  <li key={`${s.k}-${i}`} className={s.kind ?? ""}>
                    <span className="call-k">{s.k}</span>
                    <span className="call-v">{s.v}</span>
                  </li>
                ))}
              </ol>
            )}

            {verdict && (
              <p className={`call-verdict${paid ? " ok" : " bad"}`}>{verdict}</p>
            )}
          </article>
        </div>
      </div>
    </section>
  );
}