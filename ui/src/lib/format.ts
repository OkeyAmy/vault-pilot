export function bps(value: number, digits = 1): string {
  return `${value.toFixed(digits)}bps`;
}

export function signedBps(value: number, digits = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}bps`;
}

export function pct(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function apy(apyBps: number): string {
  return `${(apyBps / 100).toFixed(2)}%`;
}

export function usd(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export function costUsd(value: number): string {
  return `$${value.toFixed(5)}`;
}

export function shortHash(hash: string, chars = 10): string {
  return hash.length <= chars * 2 ? hash : `${hash.slice(0, chars)}…${hash.slice(-4)}`;
}

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
