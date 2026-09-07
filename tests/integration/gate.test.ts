import { describe, expect, it } from 'vitest';
import { createGateHash, parseGateHash, sessionToken, verifyPassword } from '../../src/app/gate/hash';

describe('password gate hashing', () => {
  it('creates a parseable PBKDF2 hash and verifies the right password only', async () => {
    const h = await createGateHash('Correct-Horse-9', 20_000);
    expect(h.startsWith('pbkdf2$20000$')).toBe(true);
    const gate = parseGateHash(h)!;
    expect(gate).not.toBeNull();
    expect(await verifyPassword('Correct-Horse-9', gate)).toBe(true);
    expect(await verifyPassword('correct-horse-9', gate)).toBe(false);
    expect(await verifyPassword('', gate)).toBe(false);
  });
  it('rejects malformed or weak configurations (gate disabled rather than bypassable)', () => {
    expect(parseGateHash('')).toBeNull();
    expect(parseGateHash(undefined)).toBeNull();
    expect(parseGateHash('pbkdf2$100$AAAA$BBBB')).toBeNull(); // too few iterations
    expect(parseGateHash('sha1$1000$x$y')).toBeNull();
  });
  it('salts differ per hash and session tokens change on rotation', async () => {
    const a = await createGateHash('same', 20_000);
    const b = await createGateHash('same', 20_000);
    expect(a).not.toBe(b);
    expect(await sessionToken(a)).not.toBe(await sessionToken(b));
    expect(await sessionToken(a)).toBe(await sessionToken(a));
  });
});
