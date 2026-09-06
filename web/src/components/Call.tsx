import { useState } from "react";
import { signPayment, type PaymentRequired } from "../lib/playgroundPay";

const PAIRS = ["CUSD/NGN", "CUSD/KES", "CUSD/GHS"];
const BUDGET_MS = 800;
const GHOST = [
  { k: "GET", v: "/api/rate" },
  { k: "402", v: "terms" },
  { k: "X-PAYMENT", v: "signed PaymentAuth" },
  { k: "200", v: "rate · latency" },
  { k: "ack", v: "or refused" },
];

type Mode = "healthy" | "broken" | "slow";

interface Step {
  k: string;
  v: string;
  kind?: "ok" | "bad" | "dim";
}

interface Meter {
  ms: number;
  paid: boolean;
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
  const [phase, setPhase] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [paid, setPaid] = useState<boolean | null>(null);
  const [meter, setMeter] = useState<Meter | null>(null);

  async function run(mode: Mode) {
    if (busy) return;
    setBusy(true);
    setPhase("asking for terms");
    setVerdict(null);
    setPaid(null);
    setMeter(null);
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
        v: `0.001 USDC · HTTP ${terms.sla.expectedStatus} · ${terms.sla.maxLatencyMs}ms`,
      });

      setPhase("signing off-chain");
      const payment = await signPayment();
      push({
        k: "X-PAYMENT",
        v: `${payment.requestId.slice(0, 10)}… · no transaction`,
        kind: "dim",
      });

      setPhase("waiting on the seller");
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
      setMeter({ ms: observed, paid: !badStatus && !overBudget });

      if (badStatus) {
        push({ k: String(res.status), v: body.error ?? raw, kind: "bad" });
        push({ k: "ack", v: "refused · charged 0", kind: "bad" });
        setPaid(false);
        setVerdict("The money never moved. There is nothing to refund.");
      } else if (overBudget) {
        push({
          k: "200",
          v: `${body.pair ?? pair}  ${body.rate ?? ""}  ·  ${observed}ms over ${BUDGET_MS}ms`,
          kind: "bad",
        });
        if (receipt) push({ k: "receipt", v: "seller-signed ServiceReceipt", kind: "dim" });
        push({ k: "ack", v: "refused · latency · charged 0", kind: "bad" });
        setPaid(false);
        setVerdict("Late data is free data. The buyer does nothing.");
      } else {
        push({ k: "200", v: `${body.pair}  ${body.rate}  ·  ${observed}ms`, kind: "ok" });
        push({ k: "receipt", v: "seller-signed ServiceReceipt", kind: "dim" });
        push({ k: "ack", v: "acknowledged · charged 0.001", kind: "ok" });
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
      setPhase(null);
    }
  }

  const fill = meter ? Math.min(100, (meter.ms / BUDGET_MS) * 100) : 0;

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
              does not acknowledge, so the seller is never paid. These buttons hit a live seller.
              The page signs. The chain proof is the Sepolia rehearsal below, not this form.
            </p>
          </div>
        </div>

        <div className="call-deck" data-reveal>
          <div className="call-toolbar">
            <div className="call-pairs" role="group" aria-label="Currency pair">
              {PAIRS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`call-pair${p === pair ? " on" : ""}`}
                  onClick={() => setPair(p)}
                  disabled={busy}
                >
                  {p}
                </button>
              ))}
            </div>
            <dl className="call-terms">
              <div>
                <dt>Price</dt>
                <dd>0.001</dd>
              </div>
              <div>
                <dt>SLA</dt>
                <dd>200 / {BUDGET_MS}ms</dd>
              </div>
              <div>
                <dt>Refund</dt>
                <dd>do nothing</dd>
              </div>
            </dl>
          </div>

          <div className="call-actions">
            <button
              type="button"
              className="call-btn primary"
              disabled={busy}
              onClick={() => void run("healthy")}
            >
              Meet the SLA
            </button>
            <button type="button" className="call-btn" disabled={busy} onClick={() => void run("broken")}>
              Miss: HTTP 500
            </button>
            <button type="button" className="call-btn" disabled={busy} onClick={() => void run("slow")}>
              Miss: latency
            </button>
            {phase ? <span className="call-phase">{phase}</span> : null}
          </div>

          <ol className={`call-log${steps.length === 0 ? " ghost" : ""}`}>
            {(steps.length === 0 ? GHOST : steps).map((s, i) => (
              <li key={`${s.k}-${i}`} className={"kind" in s ? (s.kind ?? "") : ""}>
                <span className="call-k">{s.k}</span>
                <span className="call-v">{s.v}</span>
              </li>
            ))}
          </ol>

          <div className={`call-meter${meter ? (meter.paid ? " ok" : " bad") : ""}`}>
            <span className="call-meter-ms">
              {meter ? `${meter.ms}ms` : "—"}
            </span>
            <span className="call-meter-track">
              <i style={{ width: `${fill}%` }} />
              <b aria-hidden="true" />
            </span>
            <span className="call-meter-cap">{BUDGET_MS}ms</span>
          </div>

          {verdict ? (
            <p className={`call-verdict${paid ? " ok" : " bad"}`}>{verdict}</p>
          ) : (
            <p className="call-wait">
              Press a button. The log is the HTTP response, not a screenshot of it.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
