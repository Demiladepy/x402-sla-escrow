/**
 * Saves the Celo Builders registration draft and reports the attribution tag.
 *
 *   npm run hack:register -- --dry-run   # show exactly what would be sent
 *   npm run hack:register                # save
 *   npm run hack:status                  # read the submission back
 *
 * Registration is a draft save, so this is re-runnable. One thing is not: the
 * attribution tag is derived from the GitHub owner/repo slug and locked to the
 * first saved value. Editing the URL later does not re-derive it.
 */
const API = "https://celobuilders.xyz";
const HACKATHON = "agents-at-work";

const SUBMISSION = {
  projectName: "SLA-escrowed x402",
  tagline: "Serving slowly is serving for free.",
  description:
    "Pay-per-call HTTP on Celo where payment is conditional on the response meeting the advertised SLA. A buyer deposits once and signs off-chain. If the call is late or returns the wrong status, the buyer does not acknowledge, the escrow reverts, and the money never moves. No refund. No dispute.\n\n" +
    "Public demo: https://web-one-drab-31.vercel.app\n" +
    "Mainnet identity: ERC-8004 agent 9807 (https://8004scan.io/agents/celo/9807).\n" +
    "Mechanism rehearsal on Celo Sepolia: escrow 0x0d58d053cbaf81e480205c7f942d3d065539abca, settle 0x6ddd02e0d5762b82769d1f476d75bd7f9edd2d8c76e771ba875834f1c9da8794, attribution decoded as x402_sla, celo_5ffb6e9c75fb.",
  githubUrl: "https://github.com/Demiladepy/x402-sla-escrow",
  demoUrl: "https://web-one-drab-31.vercel.app",
  trackIds: ["judges-favorite"],
  customFields: {
    telegram: "@AaAgenDA",
    primaryTrack: "judges-favorite",
    erc8004Url: "https://8004scan.io/agents/celo/9807",
    agentWalletAddress: "0x922184A4702f0DF95fB86C3879BC3eD935b75721",
    country: "Nigeria",
    cpayBetaOptIn: true,
    celoNetwork: "celo-mainnet",
    stablecoinsUsed: ["x402 settlement"],
    additionalTrackRationale:
      "Judges' Favorite. Mainnet identity is ERC-8004 agent 9807. The SLA escrow was rehearsed on Celo Sepolia with attribution decoded from calldata. A custom mainnet escrow deploy is not required for this track.",
    ...(process.env.OWN_CONTRACTS ? { ownContracts: process.env.OWN_CONTRACTS } : {}),
    ...(process.env.SOCIAL_LINK ? { socialLink: process.env.SOCIAL_LINK } : {}),
    appDomain: process.env.APP_DOMAIN ?? "https://web-one-drab-31.vercel.app",
  },
} as const;

function token(): string {
  const t = process.env.CELO_BUILDERS_API_KEY;
  if (!t) throw new Error("CELO_BUILDERS_API_KEY is not set. Add it to .env.");
  return t;
}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Leave it as text; a non-JSON body is itself the useful detail.
  }

  if (!res.ok) {
    throw new Error(`${method} ${path} returned ${res.status}: ${text.slice(0, 800)}`);
  }
  return parsed as Record<string, unknown>;
}

/** Fails before saving if the repo the tag will be derived from is not public. */
async function assertRepoPublic(url: string) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`${url} returned HTTP ${res.status}. The tag locks to this slug — fix it first.`);
  }
  if (res.url.replace(/\/$/, "") !== url.replace(/\/$/, "")) {
    // A rename redirect would leave the tag bound to a slug that only resolves
    // while GitHub keeps redirecting it.
    throw new Error(`${url} redirects to ${res.url}. Register the canonical URL instead.`);
  }
}

function reportTag(submission: Record<string, unknown>) {
  const tag = submission.attributionTag;
  if (typeof tag !== "string" || tag.length === 0) {
    console.log("\nNo attributionTag in the response yet. Re-run `npm run hack:status`.");
    return;
  }

  console.log(`\nattributionTag: ${tag}`);
  console.log("\nAdd to .env — the settler refuses to run on mainnet without it:");
  console.log(`  CELO_ATTRIBUTION_TAG=${tag}`);
}

async function main() {
  const status = process.argv.includes("--status");
  const dryRun = process.argv.includes("--dry-run");

  if (status) {
    const me = await call("GET", "/submissions/me");
    console.log(JSON.stringify(me, null, 2));
    reportTag(me);
    return;
  }

  console.log(`hackathon: ${HACKATHON}`);
  console.log(JSON.stringify(SUBMISSION, null, 2));

  await assertRepoPublic(SUBMISSION.githubUrl);
  console.log(`\nrepo is public and canonical: ${SUBMISSION.githubUrl}`);

  const who = await call("GET", "/participants/me");
  console.log(`connected as: ${who.name} <${who.email}>`);

  if (dryRun) {
    console.log("\ndry run: nothing saved. Re-run without --dry-run to register.");
    return;
  }

  const saved = await call("PUT", "/submissions/me", SUBMISSION);
  console.log("\nsaved.");
  reportTag(saved);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
