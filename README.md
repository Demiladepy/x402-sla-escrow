# SLA-escrowed x402

**Pay-per-call payments for agents, where the payment is conditional on the response actually meeting the endpoint's advertised SLA.**

Built on Celo, settled in cUSD.

---

## The problem

[x402](https://x402.celo.org) makes HTTP requests payable. It does not make them *accountable*. Today both sides are asked to trust the other:

- The **buyer** pays and hopes a real response comes back.
- The **seller** serves and hopes the payment lands.

A human can shrug that off and file a support ticket. An agent spending money unattended, thousands of times a day, cannot. Right now the only protection against paying for a timeout, a 500, or a page of garbage is that somebody eventually notices.

This makes the SLA part of the payment instead of part of the marketing.

## How it works

A seller advertises an endpoint together with the terms it will be held to — price, maximum latency, expected HTTP status, and the schema its responses satisfy — and posts a **bond** backing that promise.

```
buyer                         seller                        SLAEscrow
  |                              |                              |
  |-- GET /api/rate ------------>|                              |
  |<-- 402 + terms --------------|                              |
  |                              |                              |
  |-- GET + X-PAYMENT ---------->|  (signed PaymentAuth)        |
  |                              |                              |
  |<-- 200 + X-PAYMENT-RECEIPT --|  (signed ServiceReceipt)     |
  |                              |                              |
  |-- ack (only if SLA met) ---->|                              |
  |                              |-- redeemWithAck ------------>|
  |                              |                     re-checks status,
  |                              |                     latency, signatures
```

Four properties fall out of that shape:

**The buyer never sends a transaction to pay.** It deposits once, then signs an off-chain `PaymentAuth` per call, carried in the `X-PAYMENT` header. A call costs the buyer zero gas. Settlement is the seller's job, and it batches.

**The seller cannot be paid without evidence of service.** Every redemption carries a `ServiceReceipt` the seller signed. `SLAEscrow` enforces the objective half of the SLA itself: the status must equal the advertised status, and `servedAt - requestedAt` must be inside the advertised latency budget. Miss either and the redemption **reverts**. Serving slowly is serving for free.

**A breach needs no refund, no dispute, and no arbiter.** There is nothing to claw back, because the money never moved. That is the part worth pausing on: the usual escrow design makes the wronged party go and *ask* for its money. Here the failure mode is inaction, which is the one thing an unattended agent is reliably good at.

**Forgery is priced, not merely forbidden.** Receipts are self-signed, so a seller could invent one. Two paths make that irrational:

| | fast path (`redeemWithAck`) | unilateral path (`redeem`) |
|---|---|---|
| when | the buyer counter-signed | buyer offline or withholding |
| speed | funds move immediately | held for the challenge window |
| seller's bond | untouched | exposed to slashing |

Forging a receipt to steal one call's revenue puts a bond worth 100x that revenue at risk. The expected value is deeply negative, so honest sellers use the unilateral path and forgers do not.

### What is trustless, and what is bonded

Being precise about this, because the distinction is the whole design:

| SLA term | enforcement |
|---|---|
| HTTP status | **on-chain**, objectively, every redemption |
| latency | **on-chain** against signed timestamps; jointly attested on the fast path |
| response body matches schema | **optimistic** — challengeable within the window, with bonds on both sides |

Body correctness is not objectively checkable on-chain, so it is not pretended to be. The buyer may challenge by posting its own bond; an arbiter resolves; the loser's stake pays the winner. Neither garbage responses nor spurious challenges are free.

The honest limitation: `servedAtMs` is the seller's own clock. On the fast path this does not matter, because the buyer refuses to acknowledge a receipt that contradicts its own measurement, and an unacknowledged call cannot take the fast path. On the unilateral path it is seller-attested with the bond as collateral. v1 uses a single arbiter key; see [Roadmap](#roadmap).

## Quickstart

Requires [Foundry](https://book.getfoundry.sh/getting-started/installation) and Node 20+.

```bash
git clone --recurse-submodules <this repo>
cd x402-sla-escrow
npm install
forge test --root contracts
npm run demo
```

The demo spins up a local chain, deploys the escrow, stands up a seller serving an FX rate feed at a tenth of a cent per call, and makes three calls: one healthy, one deliberately slow, one deliberately broken. It prints what each cost.

The buyer's transaction nonce is shown before and after. It does not move.

### Live dashboard

For a running system with continuous traffic and a web dashboard:

```bash
anvil                              # terminal 1
npm run serve --workspace demo     # terminal 2 — seller + a buyer agent that keeps calling
npm run dev --workspace web        # terminal 3 — dashboard on :5173
```

Roughly one call in four hits a degraded endpoint, so the ledger shows real breaches alongside real settlements. The stat to watch is **buyer transactions since deposit**, which stays at zero no matter how many calls are made.

## Integration

**Seller** — wrap the route:

```ts
app.get("/api/rate", slaEndpoint({
  account: sellerAccount,
  escrow: ESCROW_ADDRESS,
  chainId: 42220,
  endpointId,
  asset: CUSD,
  price: parseUnits("0.001", 18),
  maxLatencyMs: 800,
  schemaHash,
  store,
}, async (req) => getRate(req.query.pair)));
```

**Buyer** — a `fetch` that pays:

```ts
const client = createBuyerClient({ account, escrow: ESCROW_ADDRESS, chainId: 42220 });

const res = await client.call("https://api.example.com/api/rate?pair=CUSD/NGN");

if (!res.verdict.ok) {
  // Nothing was paid. res.verdict.detail says why.
}
```

**Settle** — batch what you are owed:

```ts
const settler = createSettler({ wallet, publicClient, account, escrow, store, dataSuffix });
settler.start(15_000);
```

## Attribution

`createSettler` takes a `dataSuffix` that is appended to every settlement's calldata as an ERC-8021 attribution tag.

Wire it in **before your first transaction**. The tag lives in the calldata, so it cannot be added afterwards and there is no backfill — anything settled without it is permanently uncounted. Then verify the first settlement really carries it:

```ts
const { present, calldata } = await settler.verifyAttribution(txHash);
```

## Layout

```
contracts/    SLAEscrow.sol, deploy scripts, 30 Foundry tests
sdk/          buyer client, seller middleware, batching settler
demo/         end-to-end walkthrough on a local chain
```

## Roadmap

- **Arbiter decentralisation.** v1 resolves challenges with a single key, which is a real trust assumption and named as one. The natural path is a staked committee with a fraud-proof window, then schema verification pushed on-chain for the subset of schemas cheap enough to check.
- **Payment channels.** Deposits amortise gas across calls; channels would amortise it across *counterparties*.
- **Reputation from settlement history.** Every settled call is a signed, on-chain statement about latency. That is a public, un-fakeable track record, and it should feed endpoint discovery.

## License

MIT
