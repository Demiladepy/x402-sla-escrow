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
| `web/` + `demo/` | Live dashboard over a running system. Hash scenes `#healthy` `#breach` `#settle` `#system` pin a protocol trace. `demo/src/run.ts` is the scripted walkthrough; `demo/src/serve.ts` is the long-running traffic generator. |

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
the ledger so columns compare down a row.

Motion is GSAP 3.15. The dependency was already listed; the page was still
static because `enableMotion()` was never called, so the CSS gate that hides
pre-reveal content never matched and CSS keyframes still drove the background.
That is now wired before React paints. Atmosphere runs on `gsap.ticker` (and
sleeps with `gsap.globalTimeline` when the tab is hidden). Reveals go through
a named `gsap.effects.revealUp`. The headline is SplitText, clipped per line.
Scroll is `ScrollToPlugin`. New ledger rows fade in after the first paint;
history does not replay. Reduced-motion users never take the hidden-until-animated
path, so a failed bundle cannot leave the page blank.

### Second pass: showing the engineering, not describing it

The first version read as a marketing page because the parts that prove
anything were thin, and because with the seller stopped the whole live section
collapsed into em-dashes. Both are fixed.

`/api/system` was added to the seller and reports what the system knows about
itself, read from the chain and from transaction receipts rather than from the
seller's own bookkeeping:

| Surface | What it shows |
|---|---|
| Latency distribution | Every call served, log-bucketed, with the SLA budget on a bucket boundary so no column straddles the line the payment stops at. p50/p95/p99 and the slowest call that still got paid. |
| Amortisation curve | Gas per call grouped by batch size, from real receipts. Measured 175,708 → 164,391 → 160,863 as batches grew 2 → 3 → 4. |
| Solvency invariant | `held ≥ buyer + seller + bond`, recomputed from chain state every poll — the same property the test suite asserts, checked against a system that has been running. |
| Attribution | The codes decoded out of a sent transaction's calldata, with the tx they came from. |
| Chain binding | Chain id, block, escrow, asset, schema hash and challenge window read from `endpoints(bytes32)`. |

Three corrections worth recording:

- The first draft compared batched gas against 231k from
  `test_Unilateral_PendsThenClaims`. That is the *unilateral two-transaction*
  path, not the fast path, so it overstated the saving. Replaced with the
  measured curve, which makes the honest point: batching amortises the
  per-transaction overhead, not the per-call signature and storage work.
- The hero was a giant numeral over a small label — the pattern the design
  guidance calls a template, and the reason a missing value rendered as a
  7rem em-dash that looked like a broken asset. It is now a sentence with the
  figures set inline, so the fallback can be an honest clause.
- `Math.max(...rows)` throws once the array passes ~65k arguments, and the
  ledger grows for as long as the demo runs. Replaced with a reduce.

Known gap: `/api/ledger` returns the full history on every 1.5s poll, so a demo
left running for hours sends a large payload repeatedly. Fine for a demo, wrong
for anything longer.

## Registration groundwork (done)

Decisions taken: primary track `judges-favorite`, buy closed beta opted in,
repo to be renamed `x402-sla-escrow` before the first save so the attribution
tag locks to a permanent URL rather than a GitHub rename redirect.

| Piece | State |
|---|---|
| Agent wallet | `0x922184A4702f0DF95fB86C3879BC3eD935b75721`. Generated by `npm run agent:wallet`, key written straight to gitignored `.env` and never printed. The script refuses to overwrite an existing key. |
| `agent.json` | ERC-8004 registration file. Declares one `wallet` endpoint on chain 42220. `supportedTrust` is empty until a non-owner buyer posts `giveFeedback` on agent 9807 (`npm run agent:feedback`). Claiming reputation without that write would be a lie. |
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

## Sepolia runbook (dress rehearsal) — executed

Same commands as mainnet, pointed at chain 11142220. First live send reused the
already-deployed escrow after Circle USDC's non-zero-to-non-zero approve rule
was handled. Attribution decoded on-chain, not string-matched.

