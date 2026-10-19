// Secrets are set with `wrangler secret put` (or .dev.vars locally), so
// `wrangler types` can't see them. Both are optional: unset disables the feature.
interface Secrets {
  /** Turnstile secret key; when set, creating a board requires a valid token. */
  TURNSTILE_SECRET?: string;
  /** Bearer token for DELETE /admin/boards/:id; when unset the endpoint doesn't exist. */
  ADMIN_TOKEN?: string;
}

// wrangler types declares both a global Env and Cloudflare.Env.
interface Env extends Secrets {}
declare namespace Cloudflare {
  interface Env extends Secrets {}
}
