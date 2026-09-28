/**
 * Encrypted data publishing (browser + Node, WebCrypto only).
 *
 * The weekly pipeline output (tracker model + insight) contains customer names and amounts, so it is never
 * published in clear on GitHub Pages. Instead `automation/publish-data.ts` encrypts it with the gate password:
 *   key  = PBKDF2-SHA256(password, salt || "ot-data-v1", iterations)  -> 256-bit AES-GCM key
 *   data = AES-256-GCM(key, iv, JSON({ model, insight }))
 * and writes public/data/bundle.enc.json. The browser derives the same key when the gate password is entered
 * and keeps the derived key (never the password) in session/local storage next to the gate token.
 *
 * Domain separation: the salt is suffixed with "ot-data-v1" so the data key can never equal the gate verifier
 * hash (which is public in the bundle). A new publish uses a fresh random salt, which forces one re-login.
 */
import { b64decode, b64encode, derive } from './hash';

export const BUNDLE_FILE = 'bundle.enc.json';
export const DATA_KEY_SESSION = 'ot.gate.datakey';
export const DATA_KEY_REMEMBER = 'ot.gate.datakey.remember';
const DOMAIN = new TextEncoder().encode('ot-data-v1');

export interface EncryptedBundle {
  v: 1;
  kdf: 'pbkdf2-sha256';
  iterations: number;
  salt: string; // base64, 16 bytes
  cipher: 'aes-256-gcm';
  iv: string; // base64, 12 bytes
  data: string; // base64 ciphertext (+ GCM tag)
  published_at: string; // ISO timestamp
  bytes: number; // plaintext size, for the UI / logs
}

export interface StoredDataKey {
  salt: string; // base64, must match the bundle's salt
  key: string; // base64 raw AES key
}

const subtle = () => globalThis.crypto.subtle;

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Base64 for large buffers (chunked so String.fromCharCode never sees a huge argument list). */
export function b64encodeLarge(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)));
  return btoa(s);
}

export async function deriveDataKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return derive(password, concat(salt, DOMAIN), iterations, 32);
}

type SubtleKey = Awaited<ReturnType<typeof globalThis.crypto.subtle.importKey>>;

async function aesKey(raw: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<SubtleKey> {
  return subtle().importKey('raw', raw.slice().buffer as ArrayBuffer, { name: 'AES-GCM' }, false, [usage]);
}

export async function encryptBundle(password: string, payload: unknown, iterations = 150_000, now: Date = new Date()): Promise<EncryptedBundle> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const key = await aesKey(await deriveDataKey(password, salt, iterations), 'encrypt');
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv.slice().buffer as ArrayBuffer }, key, plain.slice().buffer as ArrayBuffer));
  return { v: 1, kdf: 'pbkdf2-sha256', iterations, salt: b64encode(salt), cipher: 'aes-256-gcm', iv: b64encode(iv), data: b64encodeLarge(cipher), published_at: now.toISOString(), bytes: plain.length };
}

export function isEncryptedBundle(v: unknown): v is EncryptedBundle {
  const b = v as EncryptedBundle;
  return !!b && typeof b === 'object' && b.v === 1 && b.kdf === 'pbkdf2-sha256' && b.cipher === 'aes-256-gcm' && typeof b.salt === 'string' && typeof b.iv === 'string' && typeof b.data === 'string' && Number.isInteger(b.iterations);
}

/** Decrypt with a raw key (32 bytes). Throws on a wrong key / tampered payload (GCM authentication). */
export async function decryptBundle<T>(rawKey: Uint8Array, bundle: EncryptedBundle): Promise<T> {
  const key = await aesKey(rawKey, 'decrypt');
  const iv = b64decode(bundle.iv);
  const cipher = b64decode(bundle.data);
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv: iv.slice().buffer as ArrayBuffer }, key, cipher.slice().buffer as ArrayBuffer);
  } catch {
    throw new Error('Encrypted data could not be decrypted with the current password (wrong password or the data was re-published).');
  }
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

/** Convenience for scripts/tests: derive from the password and decrypt in one step. */
export async function decryptBundleWithPassword<T>(password: string, bundle: EncryptedBundle): Promise<T> {
  return decryptBundle<T>(await deriveDataKey(password, b64decode(bundle.salt), bundle.iterations), bundle);
}

// ---------- browser storage of the derived key (never the password) ----------

export function readStoredDataKey(): StoredDataKey | null {
  try {
    const raw = sessionStorage.getItem(DATA_KEY_SESSION) ?? localStorage.getItem(DATA_KEY_REMEMBER);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredDataKey;
    return v && typeof v.salt === 'string' && typeof v.key === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function storeDataKey(k: StoredDataKey, remember: boolean): void {
  try {
    const raw = JSON.stringify(k);
    sessionStorage.setItem(DATA_KEY_SESSION, raw);
    if (remember) localStorage.setItem(DATA_KEY_REMEMBER, raw);
  } catch {
    /* storage unavailable: the key lives only in this render */
  }
}

export function clearStoredDataKey(): void {
  try {
    sessionStorage.removeItem(DATA_KEY_SESSION);
    localStorage.removeItem(DATA_KEY_REMEMBER);
  } catch {
    /* ignore */
  }
}

/** Thrown when an encrypted bundle exists but no matching key is available: the UI must ask for the password again. */
export class DataLockedError extends Error {
  constructor(message = 'Encrypted data requires the access password.') {
    super(message);
    this.name = 'DataLockedError';
  }
}
