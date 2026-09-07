/**
 * Generate the PBKDF2 hash for the frontend password gate.
 *   npm run gate:hash -- "<password>"     -> prints the VITE_GATE_HASH value for the given password
 *   npm run gate:hash                     -> generates a random 16-char password AND its hash
 * Store the hash as GitHub Actions variable VITE_GATE_HASH (not a secret: it is public in the bundle anyway).
 * Never commit the password itself.
 */
import { createGateHash } from '../src/app/gate/hash';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function randomPassword(len = 16): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

const provided = process.argv.slice(2).join(' ').trim();
const password = provided || randomPassword();
const hash = await createGateHash(password);
if (!provided) console.log(`PASSWORD (share privately, do not commit): ${password}`);
console.log(`VITE_GATE_HASH=${hash}`);
