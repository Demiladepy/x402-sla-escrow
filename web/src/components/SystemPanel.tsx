import { short, units } from "../lib/format";
import type { System } from "../lib/types";

interface Props {
  system: System | null;
}

export function SystemPanel({ system }: Props) {
  if (!system) {
    return (
      <div className="sys-empty">
        The chain binding, the solvency invariant and the settlement gas figures are read live from
        the node. They appear when the seller is running.
      </div>
    );
  }

  const { chain, contract, solvency, settlement, attribution } = system;
  const surplus = BigInt(solvency.held) - BigInt(solvency.owed);
  const curve = settlement.amortisation;
  const worst = curve.length > 0 ? Math.max(...curve.map((a) => a.gasPerCall)) : 0;

  return (
    <div className="sys">
      <article className="sys-card" data-reveal>
        <h3>Batching is what makes a 0.001 call viable</h3>
        {settlement.transactions === 0 ? (
          <p className="sys-wait">
            No settlement yet. The seller batches on a 12-second timer, so the first transaction
            covers every call served up to that point.
          </p>
        ) : (
          <>
            <p className="sys-figure">
              {settlement.callsSettled}
              <span className="sys-figure-unit">calls</span>
              <span className="sys-arrow" aria-hidden="true">
                ↦
              </span>
              {settlement.transactions}
              <span className="sys-figure-unit">
                {settlement.transactions === 1 ? "transaction" : "transactions"}
              </span>
            </p>
            <table className="sys-curve">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Seen</th>
                  <th>Gas / call</th>
                </tr>
              </thead>
              <tbody>
                {curve.map((a) => (
                  <tr key={a.size}>
                    <td>
                      {a.size} {a.size === 1 ? "call" : "calls"}
                    </td>
                    <td>{a.batches}×</td>
                    <td>
                      <span className="sys-curve-bar" style={{ width: `${(a.gasPerCall / worst) * 100}%` }} />
                      {a.gasPerCall.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="sys-note">
              Measured from real receipts, not estimated: per-call gas across{" "}
              {settlement.transactions} settlements averages{" "}
              {settlement.gasPerCall?.toLocaleString()}. Each redemption verifies two signatures
              and writes state, so the marginal call is not free. Batching amortises the
              per-transaction overhead, not the per-call work. The buyer pays none of it either
              way.
            </p>
          </>
        )}
      </article>

      <article className="sys-card" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
        <h3>The escrow cannot owe more than it holds</h3>
        <p className={`sys-verdict${solvency.ok ? " ok" : " bad"}`}>
          {solvency.ok ? "Invariant holds" : "Invariant violated"}
        </p>
        <dl className="sys-rows">
          <div>
            <dt>Token held by escrow</dt>
            <dd>{units(solvency.held)}</dd>
          </div>
          <div>
            <dt>Owed: buyer + seller + bond</dt>
            <dd>{units(solvency.owed)}</dd>
          </div>
          <div>
            <dt>Surplus</dt>
            <dd>{units(surplus)}</dd>
          </div>
        </dl>
        <p className="sys-note">
          Recomputed from chain state on every poll, not cached from setup. This is the same
          property the test suite asserts after mixed activity, checked here against a system that
          has been running.
        </p>
      </article>

      <article className="sys-card" data-reveal style={{ "--i": 2 } as React.CSSProperties}>
        <h3>Attribution, decoded from calldata</h3>
        {attribution.verifiedCodes ? (
          <>
            <ul className="sys-codes">
              {attribution.verifiedCodes.map((c) => (
                <li key={c} className="code">
                  {c}
                </li>
              ))}
            </ul>
            <dl className="sys-rows">
              <div>
                <dt>Read back from</dt>
                <dd className="code">{short(attribution.verifiedTx ?? "", 8)}</dd>
              </div>
            </dl>
            <p className="sys-note">
              These were decoded out of a sent transaction's ERC-8021 suffix, not read from
              configuration. The tag travels in calldata, so it cannot be added after the fact.
              That is why it is verified rather than assumed.
            </p>
          </>
        ) : (
          <>
            <ul className="sys-codes">
              {attribution.codes.length > 0 ? (
                attribution.codes.map((c) => (
                  <li key={c} className="code pending">
                    {c}
                  </li>
                ))
              ) : (
                <li className="code pending">none configured</li>
              )}
            </ul>
            <p className="sys-note">
              Configured but not yet confirmed on-chain. Verification runs on the first
              settlement. On Celo mainnet the settler refuses to start without a tag at all.
            </p>
          </>
        )}
      </article>

      <article className="sys-card" data-reveal style={{ "--i": 3 } as React.CSSProperties}>
        <h3>What this instance is bound to</h3>
        <dl className="sys-rows">
          <div>
            <dt>Chain</dt>
            <dd>
              {chain.chainId}
              {chain.chainId === 31337 ? " · anvil" : chain.chainId === 42220 ? " · Celo" : ""}
            </dd>
          </div>
          <div>
            <dt>Block</dt>
            <dd>{Number(chain.blockNumber).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Escrow</dt>
            <dd className="code">{short(contract.escrow)}</dd>
          </div>
          <div>
            <dt>Settlement asset</dt>
            <dd className="code">{short(contract.asset)}</dd>
          </div>
          <div>
            <dt>Schema hash</dt>
            <dd className="code">{short(contract.schemaHash)}</dd>
          </div>
          <div>
            <dt>Challenge window</dt>
            <dd>{Number(contract.challengeWindowSec) / 3600}h</dd>
          </div>
        </dl>
        <p className="sys-note">
          The SLA terms shown throughout this page are read from{" "}
          <span className="code">endpoints(bytes32)</span> on the contract, so they are the terms
          the contract will actually enforce at redemption.
        </p>
      </article>
    </div>
  );
}
