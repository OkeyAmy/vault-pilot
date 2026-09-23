/**
 * Anchor wallet tooling.
 *
 *   pnpm wallet:new     generate a fresh anchoring key
 *   pnpm wallet:status  show the address, chain and funded balance
 *
 * The anchoring wallet only ever signs zero-value testnet transactions whose
 * calldata is a receipt hash. It never holds or moves treasury capital. Keep
 * it separate from any key that does.
 */
import "../src/net-tuning.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatEther } from "viem";
import { baseSepolia, bscTestnet, sepolia, arbitrumSepolia } from "viem/chains";

const CHAINS = {
  [baseSepolia.id]: baseSepolia,
  [bscTestnet.id]: bscTestnet,
  [sepolia.id]: sepolia,
  [arbitrumSepolia.id]: arbitrumSepolia,
} as const;

function chain() {
  const id = Number(process.env.ANCHOR_CHAIN_ID ?? baseSepolia.id);
  const selected = CHAINS[id as keyof typeof CHAINS];
  if (!selected) {
    throw new Error(`ANCHOR_CHAIN_ID ${id} unsupported. Use one of ${Object.keys(CHAINS)}.`);
  }
  return selected;
}

function generate() {
  const key = generatePrivateKey();
  const address = privateKeyToAccount(key).address;
  console.log("New anchoring wallet generated.\n");
  console.log(`  address: ${address}`);
  console.log(`  chain:   ${chain().name} (${chain().id})\n`);
  console.log("Add this line to .env (gitignored, never commit it):\n");
  console.log(`ANCHOR_PRIVATE_KEY=${key}\n`);
  console.log("Then fund the address with testnet gas:");
  console.log("  https://developers.fd.xyz/overview/developer-tools/faucet");
  console.log("  (Base Sepolia also: https://www.alchemy.com/faucets/base-sepolia)\n");
  console.log("Verify with: pnpm wallet:status");
}

async function status() {
  const raw = process.env.ANCHOR_PRIVATE_KEY;
  if (!raw) {
    console.error("ANCHOR_PRIVATE_KEY is not set. Run `pnpm wallet:new` first.");
    process.exit(1);
  }
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error("ANCHOR_PRIVATE_KEY is not a 32-byte hex key.");
    process.exit(1);
  }

  const account = privateKeyToAccount(key);
  const selected = chain();
  const client = createPublicClient({
    chain: selected,
    transport: http(process.env.ANCHOR_RPC_URL ?? selected.rpcUrls.default.http[0]),
  });

  const [balance, blockNumber] = await Promise.all([
    client.getBalance({ address: account.address }),
    client.getBlockNumber(),
  ]);

  console.log(`address:      ${account.address}`);
  console.log(`chain:        ${selected.name} (${selected.id})`);
  console.log(`latest block: ${blockNumber}`);
  console.log(`balance:      ${formatEther(balance)} ${selected.nativeCurrency.symbol}`);

  if (balance === 0n) {
    console.log("\nBalance is zero — anchoring will fail. Fund the address above:");
    console.log("  https://developers.fd.xyz/overview/developer-tools/faucet");
    process.exit(1);
  }
  console.log("\nReady to anchor.");
}

const command = process.argv[2];
if (command === "new") {
  generate();
} else if (command === "status") {
  await status();
} else {
  console.error("Usage: tsx scripts/wallet.ts <new|status>");
  process.exit(1);
}
