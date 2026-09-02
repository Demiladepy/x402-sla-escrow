import { describe, expect, it } from "vitest";
import {
  attributionCodesFromEnv,
  buildDataSuffix,
  checkTxAttribution,
  fromDataSuffix,
  resolveDataSuffix,
} from "./attribution.js";

const CELO_MAINNET = 42220;
const ANVIL = 31337;

describe("buildDataSuffix", () => {
  it("round-trips a single code", () => {
    const suffix = buildDataSuffix("x402_sla");
    expect(fromDataSuffix(suffix)?.codes).toEqual(["x402_sla"]);
  });

  it("preserves the order of multiple codes", () => {
    const suffix = buildDataSuffix(["x402_sla", "celo_abc123"]);
    expect(fromDataSuffix(suffix)?.codes).toEqual(["x402_sla", "celo_abc123"]);
  });

  it("rejects an empty code instead of encoding a blank", () => {
    expect(() => buildDataSuffix(["x402_sla", ""])).toThrow(/index 1 is empty/);
    expect(() => buildDataSuffix(["  "])).toThrow(/index 0 is empty/);
    expect(() => buildDataSuffix([])).toThrow(/no codes given/);
  });

  it("rejects codes the on-chain format cannot represent", () => {
    // Uppercase and dashes are the shape of a claim code, not a tag. Failing
    // loudly here is what stops a claim code being pasted in by mistake.
    expect(() => buildDataSuffix("CELO-U46A5-KUAJB")).toThrow(/invalid code/);
  });
});

describe("resolveDataSuffix", () => {
  it("refuses to settle on Celo mainnet with no codes", () => {
    expect(() => resolveDataSuffix({ chainId: CELO_MAINNET, codes: [] })).toThrow(
      /refusing to settle on chain 42220/,
    );
    // Whitespace is not a tag.
    expect(() => resolveDataSuffix({ chainId: CELO_MAINNET, codes: ["  "] })).toThrow(
      /refusing to settle/,
    );
  });

  it("allows local chains with no codes, so demos need no special-casing", () => {
    expect(resolveDataSuffix({ chainId: ANVIL, codes: [] })).toBeUndefined();
  });

  it("encodes when codes are present on mainnet", () => {
    const suffix = resolveDataSuffix({ chainId: CELO_MAINNET, codes: ["x402_sla"] });
    expect(fromDataSuffix(suffix!)?.codes).toEqual(["x402_sla"]);
  });
});

describe("attributionCodesFromEnv", () => {
  it("puts the project code before the assigned tag", () => {
    expect(
      attributionCodesFromEnv({
        ATTRIBUTION_CODE: "x402_sla",
        CELO_ATTRIBUTION_TAG: "celo_abc123",
      } as NodeJS.ProcessEnv),
    ).toEqual(["x402_sla", "celo_abc123"]);
  });

  it("drops absent and blank values", () => {
    expect(
      attributionCodesFromEnv({ ATTRIBUTION_CODE: "x402_sla", CELO_ATTRIBUTION_TAG: "" } as NodeJS.ProcessEnv),
    ).toEqual(["x402_sla"]);
    expect(attributionCodesFromEnv({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe("checkTxAttribution", () => {
  const clientReturning = (input: string) => ({
    getTransaction: async () => ({ input }),
  });

  it("decodes the codes actually present in calldata", async () => {
    const suffix = buildDataSuffix(["x402_sla", "celo_abc123"]);
    const check = await checkTxAttribution({
      client: clientReturning(`0xdeadbeef${suffix.slice(2)}`),
      hash: "0x0",
      expect: ["x402_sla", "celo_abc123"],
    });

    expect(check.ok).toBe(true);
    expect(check.codes).toEqual(["x402_sla", "celo_abc123"]);
    expect(check.missing).toEqual([]);
  });

  it("reports the specific code that is missing", async () => {
    const suffix = buildDataSuffix("x402_sla");
    const check = await checkTxAttribution({
      client: clientReturning(`0xdeadbeef${suffix.slice(2)}`),
      hash: "0x0",
      expect: ["x402_sla", "celo_abc123"],
    });

    expect(check.ok).toBe(false);
    expect(check.missing).toEqual(["celo_abc123"]);
  });

  it("does not pass a transaction that carries no suffix", async () => {
    const check = await checkTxAttribution({
      client: clientReturning("0xdeadbeef"),
      hash: "0x0",
      expect: ["x402_sla"],
    });

    expect(check.ok).toBe(false);
    expect(check.codes).toEqual([]);
  });

  it("is not fooled by calldata that merely ends in the right bytes", async () => {
    // The naive check is `calldata.endsWith(suffix)`. A suffix sitting in an
    // argument rather than after the marker must not read as attributed, and
    // an unmarked tail must not either.
    const check = await checkTxAttribution({
      client: clientReturning("0xdeadbeef78343032"),
      hash: "0x0",
      expect: ["x402_sla"],
    });

    expect(check.ok).toBe(false);
  });
});
