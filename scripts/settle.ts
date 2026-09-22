/**
 * Real settlement against an IXS vault.
 *
 *   pnpm settle status              position, balances, whether deposits are open
 *   pnpm settle deposit <amount>    deposit underlying asset into the vault
 *   pnpm settle redeem  <shares>    redeem shares back to the underlying asset
 *
 * These move real funds on BNB Chain mainnet — IXS publishes no testnet
 * vault. Nothing here runs automatically: the scheduler never settles.
 */
import { formatEther } from "viem";
import { loadPolicy } from "../src/config/load-policy.js";
import {
  readPosition,
  depositToVault,
  redeemFromVault,
  settlementEnabled,
} from "../src/vaults/ixs-settlement.js";

function vaultAddress(): string {
  const vault = loadPolicy().vaults.find((v) => v.source === "ixs" && v.address);
  if (!vault?.address) {
    throw new Error('No vault with source "ixs" and an address in the policy.');
  }
  return vault.address;
}

async function status() {
  const address = vaultAddress();
  const position = await readPosition(address);
  console.log(`vault:            ${address} (BNB Chain)`);
  console.log(`underlying asset: ${position.assetAddress}`);
  console.log(`deposits open:    ${position.depositsOpen}`);
  console.log(`wallet asset bal: ${position.walletAssetBalance}`);
  console.log(`vault shares:     ${position.shares}`);
  console.log(`  worth:          ${position.sharesAsAssets} of the underlying`);
  console.log(`native (gas):     ${formatEther(position.nativeBalanceWei)} BNB`);

  if (position.nativeBalanceWei === 0n) {
    console.log(`\nNo BNB for gas — a deposit would fail.`);
  }
  if (position.walletAssetBalance === 0) {
    console.log(`No underlying asset held — fund the wallet before depositing.`);
  }
}

const [command, rawAmount] = process.argv.slice(2);

if (!settlementEnabled()) {
  console.error(
    "SETTLEMENT_PRIVATE_KEY is not set. Settlement is opt-in because it moves real funds.",
  );
  process.exit(1);
}

if (command === "status") {
  await status();
} else if (command === "deposit" || command === "redeem") {
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error(`Usage: pnpm settle ${command} <positive amount>`);
    process.exit(1);
  }
  const address = vaultAddress();
  const result =
    command === "deposit"
      ? await depositToVault(address, amount)
      : await redeemFromVault(address, amount);

  console.log(`${result.action} of ${result.amount} confirmed in block ${result.blockNumber}`);
  for (const hash of result.txHashes) {
    console.log(`  https://bscscan.com/tx/${hash}`);
  }
  console.log();
  await status();
} else {
  console.error("Usage: pnpm settle <status|deposit|redeem> [amount]");
  process.exit(1);
}
