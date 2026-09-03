/**
 * Generates a buyer key distinct from the agent, for ERC-8004 giveFeedback.
 *
 * The owner cannot rate itself. This wallet is the one that paid (or will pay)
 * for calls. The private key is never printed.
 *
 *   npm run buyer:wallet
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV_PATH = resolve(process.cwd(), ".env");

function main() {
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";

  if (/^BUYER_PRIVATE_KEY=/m.test(existing)) {
    console.error("BUYER_PRIVATE_KEY is already set in .env — refusing to overwrite.");
    process.exit(1);
  }

  const owner = existing.match(/^AGENT_ADDRESS=(.*)$/m)?.[1]?.trim().toLowerCase();
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  if (owner && account.address.toLowerCase() === owner) {
    throw new Error("generated the agent address; re-run.");
  }

  const block = [
    existing.length > 0 && !existing.endsWith("\n") ? "\n" : "",
    "# Buyer wallet — distinct from the agent. Needed for giveFeedback.\n",
    `BUYER_ADDRESS=${account.address}\n`,
    `BUYER_PRIVATE_KEY=${privateKey}\n`,
  ].join("");

  appendFileSync(ENV_PATH, block, { encoding: "utf8" });
  console.log("buyer wallet written to .env");
  console.log(`address: ${account.address}`);
  console.log("Fund this address with a little CELO on Celo mainnet before `npm run agent:feedback`.");
}

main();
