import { short, units } from "../lib/format";
import { MAINNET_PROOF, hasMainnetProof } from "../lib/mainnetProof";
import type { LedgerRow, State, System } from "../lib/types";
import type { Scene } from "../lib/scenes";

interface Props {
  scene: Scene;
  row: LedgerRow | null;
  state: State | null;
  system?: System | null;
}

const COPY: Record<Scene, { title: string; lede: string }> = {
  healthy: {
    title: "The SLA was met. The money moved.",
    lede: "A signed authorization, a signed receipt, an ack. The escrow paid because status and latency both cleared.",
  },
  breach: {
    title: "The SLA was missed. The money never moved.",
    lede: "The buyer did not acknowledge. Nothing was refunded, because nothing was paid. The buyer's nonce did not change.",
  },
  settle: {
    title: "Many calls, one transaction, a tag that cannot be added later.",
    lede: "Settlement is batched. The attribution codes below were decoded from calldata, not read from config.",
  },
  system: {
    title: "What this instance is bound to.",
    lede: "Solvency, SLA terms and the chain id are read from the node on every poll.",
  },
};

export function ProtocolTrace({ scene, row, state, system }: Props) {
  const copy = COPY[scene];
  const budget = state?.sla.maxLatencyMs ?? 800;
  const charged = row ? (row.acked ? units(row.amount) : "0.0000") : "pending";
  const reason =
    row?.verdict?.reason ??
    (row && row.latencyMs > budget ? "latency" : row && row.statusCode !== 200 ? `HTTP ${row.statusCode}` : null);

  return (
    <div className="scene" id={scene === "settle" || scene === "system" ? undefined : scene}>
      <span className="scene-kicker">Judge scene · {scene}</span>
      <h2>{copy.title}</h2>
      <p className="scene-lede">{copy.lede}</p>

      {scene === "system" && (
        <dl className="scene-trace">
          <div>
            <dt>Chain</dt>
            <dd>{system?.chain.chainId ?? "pending"}</dd>
          </div>
          <div>
            <dt>Escrow</dt>
            <dd className="code">{short(system?.contract.escrow ?? state?.escrow ?? "")}</dd>
          </div>
          <div>
            <dt>Solvency</dt>
            <dd>
              {system
                ? system.solvency.ok
                  ? "held ≥ buyer + seller + bond"
                  : "broken"
                : "pending"}
            </dd>
          </div>
          <div>
            <dt>Held / owed</dt>
            <dd>
              {system ? `${units(system.solvency.held)} / ${units(system.solvency.owed)}` : "pending"}
            </dd>
          </div>
        </dl>
      )}

      {scene === "settle" && (
        <dl className="scene-trace">
          <div>
            <dt>Batch size</dt>
            <dd>{system?.settlement.amortisation.at(-1)?.size ?? system?.settlement.callsSettled ?? "pending"}</dd>
          </div>
          <div>
            <dt>Gas / call</dt>
            <dd>{system?.settlement.gasPerCall ?? "pending"}</dd>
          </div>
          <div>
            <dt>Decoded tag</dt>
            <dd className="code">
              {(system?.attribution.verifiedCodes ?? [MAINNET_PROOF.ownCode, MAINNET_PROOF.tag]).join(", ")}
            </dd>
          </div>
          <div>
            <dt>Live settle tx</dt>
            <dd className="code">
              {system?.attribution.verifiedTx ? short(system.attribution.verifiedTx, 8) : "pending"}
            </dd>
          </div>
          {hasMainnetProof() && (
            <>
              <div>
                <dt>Mainnet escrow</dt>
                <dd className="code">{short(MAINNET_PROOF.escrow, 8)}</dd>
              </div>
              <div>
                <dt>Mainnet settle</dt>
                <dd className="code">{short(MAINNET_PROOF.settleTx, 8)}</dd>
              </div>
            </>
          )}
        </dl>
      )}

      {scene !== "system" && scene !== "settle" && !row && (
        <p className="scene-wait">
          No matching call yet. The buyer agent produces one every few seconds once the seller is
          running.
        </p>
      )}

      {scene !== "system" && scene !== "settle" && row && (
        <dl className="scene-trace">
          <div>
            <dt>Request</dt>
            <dd className="code">{short(row.requestId, 8)}</dd>
          </div>
          <div>
            <dt>Endpoint</dt>
            <dd className="code">{short(row.endpointId ?? state?.endpointId ?? "")}</dd>
          </div>
          <div>
            <dt>Buyer</dt>
            <dd className="code">{short(row.buyer)}</dd>
          </div>
          <div>
            <dt>Authorized amount</dt>
            <dd>{units(row.amount)} cUSD</dd>
          </div>
          <div>
            <dt>Requested at</dt>
            <dd className="code">{row.requestedAtMs ?? "pending"}</dd>
          </div>
          <div>
            <dt>Deadline</dt>
            <dd className="code">{row.deadline ?? "pending"}</dd>
          </div>
          <div>
            <dt>Served at</dt>
            <dd className="code">{row.servedAtMs ?? "pending"}</dd>
          </div>
          <div>
            <dt>Attested latency</dt>
            <dd>
              {row.latencyMs}ms against a {budget}ms budget
            </dd>
          </div>
          <div>
            <dt>HTTP status</dt>
            <dd>{row.statusCode}</dd>
          </div>
          <div>
            <dt>Body hash</dt>
            <dd className="code">{short(row.bodyHash ?? "", 8)}</dd>
          </div>
          <div>
            <dt>Verdict</dt>
            <dd>{row.acked ? "SLA met. Paid." : `breached${reason ? ` · ${reason}` : ""}`}</dd>
          </div>
          <div>
            <dt>Charged</dt>
            <dd>{charged} cUSD</dd>
          </div>
          <div>
            <dt>Settlement</dt>
            <dd className="code">{row.settledTxHash ? short(row.settledTxHash, 8) : row.acked ? "queued" : "none. never a payment"}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
