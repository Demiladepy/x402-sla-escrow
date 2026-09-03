/**
 * Fills submission-stage fields, then publishes only with --publish.
 *
 *   npm run hack:publish -- --dry-run
 *   npm run hack:publish
 *   npm run hack:publish -- --publish
 *
 * Publish is irreversible before 14 Sep 09:00 UTC. Refuses if socialLink is
 * empty. ownContracts is optional: the entry is judges-favorite, agent 9807 is
 * already on mainnet, and the escrow rehearsal is on Celo Sepolia.
 */
const API = "https://celobuilders.xyz";

function token(): string {
  const t = process.env.CELO_BUILDERS_API_KEY;
  if (!t) throw new Error("CELO_BUILDERS_API_KEY is not set.");
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
  if (!res.ok) throw new Error(`${method} ${path} returned ${res.status}: ${text.slice(0, 800)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const publish = process.argv.includes("--publish");

  const socialLink = process.env.SOCIAL_LINK ?? "";
  const ownContracts = process.env.OWN_CONTRACTS ?? "";
  const appDomain = process.env.APP_DOMAIN ?? "https://web-one-drab-31.vercel.app";
  const otherWallets = process.env.OTHER_WALLETS ?? "";

  const fields = {
    celoNetwork: "celo-mainnet",
    stablecoinsUsed: ["x402 settlement"],
    additionalTrackRationale:
      "Judges' Favorite. Mainnet identity is ERC-8004 agent 9807. The SLA escrow was rehearsed on Celo Sepolia (escrow 0x0d58d053cbaf81e480205c7f942d3d065539abca, settle 0x6ddd02e0d5762b82769d1f476d75bd7f9edd2d8c76e771ba875834f1c9da8794) with attribution x402_sla, celo_5ffb6e9c75fb decoded from calldata. A custom mainnet escrow deploy is not required for this track.",
    appDomain,
    ...(socialLink ? { socialLink } : {}),
    ...(ownContracts ? { ownContracts } : {}),
    ...(otherWallets ? { otherWallets } : {}),
  };

  console.log(JSON.stringify(fields, null, 2));

  if (publish && !socialLink) {
    throw new Error("refusing to publish without SOCIAL_LINK (X post tagging @CeloDevs and @Celo)");
  }

  if (dryRun) {
    console.log("\ndry run: nothing saved.");
    return;
  }

  const current = (await call("GET", "/submissions/me")) as {
    projectName?: string;
    githubUrl?: string;
    trackIds?: string[];
    customFields?: Record<string, unknown>;
  };

  const saved = await call("PUT", "/submissions/me", {
    projectName: current.projectName ?? "SLA-escrowed x402",
    githubUrl: current.githubUrl ?? "https://github.com/Demiladepy/x402-sla-escrow",
    trackIds: current.trackIds ?? ["judges-favorite"],
    customFields: { ...(current.customFields ?? {}), ...fields },
  });
  console.log(`saved. status=${String(saved.status ?? "draft")}`);

  if (!publish) {
    console.log("still draft. Re-run with --publish after the X post is in SOCIAL_LINK.");
    return;
  }

  const published = await call("POST", "/submissions/me/publish", { confirm: true });
  console.log(`published. status=${String(published.status ?? "published")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
