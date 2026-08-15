import { env, exports } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { hashPassword } from '../src/lib/password';

async function seedUser(username: string, password: string, role: 'owner' | 'editor') {
  const { hash, salt, iterations } = await hashPassword(password);
  await env.DB.prepare(
    `INSERT INTO users (username, password_hash, salt, iterations, role)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash,
       salt=excluded.salt, iterations=excluded.iterations, role=excluded.role`,
  ).bind(username, hash, salt, iterations, role).run();
}

async function login(username: string, password: string, ip = '1.2.3.4') {
  return exports.default.fetch('https://api.test/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ username, password }),
  });
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM login_attempts').run();
  await env.DB.prepare('DELETE FROM audit_log').run();
  await seedUser('owner1', 'ownerpass', 'owner');
  await seedUser('editor1', 'editorpass', 'editor');
});

describe('login', () => {
  it('returns a token and the user', async () => {
    const res = await login('owner1', 'ownerpass');
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(body.user).toMatchObject({ username: 'owner1', role: 'owner' });
    expect(body.expiresAt).toBeTypeOf('number');
  });

  it('rejects a wrong password with the same shape as an unknown user', async () => {
    const wrong = await login('owner1', 'nope');
    const missing = await login('ghost', 'nope');
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(await wrong.json()).toEqual(await missing.json());
  });

  it('records the login in audit_log', async () => {
    await login('owner1', 'ownerpass');
    const row = await env.DB.prepare(
      `SELECT action, actor_name FROM audit_log ORDER BY id DESC LIMIT 1`,
    ).first<any>();
    expect(row).toMatchObject({ action: 'auth.login', actor_name: 'owner1' });
  });

  it('locks out after 5 failures from one IP and still allows another IP', async () => {
    for (let i = 0; i < 5; i++) expect((await login('owner1', 'bad', '9.9.9.9')).status).toBe(401);
    expect((await login('owner1', 'ownerpass', '9.9.9.9')).status).toBe(429);
    expect((await login('owner1', 'ownerpass', '8.8.8.8')).status).toBe(200);
  });

  it('rejects a malformed body', async () => {
    const res = await exports.default.fetch('https://api.test/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"username":"owner1"}',
    });
    expect(res.status).toBe(400);
  });
});

describe('protected routes', () => {
  it('rejects a missing or malformed token', async () => {
    expect((await exports.default.fetch('https://api.test/v1/auth/me')).status).toBe(401);
    const res = await exports.default.fetch('https://api.test/v1/auth/me', {
      headers: { Authorization: 'Bearer garbage' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts a valid token and returns the user', async () => {
    const { token } = await (await login('editor1', 'editorpass')).json<any>();
    const res = await exports.default.fetch('https://api.test/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ username: 'editor1', role: 'editor' });
  });

  it('rejects a token whose token_version is stale', async () => {
    const { token } = await (await login('editor1', 'editorpass')).json<any>();
    await env.DB.prepare(`UPDATE users SET token_version = token_version + 1 WHERE username='editor1'`).run();
    const res = await exports.default.fetch('https://api.test/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });
});

describe('logout and password change', () => {
  it('logout invalidates the token it was called with', async () => {
    const { token } = await (await login('editor1', 'editorpass')).json<any>();
    const auth = { Authorization: `Bearer ${token}` };
    expect((await exports.default.fetch('https://api.test/v1/auth/logout', { method: 'POST', headers: auth })).status).toBe(200);
    expect((await exports.default.fetch('https://api.test/v1/auth/me', { headers: auth })).status).toBe(401);
  });

  it('changes the password, invalidates old sessions, and accepts the new password', async () => {
    const { token } = await (await login('editor1', 'editorpass')).json<any>();
    const res = await exports.default.fetch('https://api.test/v1/auth/password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'editorpass', newPassword: 'brand-new-pass' }),
    });
    expect(res.status).toBe(200);
    expect((await exports.default.fetch('https://api.test/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await login('editor1', 'brand-new-pass')).status).toBe(200);
    expect((await login('editor1', 'editorpass')).status).toBe(401);
  });

  it('refuses a password change with the wrong current password', async () => {
    const { token } = await (await login('editor1', 'editorpass')).json<any>();
    const res = await exports.default.fetch('https://api.test/v1/auth/password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'brand-new-pass' }),
    });
    expect(res.status).toBe(403);
  });

  it('refuses a new password shorter than 10 characters', async () => {
    const { token } = await (await login('editor1', 'editorpass')).json<any>();
    const res = await exports.default.fetch('https://api.test/v1/auth/password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'editorpass', newPassword: 'short' }),
    });
    expect(res.status).toBe(400);
  });
});