```
# 1. TOKEN must be a Sepolia address. Default in the script is Sepolia USDC.
TOKEN=0x01C5C0122039549AD1493B8220cABEdD739BC44E

# 2. Refuse if TOKEN and chain disagree
npm run escrow:deploy -- sepolia --dry-run

# 3. Full path: deploy, register, deposit, healthy, breach, settle, decode tag
npm run rehearse:sepolia -- --dry-run
npm run rehearse:sepolia
# Resume a prior deploy without broadcasting another:
#   ESCROW=0x0d58d053cbaf81e480205c7f942d3d065539abca npm run rehearse:sepolia
```

| Step | Result |
|---|---|
| Escrow | `0x0d58d053cbaf81e480205c7f942d3d065539abca` |
| Deploy tx | `0x09316e33d7737c364cf7e309e50db8b7899190efd98a298d5853c47977f150ed` |
| Healthy | paid=true, 26ms, HTTP 200 |
| Breach | paid=false, HTTP 500, charged 0 |
| Settle | `0x6ddd02e0d5762b82769d1f476d75bd7f9edd2d8c76e771ba875834f1c9da8794` (1 call) |
| Tag | verified — `x402_sla`, `celo_5ffb6e9c75fb` |

Mainnet session is the same with `TOKEN=0x765DE816845861e75A25fCA122bb6898B8B1282a` and
`npm run settle:mainnet -- --dry-run` then `--broadcast`. Defaults to dry-run.
Do not run `serve.ts` against mainnet.

Env block for that sitting:

```
TOKEN=0x765DE816845861e75A25fCA122bb6898B8B1282a
CELO_RPC_URL=https://forno.celo.org
CELO_ATTRIBUTION_TAG=celo_5ffb6e9c75fb
ATTRIBUTION_CODE=x402_sla
FEE_CURRENCY=   # unset — pay gas in CELO
```

## Hosting

The public site is [web-one-drab-31.vercel.app](https://web-one-drab-31.vercel.app/). Do not create a second Vercel project. `appDomain` on the draft is that URL.

When no seller is reachable the page shows the **Celo Sepolia rehearsal**, read back from chain 11142220 (escrow `0x0d58…abca`, settle `0x6ddd…8794`). Judge scenes `#healthy` `#breach` `#settle` `#system` work on that snapshot. A live seller at `VITE_SELLER_URL` replaces it.

Local `vite` still proxies `/api` to `127.0.0.1:4021`. `#settle` can also show baked-in mainnet hashes via `VITE_MAINNET_ESCROW` / `VITE_MAINNET_SETTLE_TX`.

## Judge path (90 seconds)

The masthead is the script. Do not scroll the argument.

1. `#healthy`. One paid call: signed auth, attested latency, charged the price.
2. `#breach`. One unpaid call: which check failed, charged 0, buyer nonce unchanged.
3. `#settle`. Batch size, gas per call, attribution decoded from calldata (`x402_sla`, `celo_5ffb6e9c75fb`).
4. `#system`. Solvency `held ≥ buyer + seller + bond`, chain id, escrow address.

Record the video against the Vercel URL in that order. Close on agent 9807 and the escrow address.

## Blocked, and on what

| Blocker | Needs |
|---|---|
| Mainnet cUSD | Agent `0x922184A4702f0DF95fB86C3879BC3eD935b75721` holds **0 cUSD** on chain 42220 (0.36 CELO). Send $5–10, then `npm run agent:balance -- mainnet` and `npm run settle:mainnet -- --broadcast`. |
| Buyer feedback | Buyer key generated: `0xC10E4E1fBf1A32DCF56433cD83012784593cfd24`. Needs a little mainnet CELO, then `npm run agent:feedback`. `supportedTrust` stays empty until that write lands. |
| Public URL | [https://web-one-drab-31.vercel.app/](https://web-one-drab-31.vercel.app/). Celo asked us to hold mainnet spend while they fix a bug. |
| Publishing | `SOCIAL_LINK` (X post tagging @CeloDevs and @Celo), `OWN_CONTRACTS` after the mainnet settle, then `npm run hack:publish -- --publish` before 14 Sep 09:00 UTC. |

## Not done deliberately

- No mainnet deploy yet: the wallet still holds 0 cUSD. Sepolia is rehearsal only.
- Submission is a draft, not published. Drafts appear on the leaderboard flagged
  ineligible; publishing needs the X post and is a deliberate, later step.
- `supportedTrust` is empty. The give-feedback script is ready (`BUYER_PRIVATE_KEY`)
  and refuses if the signer is the agent owner.
