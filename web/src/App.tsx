import { useEffect } from "react";
import { Atmosphere } from "./components/Atmosphere";
import { Dashboard } from "./components/Dashboard";
import { Enforcement } from "./components/Enforcement";
import { Hero } from "./components/Hero";
import { Mechanism } from "./components/Mechanism";
import { scrollToId } from "./lib/motion";
import { useHashScene } from "./lib/useHash";
import { useLedger } from "./lib/useLedger";
import { useReveal } from "./lib/useReveal";
import { APP_DOMAIN } from "./lib/site";

function InPage({ href, children }: { href: `#${string}`; children: string }) {
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        if (window.location.hash !== href) window.location.hash = href;
        scrollToId(href);
      }}
    >
      {children}
    </a>
  );
}

export default function App() {
  const { rows, state, system, error, fresh, settled } = useLedger();
  const scene = useHashScene();
  // Re-bind when live sections appear: SystemPanel and the ledger are not in
  // the first paint, and a one-shot query would leave them permanently hidden.
  useReveal([settled, rows.length > 0, Boolean(system)]);

  useEffect(() => {
    if (!scene || !settled) return;
    const t = window.setTimeout(() => scrollToId(`#${scene}`), 80);
    return () => window.clearTimeout(t);
  }, [scene, settled]);

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
              <InPage href="#healthy">Healthy</InPage>
              <InPage href="#breach">Breach</InPage>
              <InPage href="#settle">Settle</InPage>
              <InPage href="#system">System</InPage>
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
            scene={scene}
          />
        </main>

        <footer className="foot">
          <div className="wrap foot-inner">
            <span>Built on Celo. Settled in cUSD.</span>
            <span className="foot-links">
              {APP_DOMAIN ? (
                <a href={APP_DOMAIN}>{APP_DOMAIN.replace(/^https:\/\//, "")}</a>
              ) : null}
              <a href="https://github.com/Demiladepy/x402-sla-escrow">
                github.com/Demiladepy/x402-sla-escrow
              </a>
            </span>
          </div>
        </footer>
      </div>
    </>
  );
}
