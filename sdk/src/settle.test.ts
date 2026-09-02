import { describe, expect, it } from "vitest";
import { fromDataSuffix } from "./attribution.js";
import { createSettler, type SettlerConfig } from "./settle.js";

/**
 * The settler needs a chain id and nothing else to decide whether it is allowed
 * to run, so the surrounding clients are stubbed rather than simulated.
 */
function settlerOn(chainId: number, extra: Partial<SettlerConfig> = {}) {
  return createSettler({
    wallet: { chain: { id: chainId } },
    publicClient: {},
    account: { address: "0x0000000000000000000000000000000000000001" },
    escrow: "0x0000000000000000000000000000000000000002",
    store: { readyForFastPath: () => [], markSettled: () => {} },
    ...extra,
  } as unknown as SettlerConfig);
}

describe("createSettler attribution guard", () => {
  it("refuses to construct on Celo mainnet without attribution", () => {
    // Constructing, not settling: the failure has to arrive before the settler
    // is handed to anything that would send with it.
    expect(() => settlerOn(42220)).toThrow(/refusing to settle on chain 42220/);
  });

  it("constructs on Celo mainnet once codes are supplied", () => {
    const settler = settlerOn(42220, { attributionCodes: ["x402_sla", "celo_abc123"] });
    expect(fromDataSuffix(settler.dataSuffix!)?.codes).toEqual(["x402_sla", "celo_abc123"]);
  });

  it("accepts a pre-encoded suffix on mainnet", () => {
    const settler = settlerOn(42220, { dataSuffix: "0xdeadbeef" });
    expect(settler.dataSuffix).toBe("0xdeadbeef");
  });

  it("treats blank codes as absent rather than as a tag", () => {
    expect(() => settlerOn(42220, { attributionCodes: ["", "  "] })).toThrow(/refusing to settle/);
  });

  it("runs unattributed on a local chain", () => {
    const settler = settlerOn(31337);
    expect(settler.dataSuffix).toBeUndefined();
    expect(settler.attributionCodes).toEqual([]);
  });
});
