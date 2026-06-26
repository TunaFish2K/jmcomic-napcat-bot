import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS } from "./config.js";

export class RateLimiter {
  #buckets = new Map<number, number[]>();

  try(userId: number): boolean {
    const now = Date.now();
    const timestamps = this.#buckets.get(userId) ?? [];
    const valid = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

    if (valid.length >= RATE_LIMIT_MAX_REQUESTS) return false;

    valid.push(now);
    this.#buckets.set(userId, valid);
    return true;
  }
}
