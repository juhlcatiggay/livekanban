/**
 * ALLOWED_ORIGINS is a comma-separated list of exact origins or patterns with
 * `*`, which matches one run of letters, digits and dashes (never a dot), so
 * `https://livekanban-*.vercel.app` allows every Vercel preview of the project
 * but not `https://evil.livekanban-x.vercel.app` or other domains.
 */
export function originMatcher(allowed: string): (origin: string) => boolean {
  const patterns = allowed
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
    .map((o) => new RegExp(`^${o.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[a-z0-9-]+")}$`, "i"));
  return (origin) => patterns.some((p) => p.test(origin));
}
