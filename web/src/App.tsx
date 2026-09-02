import { Atmosphere } from "./components/Atmosphere";
import { Dashboard } from "./components/Dashboard";
import { Enforcement } from "./components/Enforcement";
import { Hero } from "./components/Hero";
import { Mechanism } from "./components/Mechanism";
import { scrollToId } from "./lib/motion";
import { useLedger } from "./lib/useLedger";
import { useReveal } from "./lib/useReveal";

function InPage({ href, children }: { href: `#${string}`; children: string }) {
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        scrollToId(href);
      }}
    >
      {children}
    </a>
  );
}

export default function App() {
  const { rows, state, system, error, fresh, settled } = useLedger();
  // Re-bind when live sections appear: SystemPanel and the ledger are not in
  // the first paint, and a one-shot query would leave them permanently hidden.
  useReveal([settled, rows.length > 0, Boolean(system)]);

  return (
    <>
      <Atmosphere />

      <div className="page">
        <header className="masthead">
          <div className="wrap masthead-inner">
            <div className="wordmark">
              SLA-escrowed <span>x402</span>
            </div>
            <nav>
              <InPage href="#mechanism">Mechanism</InPage>
              <InPage href="#enforcement">Trust boundary</InPage>
              <InPage href="#ledger">Live ledger</InPage>
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
