import { Dashboard } from "./components/Dashboard";
import { Enforcement } from "./components/Enforcement";
import { Hero } from "./components/Hero";
import { Mechanism } from "./components/Mechanism";
import { useLedger } from "./lib/useLedger";
import { useReveal } from "./lib/useReveal";

export default function App() {
  const { rows, state, system, error, fresh, settled } = useLedger();
  useReveal();

  return (
    <>
      <div className="ambient" aria-hidden="true" />
      <div className="grid-field" aria-hidden="true" />

      <div className="page">
        <header className="masthead">
          <div className="wrap masthead-inner">
            <div className="wordmark">
              SLA-escrowed <span>x402</span>
            </div>
            <nav>
              <a href="#mechanism">Mechanism</a>
              <a href="#enforcement">Trust boundary</a>
              <a href="#ledger">Live ledger</a>
            </nav>
            <span className="live">
              <span className={`dot${fresh ? "" : settled ? " stale" : " waiting"}`} />
              {fresh ? "live" : settled ? "offline" : "connecting"}
            </span>
          </div>
        </header>

        <main>
          <Hero state={state} callCount={rows.length} settled={settled} />
          <Mechanism />
          <Enforcement />
          <Dashboard
            rows={rows}
            state={state}
            system={system}
            error={error}
            settled={settled}
          />
        </main>

        <footer className="foot">
          <div className="wrap foot-inner">
            <span>Built on Celo. Settled in cUSD.</span>
            <a href="https://github.com/Demiladepy/x402-sla-escrow">
              github.com/Demiladepy/x402-sla-escrow
            </a>
          </div>
        </footer>
      </div>
    </>
  );
}
