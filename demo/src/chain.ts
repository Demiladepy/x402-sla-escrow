import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

export const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";

/** Anvil's deterministic accounts. Local demo only — these keys are public. */
const ANVIL_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
] as const;

export const deployer = privateKeyToAccount(ANVIL_KEYS[0]);
export const seller = privateKeyToAccount(ANVIL_KEYS[1]);
export const buyer = privateKeyToAccount(ANVIL_KEYS[2]);

export const publicClient = createPublicClient({ chain: foundry, transport: http(RPC_URL) });

export function walletFor(account: ReturnType<typeof privateKeyToAccount>) {
  return createWalletClient({ account, chain: foundry, transport: http(RPC_URL) });
}

interface Artifact {
  abi: Abi;
  bytecode: { object: Hex };
}

/** Reads a Foundry artifact so the demo deploys the same bytecode the tests ran. */
export function artifact(contract: string, file = `${contract}.sol`): Artifact {
  const path = resolve(process.cwd(), "..", "contracts", "out", file, `${contract}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Artifact;
}

export async function deploy(
  contract: string,
  args: unknown[],
  file?: string,
): Promise<{ address: Address; abi: Abi }> {
  const art = artifact(contract, file);
  const wallet = walletFor(deployer);
  const hash = await wallet.deployContract({
    abi: art.abi,
    bytecode: art.bytecode.object,
    args: args as never,
    chain: foundry,
    account: deployer,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error(`${contract} deployment produced no address`);
  return { address: receipt.contractAddress, abi: art.abi };
}
