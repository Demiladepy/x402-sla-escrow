# Project status

Working log for the Agents at Work hackathon entry. Records what exists, what is
verified, and what is still blocked. Updated as things land.

## Built

| Area | State |
|---|---|
| `contracts/src/SLAEscrow.sol` | Complete. Deposit-once buyers, off-chain signed `PaymentAuth`, seller-signed `ServiceReceipt`, on-chain status + latency enforcement, fast path (`redeemWithAck`) and unilateral path (`redeem`) with bond exposure, bonded/challengeable schema correctness. |
| `contracts/test/SLAEscrow.t.sol` | 30 tests passing: latency fuzzing, forged-signature and replay cases, challenge game both directions, bond invariants, solvency check. |
| `contracts/script/Deploy.s.sol` | `Deploy` reads `TOKEN` from env (no hardcoded stablecoin address). `DeployLocal` is anvil-only and deploys `MockERC20`. |
| `sdk/` | Buyer client (`fetch` that pays), seller middleware, batching settler with ERC-8021 attribution and fee abstraction. |
| `sdk/src/attribution.ts` | ERC-8021 encoding via `@celo/attribution-tags`, a mainnet guard, and on-chain verification that decodes rather than string-matches. 18 tests. |
| `web/` + `demo/` | Live dashboard over a running system. `demo/src/run.ts` is the scripted three-call walkthrough; `demo/src/serve.ts` is the long-running traffic generator. |

## Verified

- Pushed to `https://github.com/Demiladepy/x402-sla-escrow`, public and current
  with `origin/main`, so it satisfies the "public repo must resolve at judging"
  rule. `agent.json` returns HTTP 200 from `raw.githubusercontent.com`, which is
  the precondition the register script checks.
- 48 tests green: 30 Solidity (`npm run test:contracts`) and 18 TypeScript
  (`npm run test:sdk`). `npm test` runs both.
- Local demo run: 82 calls, 22 deliberately degraded. Buyer charged 0.0580
  instead of 0.0820. The difference never left the buyer's balance. No refund,
  no dispute. Buyer transactions since deposit: 0.
- Scripted demo re-run after the attribution rewiring: 3 calls, 1 paid, buyer
  nonce unchanged at 4 since the deposit.

### Agent wallet funding, read from chain

`npm run agent:balance` checks both networks and names the chain id, because
"I sent it" and "it arrived on the chain that counts" are different claims.

| Network | Holds |
|---|---|
| Celo mainnet (42220) | 0.4 CELO — enough for the ERC-8004 mint many times over |
| Celo Sepolia (11142220) | 1 CELO, 20 USDC — rehearsal only, counts for nothing |

## Fixed after the first end-to-end run

`demo/src/serve.ts` did its on-chain setup — mint, seller approve,
`registerEndpoint`, buyer approve, buyer deposit — before calling `app.listen`.
A second instance started against the same chain therefore spent money and only
*then* discovered the port was taken, leaving a stray deposit and bond behind.
Locally this only skewed the dashboard's headline number; on a real network it
would be a duplicated deposit and a duplicated bond in real stablecoin.

The port is now reserved before any transaction is sent and released
immediately before the real listen. Verified: a duplicate start fails with
`port 4021 is already serving` and the buyer's nonce does not move.

Worth knowing about the dashboard metric: **buyer transactions since deposit**
is computed from the buyer's *global account nonce* against a snapshot taken
after setup. That is the strong form of the claim — it shows the buyer did
nothing at all, not merely nothing to the escrow — but it means any unrelated
activity from that wallet inflates it. The buyer wallet has to stay dedicated
for the number to mean what it says.

## Known weak points

Documented rather than hidden:

- The arbiter is a single key in v1. It only affects schema disputes; status and
  latency stay trustless.
- `servedAtMs` is the seller's own clock on the unilateral path. The bond is what
  makes lying irrational there, not cryptography. On the fast path it does not
  matter, because the buyer will not acknowledge a receipt contradicting its own
  measurement.

## Hackathon facts (read from the API, not from memory)

Slug `agents-at-work`. Window 28 Aug 2026 → **14 Sep 2026 09:00 UTC**, which is
both the end and the submission deadline. Leaderboard:
`https://dune.com/celo/agents-at-work-hackathon`.

**Celo mainnet only.** `celoNetwork` accepts exactly one value,
`celo-mainnet`. Testnet activity counts for nothing in every track, so a Celo
Sepolia deploy is development scaffolding and nothing more.

### Registration-stage required fields

Registration is a first-draft save. These gate it:

