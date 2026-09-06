import { describe, it, expect } from 'vitest';
import { signSession, verifySession } from '../src/lib/jwt';

const SECRET = 'test-secret-at-least-32-bytes-long';
const USER = { id: 7, username: 'admin', role: 'owner', tv: 1 };

describe('jwt', () => {
  it('round-trips a session', async () => {
    const claims = await verifySession(SECRET, await signSession(SECRET, USER));
    expect(claims).toMatchObject({ sub: 7, username: 'admin', role: 'owner', tv: 1 });
  });

  it('returns null for a token signed with another secret', async () => {
    expect(await verifySession(SECRET, await signSession('other-secret', USER))).toBeNull();
  });

  it('returns null for a tampered token', async () => {
    const token = await signSession(SECRET, USER);
    const [h, p, s] = token.split('.');
    expect(await verifySession(SECRET, `${h}.${p}x.${s}`)).toBeNull();
  });

  it('returns null for garbage', async () => {
    expect(await verifySession(SECRET, 'not-a-token')).toBeNull();
    expect(await verifySession(SECRET, '')).toBeNull();
  });

  it('sets an 8 hour expiry', async () => {
    const token = await signSession(SECRET, USER);
    const body = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    expect(body.exp - body.iat).toBe(8 * 60 * 60);
  });
});
