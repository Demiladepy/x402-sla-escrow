/**
 * Generates the agent's Celo mainnet wallet and writes it to .env.
 *
 * The private key is never printed. It goes straight into .env, which is
 * gitignored. Refuses to overwrite an existing key, because doing so would
 * orphan any funds and any ERC-8004 identity already tied to it.
 *
 *   npx tsx scripts/new-agent-wallet.ts
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV_PATH = resolve(process.cwd(), ".env");

function main() {
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";

  if (/^AGENT_PRIVATE_KEY=/m.test(existing)) {
    const current = existing.match(/^AGENT_ADDRESS=(.*)$/m)?.[1]?.trim();
    console.error("AGENT_PRIVATE_KEY is already set in .env — refusing to overwrite.");
    if (current) console.error(`current agent address: ${current}`);
    console.error("Delete that line by hand if you really mean to replace the wallet.");
    process.exit(1);
  }

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  const block = [
    existing.length > 0 && !existing.endsWith("\n") ? "\n" : "",
    "# Agent wallet — Celo mainnet. Hot wallet: keep only what it needs to spend.\n",
    `AGENT_ADDRESS=${account.address}\n`,
    `AGENT_PRIVATE_KEY=${privateKey}\n`,
  ].join("");

  appendFileSync(ENV_PATH, block, { encoding: "utf8" });

  console.log("agent wallet written to .env");
  console.log(`address: ${account.address}`);
  console.log("\nFund this address with a small amount of CELO for gas, then register");
  console.log("the ERC-8004 identity. The private key was not printed.");
}

main();