| Field | Notes |
|---|---|
| `projectName` | top-level |
| `githubUrl` | top-level, must be public `github.com/owner/repo`. Attribution tag is derived from the `owner/repo` slug and **locked at first save**. |
| `telegram` | personal handle, pattern `^@?[a-zA-Z0-9_]{5,32}$` |
| `primaryTrack` | one of `value-moved`, `real-world-adoption`, `askbots-growth`, `judges-favorite`, `cpay-feedback` |
| `erc8004Url` | ERC-8004 Agent ID URL, host must be `8004scan.io` or `celoscan.io` |
| `agentWalletAddress` | Celo mainnet address the agent transacts from. Every leaderboard reads zero until this is on file. |
| `country` | optional |
| `cpayBetaOptIn` | optional; required to enter the buy feedback track |

Submission-stage (later, gate publishing only): `socialLink` (X post tagging
@CeloDevs and @Celo), `celoNetwork`, plus optional `otherWallets`,
`ownContracts`, `additionalTrackRationale`, `stablecoinsUsed`,
`cpayFeedbackIssueUrl`, `appDomain`.

### Attribution

The registration response returns `attributionTag` (`celo_` + 12 hex). Only that
assigned tag is credited. A self-derived code is not. It must be in the calldata
when the transaction is sent — there is no backfill.

```ts
const tag = toDataSuffix([ourOwnCode, assignedTag]) // assigned tag must be present
```

x402 facilitator settlements are submitted by the relayer and **cannot** carry
the tag, so they are attributed by `agentWalletAddress` instead. That attribution
is retroactive across the window; the tag is not.

### Tracks and prizes

| Track | Bounties |
|---|---|
| `value-moved` | $1,500 / $500 — adjusted volume between independent parties, gated on distinct signers |
| `real-world-adoption` | $1,000 Best Real World Adoption, $750 Best Stablecoin Adoption |
| `judges-favorite` | $500 — panel choice, innovation on Celo primitives with a real distribution channel |
| `askbots-growth` | $300 / $150 / $50 — measured improvement between two review rounds |
| `cpay-feedback` | $250 pool, five × $50 |

### Audit order (applied after the Dune query ranks)

1. Pre-existing wallet history — did the counterparty transact on Celo before 28 Aug?
2. First-funder collapse — does the whole user base trace to one funding wallet?
3. Spawn-window clustering — were the wallets created in one burst?
4. Self-similarity scoring on submitted text.

Then 48 hours right of reply before anything public.

## Track reasoning

`judges-favorite` is the strongest primary fit. The track exists explicitly
because "a genuinely strong project last hackathon fit none of the tracks and won
nothing," and it is decided by the panel rather than by a volume query.

The volume tracks are a poor fit on arithmetic: the endpoint is priced at 0.001
per call, so 82 calls moved 0.08. `value-moved` ranks on adjusted volume and is
gated on distinct signers, and micropayment unit economics cannot compete there.

Two things worth noting for later:

- The track description names **fee abstraction** (gas paid in an ERC-20) as an
  under-used primitive that gets a judge's attention. The settler is the only
  component that sends transactions, so paying its gas in the settlement
  stablecoin via `feeCurrency` is a contained change.
- The Best Stablecoin Adoption bounty ($750) scores highest for USAT over x402,
  or cNGN and Ripio wFIAT used anywhere on Celo. `SLAEscrow` takes any ERC-20
  via constructor, and the demo already quotes CUSD/NGN, CUSD/KES, CUSD/GHS — so
  deploying against cNGN is a configuration choice, not a rewrite.

## Dashboard rebuild

`web/` is now a single page that opens with the argument and scrolls into the
live ledger, rather than a bare dashboard. Design context and the reasoning
behind the palette and type choices live in `.impeccable.md`.

Deliberately *not* a copy of the reference site that prompted it: the reference
is a marketing homepage, this has to be live operational proof, and a
recognisable clone would undercut the innovation the panel is judging. What
carried over is the atmosphere — ambient drifting light behind a still
foreground, oversized confident type, one orchestrated reveal per section.

Palette is near-black tinted toward Celo's yellow hue with Celo yellow as a
rare accent, spent on the number being proven. Type is Archivo at expanded
widths for display against Schibsted Grotesk for body, with tabular figures in
the ledger so columns compare down a row. No new dependencies: motion is CSS,
reveals use one `IntersectionObserver`.

## Registration groundwork (done)

Decisions taken: primary track `judges-favorite`, buy closed beta opted in,
repo to be renamed `x402-sla-escrow` before the first save so the attribution
tag locks to a permanent URL rather than a GitHub rename redirect.

