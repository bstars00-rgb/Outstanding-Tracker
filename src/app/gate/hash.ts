/**
 * Password gate hashing (browser + Node, WebCrypto only).
 * Format: pbkdf2$<iterations>$<salt-base64>$<hash-base64>
 *
 * This is a CLIENT-SIDE gate for a static site: it stops casual access to the UI, it is not server-side
 * authentication. The salted PBKDF2 hash (not the password) is embedded at build time via VITE_GATE_HASH.
 * Real customer data must additionally be protected at the source (private repo / protected data URL).
 */
export interface GateHash {
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

const subtle = () => globalThis.crypto.subtle;

export function parseGateHash(value: string | undefined | null): GateHash | null {
  if (!value) return null;
  const parts = value.trim().split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 10_000) return null;
  try {
    return { iterations, salt: b64decode(parts[2]), hash: b64decode(parts[3]) };
  } catch {
    return null;
  }
}

export async function derive(password: string, salt: Uint8Array, iterations: number, length = 32): Promise<Uint8Array> {
  const key = await subtle().importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt.slice().buffer as ArrayBuffer, iterations }, key, length * 8);
  return new Uint8Array(bits);
}

export async function createGateHash(password: string, iterations = 150_000): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return `pbkdf2$${iterations}$${b64encode(salt)}$${b64encode(hash)}`;
}

export async function verifyPassword(password: string, gate: GateHash): Promise<boolean> {
  const candidate = await derive(password, gate.salt, gate.iterations, gate.hash.length);
  return constantTimeEqual(candidate, gate.hash);
}

/** Session token stored after a successful unlock: hash of (gate hash string) so a stale token cannot outlive a rotation. */
export async function sessionToken(gateHashString: string): Promise<string> {
  const digest = await subtle().digest('SHA-256', new TextEncoder().encode(`ot-gate:${gateHashString}`));
  return b64encode(new Uint8Array(digest));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
