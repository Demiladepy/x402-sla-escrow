import { useState } from "react";
import { signPayment, type PaymentRequired } from "../lib/playgroundPay";

const PAIRS = ["CUSD/NGN", "CUSD/KES", "CUSD/GHS"];
const BUDGET_MS = 800;

type Mode = "healthy" | "broken" | "slow";

interface Step {
  k: string;
  v: string;
  kind?: "ok" | "bad" | "dim";
}

function ratePath(pair: string, mode: Mode) {
  const q = new URLSearchParams({ pair });
  if (mode === "broken") q.set("mode", "broken");
  if (mode === "slow") q.set("mode", "slow");
  return `/api/rate?${q}`;
}

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

    const path = ratePath(pair, mode);
    push({ k: "GET", v: path, kind: "dim" });

    try {
      const probe = await fetch(path);
      const terms = (await probe.json()) as PaymentRequired & { error?: string };
      if (probe.status !== 402) {
        push({ k: String(probe.status), v: terms.error ?? "expected 402 Payment Required", kind: "bad" });
        setPaid(false);
        setVerdict("The seller did not advertise terms. No payment was signed.");
        return;
      }
      push({
        k: "402",
        v: `Payment Required. 0.001 USDC. HTTP ${terms.sla.expectedStatus}. ${terms.sla.maxLatencyMs}ms.`,
      });

      const payment = await signPayment();
      push({
        k: "X-PAYMENT",
        v: `signed PaymentAuth ${payment.requestId.slice(0, 10)}…. Off-chain. No transaction.`,
        kind: "dim",
      });

      const started = Date.now();
      const res = await fetch(path, { headers: { "x-payment": payment.header } });
      const observed = Date.now() - started;
      const raw = await res.text();
      let body: { pair?: string; rate?: number; error?: string } = {};
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        body = { error: raw };
      }
      const receipt = res.headers.get("x-payment-receipt");
      const overBudget = observed > BUDGET_MS;
      const badStatus = res.status !== 200;

      if (badStatus) {
        push({ k: String(res.status), v: body.error ?? raw, kind: "bad" });
        push({ k: "ack", v: "refused. Charged 0.", kind: "bad" });
        setPaid(false);
        setVerdict("The money never moved. There is nothing to refund.");
      } else if (overBudget) {
        push({
          k: "200",
          v: `${body.pair ?? pair}  ${body.rate ?? ""}  ·  ${observed}ms over an ${BUDGET_MS}ms budget`,
          kind: "bad",
        });
        if (receipt) push({ k: "receipt", v: "seller-signed ServiceReceipt", kind: "dim" });
        push({ k: "ack", v: "refused. Latency missed. Charged 0.", kind: "bad" });
        setPaid(false);
        setVerdict("Late data is free data. The buyer does nothing, and that is the refund.");
      } else {
        push({ k: "200", v: `${body.pair}  ${body.rate}  ·  ${observed}ms`, kind: "ok" });
        push({ k: "receipt", v: "seller-signed ServiceReceipt", kind: "dim" });
        push({ k: "ack", v: "buyer acknowledged. Queued for the seller to settle.", kind: "ok" });
        setPaid(true);
        setVerdict("Charged 0.001. The buyer sent no transaction.");
      }
    } catch (err) {
      push({
        k: "error",
        v: err instanceof Error ? err.message : "the public seller did not answer",
        kind: "bad",
      });
      setPaid(false);
      setVerdict("The call never reached a seller.");
    } finally {
      setBusy(false);
    }
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
              does not acknowledge, so the seller is never paid. The buttons hit a live{" "}
              <code>/api/rate</code>. The page signs. The chain proof is the Sepolia rehearsal
              below, not this form.
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
              <p className="call-wait">No call yet. The log is the HTTP response, not a screenshot of it.</p>
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
