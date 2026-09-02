/**
 * ERC-8021 attribution, wrapped so the one irreversible mistake is hard to make.
 *
 * The tag travels in calldata. That means it cannot be attached to a transaction
 * after the fact and there is no backfill: value settled without it is counted
 * for nobody, permanently. Every helper here exists to move that failure from
 * "discovered at judging" to "discovered before the first send".
 *
 * Encoding is delegated to `@celo/attribution-tags` rather than hand-rolled,
 * because a suffix that is merely well-formed-looking still reads as absent to
 * whatever indexes it.
 */
import { fromDataSuffix, toDataSuffix, verifyTx } from "@celo/attribution-tags";
import type { Hex } from "viem";

export { ERC_8021_MARKER, codeFromHostname, fromDataSuffix, toDataSuffix, verifyTx } from "@celo/attribution-tags";
export type { DecodedSuffix } from "@celo/attribution-tags";

/** Chains where a missing tag is an unrecoverable loss rather than a nuisance. */
const ATTRIBUTION_REQUIRED_CHAINS = new Set([42220]);

export interface AttributionConfig {
  /**
   * Codes to embed. Multiple are allowed and the common case is two: your own
   * project code plus the tag an event assigned you.
   */
  codes: readonly string[];
}

/**
 * Builds the calldata suffix for one or more attribution codes.
 *
 * Empty and blank codes are rejected instead of silently encoded, since a
 * suffix carrying an empty string is indistinguishable from a wiring bug at the
 * point where it matters.
 */
export function buildDataSuffix(codes: string | readonly string[]): Hex {
  const list = (typeof codes === "string" ? [codes] : codes).map((c) => c.trim());

  if (list.length === 0) throw new Error("attribution: no codes given");
  const blank = list.findIndex((c) => c.length === 0);
  if (blank !== -1) throw new Error(`attribution: code at index ${blank} is empty`);

  return toDataSuffix(list) as Hex;
}

/**
 * Resolves the suffix to use for a chain, refusing to proceed when the chain is
 * one where omitting it costs something that cannot be recovered.
 *
 * Returns `undefined` on chains where attribution is meaningless (anvil, local
 * forks) so tests and demos need no special-casing.
 */
export function resolveDataSuffix(opts: {
  chainId: number;
  codes?: readonly string[];
}): Hex | undefined {
  const codes = (opts.codes ?? []).filter((c) => c.trim().length > 0);

  if (codes.length === 0) {
    if (ATTRIBUTION_REQUIRED_CHAINS.has(opts.chainId)) {
      throw new Error(
        `attribution: refusing to settle on chain ${opts.chainId} without an attribution tag.\n` +
          `The tag lives in calldata and cannot be added later, so this transaction would be\n` +
          `permanently uncounted. Set CELO_ATTRIBUTION_TAG (and optionally ATTRIBUTION_CODE)\n` +
          `in the environment, or pass codes explicitly.`,
      );
    }
    return undefined;
  }

  return buildDataSuffix(codes);
}

/** Reads codes from the environment, in the order they should be encoded. */
export function attributionCodesFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.ATTRIBUTION_CODE, env.CELO_ATTRIBUTION_TAG]
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    .map((c) => c.trim());
}

export interface AttributionCheck {
  /** True only if the suffix decoded and every expected code is present. */
  ok: boolean;
  /** Codes actually found on-chain, decoded rather than string-matched. */
  codes: string[];
  schemaId: number | null;
  missing: string[];
  calldata: Hex;
}

/**
 * Decodes the attribution actually recorded on a sent transaction.
 *
 * Deliberately decodes instead of comparing the tail of the calldata to the
 * suffix we meant to send: the question worth answering is "what will an indexer
 * read off this transaction", and only decoding answers that.
 */
export async function checkTxAttribution(args: {
  client: { getTransaction(a: { hash: Hex }): Promise<{ input?: string } | null | undefined> };
  hash: Hex;
  expect?: readonly string[];
}): Promise<AttributionCheck> {
  const tx = await args.client.getTransaction({ hash: args.hash });
  const calldata = (tx?.input ?? "0x") as Hex;

  const decoded = fromDataSuffix(calldata);
  const codes = decoded?.codes ?? [];
  const expect = (args.expect ?? []).map((c) => c.trim()).filter((c) => c.length > 0);
  const missing = expect.filter((c) => !codes.includes(c));

  return {
    ok: decoded !== null && missing.length === 0 && codes.length > 0,
    codes,
    schemaId: decoded?.schemaId ?? null,
    missing,
    calldata,
  };
}
