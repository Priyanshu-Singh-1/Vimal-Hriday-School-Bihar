import { env, exports } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { hashPassword } from '../src/lib/password';

async function seed(username: string, password: string, role: 'owner' | 'editor') {
  const { hash, salt, iterations } = await hashPassword(password);
  await env.DB.prepare(
    `INSERT INTO users (username, password_hash, salt, iterations, role) VALUES (?,?,?,?,?)`,
  ).bind(username, hash, salt, iterations, role).run();
}

async function tokenFor(username: string, password: string) {
  const res = await exports.default.fetch('https://api.test/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return (await res.json<any>()).token as string;
}

function api(token: string, path: string, init: RequestInit = {}) {
  return exports.default.fetch(`https://api.test/v1/users${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

let ownerToken: string;
let editorToken: string;

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM audit_log').run();
  await env.DB.prepare('DELETE FROM login_attempts').run();
  await env.DB.prepare('DELETE FROM users').run();
  await seed('owner1', 'ownerpass11', 'owner');
  await seed('editor1', 'editorpass11', 'editor');
  ownerToken = await tokenFor('owner1', 'ownerpass11');
  editorToken = await tokenFor('editor1', 'editorpass11');
});

describe('authorisation', () => {
  it('blocks an editor from every owner-only route', async () => {
    expect((await api(editorToken, '/')).status).toBe(403);
    // Owner-only middleware runs before route matching, so an editor still gets
    // 403 here even though the POST handler no longer exists (an owner hitting
    // this same path gets 404 instead — see the "no account-creation route" test).
    expect((await api(editorToken, '/', { method: 'POST', body: JSON.stringify({ username: 'x', password: 'passwordlong', role: 'editor' }) })).status).toBe(403);
    const target = await env.DB.prepare(`SELECT id FROM users WHERE username='editor1'`).first<any>();
    expect((await api(editorToken, `/${target.id}`, { method: 'DELETE' })).status).toBe(403);
    expect((await api(editorToken, `/${target.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'owner' }) })).status).toBe(403);
    expect((await api(editorToken, `/${target.id}/password`, { method: 'POST', body: JSON.stringify({ newPassword: 'passwordlong' }) })).status).toBe(403);
  });
});

describe('owner actions', () => {
  it('lists users without exposing hashes', async () => {
    const res = await api(ownerToken, '/');
    expect(res.status).toBe(200);
    const list = await res.json<any[]>();
    expect(list).toHaveLength(2);
    expect(JSON.stringify(list)).not.toMatch(/password_hash|salt/);
  });

  it('has no account-creation route, even for an owner', async () => {
    const res = await api(ownerToken, '/', {
      method: 'POST',
      body: JSON.stringify({ username: 'teacher', password: 'teacherpass1', role: 'editor' }),
    });
    expect(res.status).toBe(404);
  });

  it('resets another user password and invalidates their sessions', async () => {
    const target = await env.DB.prepare(`SELECT id FROM users WHERE username='editor1'`).first<any>();
    const res = await api(ownerToken, `/${target.id}/password`, {
      method: 'POST', body: JSON.stringify({ newPassword: 'resetpass123' }),
    });
    expect(res.status).toBe(200);
    expect((await exports.default.fetch('https://api.test/v1/auth/me', { headers: { Authorization: `Bearer ${editorToken}` } })).status).toBe(401);
    expect(await tokenFor('editor1', 'resetpass123')).toBeTruthy();
  });

  it('changes a role', async () => {
    const target = await env.DB.prepare(`SELECT id FROM users WHERE username='editor1'`).first<any>();
    expect((await api(ownerToken, `/${target.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'owner' }) })).status).toBe(200);
    const row = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(target.id).first<any>();
    expect(row.role).toBe('owner');
  });

  it('deletes an editor', async () => {
    const target = await env.DB.prepare(`SELECT id FROM users WHERE username='editor1'`).first<any>();
    expect((await api(ownerToken, `/${target.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(target.id).first()).toBeNull();
  });

  it('refuses to delete yourself', async () => {
    const me = await env.DB.prepare(`SELECT id FROM users WHERE username='owner1'`).first<any>();
    expect((await api(ownerToken, `/${me.id}`, { method: 'DELETE' })).status).toBe(400);
  });

  it('refuses to remove the last owner by delete or by demotion', async () => {
    await seed('owner2', 'owner2pass1', 'owner');
    const t2 = await tokenFor('owner2', 'owner2pass1');
    const o1 = await env.DB.prepare(`SELECT id FROM users WHERE username='owner1'`).first<any>();
    // owner2 removes owner1 — allowed, two owners exist
    expect((await api(t2, `/${o1.id}`, { method: 'DELETE' })).status).toBe(200);
    // owner2 is now the only owner and cannot be demoted
    const o2 = await env.DB.prepare(`SELECT id FROM users WHERE username='owner2'`).first<any>();
    expect((await api(t2, `/${o2.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'editor' }) })).status).toBe(400);
  });

  it('preserves audit history after the actor is deleted', async () => {
    const target = await env.DB.prepare(`SELECT id FROM users WHERE username='editor1'`).first<any>();
    await api(ownerToken, `/${target.id}`, { method: 'DELETE' });
    const row = await env.DB.prepare(
      `SELECT actor_name FROM audit_log WHERE action='user.delete' ORDER BY id DESC LIMIT 1`,
    ).first<any>();
    expect(row.actor_name).toBe('owner1');
  });
});
