import { DurableObject } from "cloudflare:workers";

/**
 * Sliding-window counter, one Durable Object per client IP, for the plan's
 * "20 boards per hour per IP". Workers' built-in rate limiter only supports
 * 10 s or 60 s windows, so an hour needs its own state.
 */
export class CreationLimiter extends DurableObject<Env> {
  /** Records one attempt if under `limit` in the last `windowMs`. */
  async take(limit: number, windowMs: number): Promise<{ ok: boolean; retryAfterMs: number }> {
    const now = Date.now();
    const hits = ((await this.ctx.storage.get<number[]>("hits")) ?? []).filter((t) => now - t < windowMs);
    if (hits.length >= limit) return { ok: false, retryAfterMs: hits[0] + windowMs - now };
    hits.push(now);
    await this.ctx.storage.put("hits", hits);
    // Clean up once the window has passed so idle IPs leave nothing behind.
    await this.ctx.storage.setAlarm(now + windowMs);
    return { ok: true, retryAfterMs: 0 };
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
