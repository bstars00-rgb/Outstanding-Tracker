import { describe, expect, it } from 'vitest';
import { b64decode } from '@app/gate/hash';
import { decryptBundle, decryptBundleWithPassword, deriveDataKey, encryptBundle, isEncryptedBundle } from '@app/gate/data-crypto';

describe('encrypted data bundle (AES-256-GCM, PBKDF2 key from the gate password)', () => {
  const payload = { model: { reference_date: '2026-09-28', invoices: [{ id: 1, amount: 84_074_241 }] }, insight: { output: { executive_summary: ['x'] } } };

  it('round-trips with the right password and rejects a wrong one', async () => {
    const b = await encryptBundle('OMH-test-pw', payload, 20_000, new Date('2030-01-01T00:00:00Z'));
    expect(isEncryptedBundle(b)).toBe(true);
    expect(b.data).not.toContain('84074241');
    expect(JSON.stringify(b)).not.toContain('2026-09-28');
    expect(await decryptBundleWithPassword('OMH-test-pw', b)).toEqual(payload);
    await expect(decryptBundleWithPassword('OMH-test-pW', b)).rejects.toThrow(/could not be decrypted/);
  });

  it('uses a fresh salt/iv per publish and a key that differs from the gate verifier derivation', async () => {
    const b1 = await encryptBundle('pw', payload, 20_000);
    const b2 = await encryptBundle('pw', payload, 20_000);
    expect(b1.salt).not.toBe(b2.salt);
    expect(b1.iv).not.toBe(b2.iv);
    const salt = b64decode(b1.salt);
    const dataKey = await deriveDataKey('pw', salt, 20_000);
    const { derive } = await import('@app/gate/hash');
    const verifier = await derive('pw', salt, 20_000, 32);
    expect(Buffer.from(dataKey).equals(Buffer.from(verifier))).toBe(false);
    // a key derived for another bundle's salt cannot open this one
    const otherKey = await deriveDataKey('pw', b64decode(b2.salt), 20_000);
    await expect(decryptBundle(otherKey, b1)).rejects.toThrow();
  });

  it('detects tampering (GCM authentication)', async () => {
    const b = await encryptBundle('pw', payload, 20_000);
    const tampered = { ...b, data: b.data.slice(0, -8) + (b.data.endsWith('AAAA') ? 'BBBB' : 'AAAA') + b.data.slice(-4) };
    await expect(decryptBundleWithPassword('pw', tampered)).rejects.toThrow();
  });
});
