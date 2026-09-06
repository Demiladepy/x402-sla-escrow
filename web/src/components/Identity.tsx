import { AGENT } from "../lib/site";
import { Mark } from "./Mark";

export function Identity() {
  return (
    <section className="band identity" id="agent">
      <div className="wrap identity-inner" data-reveal>
        <Mark size={48} />
        <div>
          <span className="index">Agent</span>
          <h2>ERC-8004 agent 9807.</h2>
          <p>
            A seller that serves paid HTTP under an on-chain SLA, and a buyer that pays per call.
            The wallet on chain 42220 is the identity. Reputation is not claimed until a distinct
            buyer writes it.
          </p>
        </div>
        <dl className="identity-facts">
          <div>
            <dt>Agent</dt>
            <dd>
              <a href={AGENT.url}>8004scan.io/agents/celo/9807</a>
            </dd>
          </div>
          <div>
            <dt>Wallet</dt>
            <dd className="code">{AGENT.wallet}</dd>
          </div>
          <div>
            <dt>Code</dt>
            <dd>
              <a href={AGENT.repo}>Demiladepy/x402-sla-escrow</a>
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
