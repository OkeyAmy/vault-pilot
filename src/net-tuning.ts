import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

/**
 * Node's Happy Eyeballs implementation gives each candidate address only
 * 250ms to complete its TCP handshake before moving on, and reports
 * `ETIMEDOUT` once the list is exhausted. `fetch()` surfaces that as the
 * bare string "fetch failed", with no indication that the cause was a slow
 * link rather than a bad request.
 *
 * On any connection whose round-trip time is comparable to that budget —
 * congested Wi-Fi, mobile tethering, a distant upstream — every outbound
 * call fails in roughly half a second while the network is in fact fine.
 * Widening the budget costs nothing on a fast link, because the first
 * address still wins immediately.
 */
const DEFAULT_ATTEMPT_TIMEOUT_MS = 5000;

const configured = Number(process.env.NET_CONNECT_ATTEMPT_TIMEOUT_MS);
const attemptTimeoutMs =
  Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_ATTEMPT_TIMEOUT_MS;

setDefaultAutoSelectFamilyAttemptTimeout(attemptTimeoutMs);

export { attemptTimeoutMs };
