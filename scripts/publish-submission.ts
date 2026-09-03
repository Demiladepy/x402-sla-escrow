/**
 * Fills submission-stage fields, then publishes only with --publish.
 *
 *   npm run hack:publish -- --dry-run
 *   npm run hack:publish
 *   npm run hack:publish -- --publish
 *
 * Publish is irreversible before 14 Sep 09:00 UTC. Refuses if socialLink,
 * ownContracts, or appDomain are still empty.
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
  const appDomain = process.env.APP_DOMAIN ?? "";
  const otherWallets = process.env.OTHER_WALLETS ?? "";

  const fields = {
    celoNetwork: "celo-mainnet",
    stablecoinsUsed: ["USDm / Mento", "x402 settlement"],
    ...(socialLink ? { socialLink } : {}),
    ...(ownContracts ? { ownContracts } : {}),
    ...(appDomain ? { appDomain } : {}),
    ...(otherWallets ? { otherWallets } : {}),
  };

  console.log(JSON.stringify(fields, null, 2));

  const missing = [
    !socialLink && "SOCIAL_LINK (X post tagging @CeloDevs and @Celo)",
    !ownContracts && "OWN_CONTRACTS (mainnet escrow address)",
    !appDomain && "APP_DOMAIN (public URL)",
  ].filter(Boolean);
  if (publish && missing.length > 0) {
    throw new Error(`refusing to publish with empty fields:\n  ${missing.join("\n  ")}`);
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
    console.log("still draft. Re-run with --publish after the video is up and the mainnet tx is visible.");
    return;
  }

  const published = await call("POST", "/submissions/me/publish", { confirm: true });
  console.log(`published. status=${String(published.status ?? "published")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
