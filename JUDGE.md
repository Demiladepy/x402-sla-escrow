# 90-second judge script

Record against the **public Vercel URL**, not localhost. Masthead links are the chapters.

1. `#healthy`. A call that met the 800ms / HTTP 200 SLA. Charged 0.001. Signed auth and receipt on screen.
2. `#breach`. A call that missed. Charged 0. No refund. Buyer transactions since deposit still 0.
3. `#settle`. One transaction for the paid calls. Attribution decoded from calldata: `x402_sla`, `celo_5ffb6e9c75fb`.
4. `#system`. `held ≥ buyer + seller + bond`. Close on agent [9807](https://8004scan.io/agents/celo/9807) and the escrow address.

Do not add a fifth beat.
