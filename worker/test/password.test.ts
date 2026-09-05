import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/password';

describe('password', () => {
  it('accepts the correct password', async () => {
    const { hash, salt, iterations } = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', hash, salt, iterations)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const { hash, salt, iterations } = await hashPassword('correct horse');
    expect(await verifyPassword('wrong horse', hash, salt, iterations)).toBe(false);
  });

  it('produces a different salt and hash each call', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('defaults to 100000 iterations', async () => {
    expect((await hashPassword('x')).iterations).toBe(100000);
  });

  it('is deterministic for a supplied salt', async () => {
    const first = await hashPassword('x');
    const again = await hashPassword('x', first.salt, first.iterations);
    expect(again.hash).toBe(first.hash);
  });

  it('rejects a hash of the wrong length without throwing', async () => {
    expect(await verifyPassword('x', 'dGlueQ==', 'c2FsdA==', 100000)).toBe(false);
  });
});
