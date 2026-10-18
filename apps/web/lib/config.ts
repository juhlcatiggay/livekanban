/** Host of the Cloudflare Worker (no protocol), e.g. `localhost:8787` or `livekanban.example.workers.dev`. */
export const PARTY_HOST = process.env.NEXT_PUBLIC_PARTY_HOST ?? "localhost:8787";

const isLocal = /^(localhost|127\.0\.0\.1)(:|$)/.test(PARTY_HOST);

export function workerUrl(path: string): string {
  return `${isLocal ? "http" : "https"}://${PARTY_HOST}${path}`;
}