| Piece | State |
|---|---|
| Agent wallet | `0x922184A4702f0DF95fB86C3879BC3eD935b75721`. Generated by `npm run agent:wallet`, key written straight to gitignored `.env` and never printed. The script refuses to overwrite an existing key. |
| `agent.json` | ERC-8004 registration file. Declares one `wallet` endpoint on chain 42220 and `reputation` trust. No invented A2A or MCP endpoints — it claims only what exists. |
| `scripts/register-8004.ts` | Mints the identity via `register(string)` on the Identity Registry proxy `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, then reads the agent id from the `Registered` event. Verified against the implementation ABI (`IdentityRegistryUpgradeable` at `0x7274e874CA62410a93Bd8bf61c69d8045E399c02`). |
| `.env.example` | Documents every variable, including Celo mainnet cUSD `0x765DE816845861e75A25fCA122bb6898B8B1282a` for `TOKEN`. |

The register script checks, in order, that `AGENT_URI` resolves, that it
describes an `Agent`, and that the wallet holds CELO — all before it sends
anything. Confirmed it currently stops at the 404 without touching the chain.

## Attribution, made hard to get wrong

The tag is the one mistake with no remedy: it travels in calldata, so it cannot
be attached after a send and there is no backfill. Three changes make omitting
or corrupting it loud rather than silent.

**It fails at construction, not at send.** `createSettler` resolves attribution
when it is built. On chain 42220 with no codes it throws, so the failure lands
before the settler is handed to anything that could spend with it. Local chains
return `undefined` and stay quiet, so the demo needs no special-casing.

**Encoding is Celo's, not ours.** `@celo/attribution-tags` does the ERC-8021
encoding. Its code format is `/^[a-z0-9_]{1,32}$/`, which means a Celo Builders
*claim* code — uppercase and dashed — is rejected outright instead of being
encoded into something no indexer will credit. That specific confusion is what
the test `rejects codes the on-chain format cannot represent` pins down.

**Verification decodes.** `verifyAttribution` reads the transaction back and
decodes the suffix, answering "what will an indexer see" rather than "does the
calldata end in the bytes we meant to send". The earlier `endsWith` check would
pass on calldata that merely happened to end in those bytes; there is now a test
asserting that case fails.

Codes come from the environment in a fixed order — `ATTRIBUTION_CODE` first,
then `CELO_ATTRIBUTION_TAG` — and both demos report on the first settlement
whether the tag was actually found on-chain.

`feeCurrency` is also plumbed through the settler now, so the fee-abstraction
angle the `judges-favorite` track calls out is one environment variable rather
than a code change.

## Registered

Both mainnet steps are done and the attribution loop is closed.

| Item | Value |
|---|---|
| ERC-8004 Agent ID | **9807**, minted on Celo mainnet |
| Mint transaction | `0x6074cf866f7cf4fd53753d94d0ef6518726055c5208da0cf4f594829a1fb19ce` |
| Cost | 0.0407 CELO actual against a 0.0494 estimate; 0.3593 CELO left |
| `erc8004Url` | `https://8004scan.io/agents/celo/9807` — HTTP 200, as is the Celoscan form |
| Submission | `SLA-escrowed x402`, status `draft`, primary track `judges-favorite` |
| **`attributionTag`** | **`celo_5ffb6e9c75fb`** — locked to `Demiladepy/x402-sla-escrow` |

The repo URL was checked for a rename redirect before saving, because the tag
derives from the slug and binds to whatever was saved first. It is canonical, so
the tag is not dependent on GitHub continuing to forward an old name.

Verified end to end rather than assumed: a settlement was sent, read back, and
decoded to `x402_sla, celo_5ffb6e9c75fb`. Same code path mainnet will take.

`npm run hack:status` reads the submission back, including the tag on file.

## Blocked, and on what

| Blocker | Needs |
|---|---|
| Mainnet deploy | `TOKEN` chosen, funded deployer, `ARBITER` decided |
| Independent users | Counterparties with Celo activity from before 28 Aug, not funded by us. Still the biggest judge-facing gap: the mechanism is built, the distribution channel is not. |
| Publishing | Submission-stage fields, chiefly `socialLink` (an X post tagging @CeloDevs and @Celo) and `ownContracts` once anything is deployed |

## Not done deliberately

- No mainnet deploy, so nothing is pointed at a real stablecoin by accident.
- Submission is a draft, not published. Drafts appear on the leaderboard flagged
  ineligible; publishing needs the X post and is a deliberate, later step.
