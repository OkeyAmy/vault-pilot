import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  parseUnits,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";

export class SettlementError extends Error {}

const VAULT_ABI = parseAbi([
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
  "function maxDeposit(address) view returns (uint256)",
  "function maxRedeem(address) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

function rpcUrl(): string {
  return process.env.IXS_RPC_URL ?? "https://bsc-dataseed.binance.org";
}

export function settlementEnabled(): boolean {
  return Boolean(process.env.SETTLEMENT_PRIVATE_KEY);
}

function account() {
  const raw = process.env.SETTLEMENT_PRIVATE_KEY;
  if (!raw) throw new SettlementError("SETTLEMENT_PRIVATE_KEY is not set.");
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new SettlementError("SETTLEMENT_PRIVATE_KEY must be a 32-byte hex key.");
  }
  return privateKeyToAccount(key);
}

function clients() {
  const transport = http(rpcUrl());
  const acct = account();
  return {
    acct,
    publicClient: createPublicClient({ chain: bsc, transport }),
    walletClient: createWalletClient({ account: acct, chain: bsc, transport }),
  };
}

export interface SettlementPosition {
  vaultAddress: string;
  assetAddress: string;
  assetDecimals: number;
  shares: number;
  sharesAsAssets: number;
  walletAssetBalance: number;
  nativeBalanceWei: bigint;
  depositsOpen: boolean;
}

/** Everything needed to decide whether a settlement can proceed. */
export async function readPosition(vaultAddress: string): Promise<SettlementPosition> {
  const { acct, publicClient } = clients();
  const address = vaultAddress as `0x${string}`;

  const [assetAddress, shares, maxDeposit, nativeBalance] = await Promise.all([
    publicClient.readContract({ address, abi: VAULT_ABI, functionName: "asset" }),
    publicClient.readContract({
      address,
      abi: VAULT_ABI,
      functionName: "balanceOf",
      args: [acct.address],
    }),
    publicClient.readContract({
      address,
      abi: VAULT_ABI,
      functionName: "maxDeposit",
      args: [acct.address],
    }),
    publicClient.getBalance({ address: acct.address }),
  ]);

  const assetDecimals = await publicClient.readContract({
    address: assetAddress,
    abi: ERC20_ABI,
    functionName: "decimals",
  });

  const [walletAssetBalance, sharesAsAssets] = await Promise.all([
    publicClient.readContract({
      address: assetAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [acct.address],
    }),
    shares > 0n
      ? publicClient.readContract({
          address,
          abi: VAULT_ABI,
          functionName: "previewRedeem",
          args: [shares],
        })
      : Promise.resolve(0n),
  ]);

  return {
    vaultAddress,
    assetAddress,
    assetDecimals,
    shares: Number(formatUnits(shares, 18)),
    sharesAsAssets: Number(formatUnits(sharesAsAssets, assetDecimals)),
    walletAssetBalance: Number(formatUnits(walletAssetBalance, assetDecimals)),
    nativeBalanceWei: nativeBalance,
    depositsOpen: maxDeposit > 0n,
  };
}

export interface SettlementResult {
  action: "deposit" | "redeem";
  amount: number;
  txHashes: string[];
  blockNumber: number;
}

/**
 * Deposits `assetAmount` of the vault's underlying asset, approving first if
 * the existing allowance is short.
 *
 * This moves real funds on BNB Chain mainnet — IXS publishes no testnet
 * vault. A hard ceiling is enforced so a bad decision cannot drain the
 * wallet, and the caller must opt in explicitly via SETTLEMENT_PRIVATE_KEY.
 */
export async function depositToVault(
  vaultAddress: string,
  assetAmount: number,
): Promise<SettlementResult> {
  const maxPerTx = Number(process.env.SETTLEMENT_MAX_PER_TX ?? 10);
  if (!(assetAmount > 0)) {
    throw new SettlementError(`Deposit amount must be positive, got ${assetAmount}.`);
  }
  if (assetAmount > maxPerTx) {
    throw new SettlementError(
      `Deposit of ${assetAmount} exceeds SETTLEMENT_MAX_PER_TX (${maxPerTx}). ` +
        `Raise the ceiling deliberately if this is intended.`,
    );
  }

  const { acct, publicClient, walletClient } = clients();
  const address = vaultAddress as `0x${string}`;
  const position = await readPosition(vaultAddress);

  if (!position.depositsOpen) {
    throw new SettlementError(`Vault ${vaultAddress} is not accepting deposits.`);
  }
  if (position.walletAssetBalance < assetAmount) {
    throw new SettlementError(
      `Wallet holds ${position.walletAssetBalance} of the underlying asset; ` +
        `needs ${assetAmount}.`,
    );
  }
  if (position.nativeBalanceWei === 0n) {
    throw new SettlementError(`Wallet ${acct.address} has no BNB for gas.`);
  }

  const assets = parseUnits(String(assetAmount), position.assetDecimals);
  const txHashes: string[] = [];

  const allowance = await publicClient.readContract({
    address: position.assetAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [acct.address, address],
  });

  if (allowance < assets) {
    const approveHash = await walletClient.writeContract({
      address: position.assetAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [address, assets],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash, timeout: 120_000 });
    txHashes.push(approveHash);
  }

  const depositHash = await walletClient.writeContract({
    address,
    abi: VAULT_ABI,
    functionName: "deposit",
    args: [assets, acct.address],
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: depositHash,
    timeout: 180_000,
  });
  if (receipt.status !== "success") {
    throw new SettlementError(`Deposit transaction ${depositHash} reverted.`);
  }
  txHashes.push(depositHash);

  return {
    action: "deposit",
    amount: assetAmount,
    txHashes,
    blockNumber: Number(receipt.blockNumber),
  };
}

/** Redeems `shareAmount` vault shares back into the underlying asset. */
export async function redeemFromVault(
  vaultAddress: string,
  shareAmount: number,
): Promise<SettlementResult> {
  const { acct, publicClient, walletClient } = clients();
  const address = vaultAddress as `0x${string}`;

  const held = await publicClient.readContract({
    address,
    abi: VAULT_ABI,
    functionName: "maxRedeem",
    args: [acct.address],
  });
  const shares = parseUnits(String(shareAmount), 18);
  if (shares > held) {
    throw new SettlementError(
      `Cannot redeem ${shareAmount} shares; wallet may redeem at most ${formatUnits(held, 18)}.`,
    );
  }

  const hash = await walletClient.writeContract({
    address,
    abi: VAULT_ABI,
    functionName: "redeem",
    args: [shares, acct.address, acct.address],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") {
    throw new SettlementError(`Redeem transaction ${hash} reverted.`);
  }

  return {
    action: "redeem",
    amount: shareAmount,
    txHashes: [hash],
    blockNumber: Number(receipt.blockNumber),
  };
}
