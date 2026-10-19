/**
 * Board passwords, stored only as a salted PBKDF2-SHA256 hash in the board's
 * own database. 20,000 iterations keeps a check to a few milliseconds of CPU;
 * the room also limits wrong guesses, which is the real brute-force defence.
 */
export interface PasswordRecord {
  salt: string;
  hash: string;
  iterations: number;
}

const ITERATIONS = 20_000;

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toBase64(salt), hash: toBase64(await derive(password, salt, ITERATIONS)), iterations: ITERATIONS };
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const actual = await derive(password, fromBase64(record.salt), record.iterations);
  const expected = fromBase64(record.hash);
  return actual.length === expected.length && crypto.subtle.timingSafeEqual(actual, expected);
}
