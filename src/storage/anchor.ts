import { createWalletClient, createPublicClient, http, defineChain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, bscTestnet, sepolia, arbitrumSepolia } from "viem/chains";

export interface AnchorResult {
  txHash: string;
  blockNumber: number;
  chainId: number;
}

export class AnchorError extends Error {}

/**
 * Anchor targets, keyed by chain id. These are the testnets the Finance
 * District faucet funds, so the anchoring wallet can always be topped up.
 * The chain is selected by ANCHOR_CHAIN_ID and must agree with whatever
 * ANCHOR_RPC_URL points at — signing for the wrong chain id would produce
 * a transaction the target chain rejects.
 */
const SUPPORTED_CHAINS = {
  [baseSepolia.id]: { chain: baseSepolia, explorer: "https://sepolia.basescan.org/tx/" },
  [bscTestnet.id]: { chain: bscTestnet, explorer: "https://testnet.bscscan.com/tx/" },
  [sepolia.id]: { chain: sepolia, explorer: "https://sepolia.etherscan.io/tx/" },
  [arbitrumSepolia.id]: {
    chain: arbitrumSepolia,
    explorer: "https://sepolia.arbiscan.io/tx/",
  },
} as const;

const DEFAULT_CHAIN_ID = baseSepolia.id;

function selectedChain() {
  const raw = process.env.ANCHOR_CHAIN_ID;
  const chainId = raw ? Number(raw) : DEFAULT_CHAIN_ID;
  const entry = SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS];
  if (!entry) {
    throw new AnchorError(
      `ANCHOR_CHAIN_ID ${chainId} is not supported. Supported: ` +
        `${Object.keys(SUPPORTED_CHAINS).join(", ")}.`,
    );
  }
  return entry;
}

export function explorerUrl(txHash: string): string {
  return `${selectedChain().explorer}${txHash}`;
}

export function anchoringEnabled(): boolean {
  return Boolean(process.env.ANCHOR_PRIVATE_KEY);
}

function account() {
  const raw = process.env.ANCHOR_PRIVATE_KEY;
  if (!raw) {
    throw new AnchorError("ANCHOR_PRIVATE_KEY is not set.");
  }
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new AnchorError("ANCHOR_PRIVATE_KEY must be a 32-byte hex private key.");
  }
  return privateKeyToAccount(key);
}

function rpcUrl(): string {
  return process.env.ANCHOR_RPC_URL ?? selectedChain().chain.rpcUrls.default.http[0];
}

export function anchorAddress(): string {
  return account().address;
}

/**
 * Writes a receipt hash onchain as transaction calldata, timestamping the
 * decision. A self-send of zero value keeps this cheap and contract-free —
 * the payload is the point, not the transfer. The resulting tx is what
 * `verify.py --rpc` re-reads to prove the local receipt existed at the
 * block's timestamp and has not been rewritten since.
 */
export async function anchorReceiptHash(receiptHash: string): Promise<AnchorResult> {
  const acct = account();
  const { chain } = selectedChain();
  const transport = http(rpcUrl());

  const walletClient = createWalletClient({ account: acct, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  const payload = `0x${receiptHash}` as Hex;
  if (!/^0x[0-9a-f]{64}$/.test(payload)) {
    throw new AnchorError(`receiptHash is not a 32-byte hex digest: ${receiptHash}`);
  }

  const txHash = await walletClient.sendTransaction({
    to: acct.address,
    value: 0n,
    data: payload,
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: 120_000,
  });

  if (receipt.status !== "success") {
    throw new AnchorError(`Anchor transaction ${txHash} reverted.`);
  }

  return {
    txHash,
    blockNumber: Number(receipt.blockNumber),
    chainId: chain.id,
  };
}

export async function anchorBalanceWei(): Promise<bigint> {
  const publicClient = createPublicClient({
    chain: selectedChain().chain,
    transport: http(rpcUrl()),
  });
  return publicClient.getBalance({ address: account().address });
}
