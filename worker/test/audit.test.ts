import { env, exports } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { hashPassword } from '../src/lib/password';

async function tokenFor(role: 'owner' | 'editor'): Promise<string> {
  const { hash, salt, iterations } = await hashPassword('somepassword1');
  await env.DB.prepare(
    `INSERT INTO users (username, password_hash, salt, iterations, role) VALUES (?,?,?,?,?)`,
  ).bind(role, hash, salt, iterations, role).run();
  const res = await exports.default.fetch('https://api.test/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: role, password: 'somepassword1' }),
  });
  return (await res.json<any>()).token;
}

function api(t: string, path = '', init: RequestInit = {}) {
  return exports.default.fetch(`https://api.test/v1/audit${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function seedEntry(action: string, opts: { target?: string; detail?: string | null } = {}) {
  await env.DB.prepare(
    `INSERT INTO audit_log (actor_id, actor_name, action, target, detail) VALUES (NULL, 'someone', ?, ?, ?)`,
  )
    .bind(action, opts.target ?? null, opts.detail === undefined ? null : opts.detail)
    .run();
}

beforeEach(async () => {
  for (const table of ['pending_publish', 'audit_log', 'slots', 'assets', 'users', 'login_attempts']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe('GET /v1/audit', () => {
  it('requires authentication', async () => {
    expect((await api('')).status).toBe(401);
  });

  it('blocks an editor (owner-only)', async () => {
    const t = await tokenFor('editor');
    expect((await api(t)).status).toBe(403);
  });

  it('returns entries newest-first for an owner', async () => {
    const t = await tokenFor('owner');
    await env.DB.prepare('DELETE FROM audit_log').run();
    await seedEntry('auth.login');
    await seedEntry('auth.logout');
    await seedEntry('auth.password_change');

    const res = await api(t);
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.entries.map((e: any) => e.action)).toEqual([
      'auth.password_change',
      'auth.logout',
      'auth.login',
    ]);
    expect(body.entries[0].id).toBeGreaterThan(body.entries[1].id);
  });

  it('respects limit and clamps a limit above 200 to 200', async () => {
    const t = await tokenFor('owner');
    await env.DB.prepare('DELETE FROM audit_log').run();
    for (let i = 0; i < 5; i++) await seedEntry('auth.login');

    const limited = await (await api(t, '?limit=2')).json<any>();
    expect(limited.entries).toHaveLength(2);

    const clamped = await (await api(t, '?limit=9999')).json<any>();
    expect(clamped.entries).toHaveLength(5);
  });

  it('paginates with before, returning strictly older entries and a correct nextBefore', async () => {
    const t = await tokenFor('owner');
    await env.DB.prepare('DELETE FROM audit_log').run();
    for (let i = 0; i < 5; i++) await seedEntry('auth.login');

    const first = await (await api(t, '?limit=2')).json<any>();
    expect(first.entries).toHaveLength(2);
    expect(first.nextBefore).toBe(first.entries[1].id);

    const second = await (await api(t, `?limit=2&before=${first.nextBefore}`)).json<any>();
    expect(second.entries).toHaveLength(2);
    for (const e of second.entries) expect(e.id).toBeLessThan(first.nextBefore);
    expect(second.nextBefore).toBe(second.entries[1].id);

    const third = await (await api(t, `?limit=2&before=${second.nextBefore}`)).json<any>();
    expect(third.entries).toHaveLength(1);
    expect(third.nextBefore).toBeNull();
  });

  it('parses detail JSON into an object, and yields null for malformed JSON', async () => {
    const t = await tokenFor('owner');
    await seedEntry('asset.upload', { detail: JSON.stringify({ bytes: 12345, mime: 'image/webp' }) });
    await seedEntry('slot.clear', { detail: '{not valid json' });

    const body = await (await api(t)).json<any>();
    const cleared = body.entries.find((e: any) => e.action === 'slot.clear');
    const uploaded = body.entries.find((e: any) => e.action === 'asset.upload');
    expect(cleared.detail).toBeNull();
    expect(uploaded.detail).toEqual({ bytes: 12345, mime: 'image/webp' });
  });

  it('reports actorDisplay as the display name of a still-existing account', async () => {
    const t = await tokenFor('owner');
    await env.DB.prepare('DELETE FROM audit_log').run();
    const { hash, salt, iterations } = await hashPassword('somepassword1');
    await env.DB.prepare(
      `INSERT INTO users (username, password_hash, salt, iterations, role, display_name) VALUES (?,?,?,?,?,?)`,
    ).bind('sranita', hash, salt, iterations, 'editor', 'Sister Anita').run();
    const actor = await env.DB.prepare(`SELECT id FROM users WHERE username='sranita'`).first<any>();
    await env.DB.prepare(
      `INSERT INTO audit_log (actor_id, actor_name, action, target, detail) VALUES (?, ?, ?, NULL, NULL)`,
    ).bind(actor.id, 'sranita', 'auth.login').run();

    const body = await (await api(t)).json<any>();
    expect(body.entries[0].actorDisplay).toBe('Sister Anita');
    expect(body.entries[0].actor).toBe('sranita');
  });

  it('falls back actorDisplay to the recorded actor_name when the account has been deleted', async () => {
    const t = await tokenFor('owner');
    await env.DB.prepare('DELETE FROM audit_log').run();
    await seedEntry('auth.login');

    const body = await (await api(t)).json<any>();
    expect(body.entries[0].actorDisplay).toBe('someone');
    expect(body.entries[0].actor).toBe('someone');
  });

  it('resolves pagePath/pageLabel for a slot target, and nulls for a non-slot target', async () => {
    const t = await tokenFor('owner');
    await env.DB.prepare(
      `INSERT INTO slots (id, page_path, label, optional, r2_key, original_src, alt) VALUES
         ('ourfounder.img.1','pages/about/OurFounder.html','Founder',0,NULL,'../../resources/management/founder.jpg','Founder')`,
    ).run();
    await seedEntry('slot.update', { target: 'ourfounder.img.1' });
    await seedEntry('user.delete', { target: 'editor1' });

    const body = await (await api(t)).json<any>();
    const slotEntry = body.entries.find((e: any) => e.action === 'slot.update');
    const userEntry = body.entries.find((e: any) => e.action === 'user.delete');
    expect(slotEntry.pagePath).toBe('pages/about/OurFounder.html');
    expect(slotEntry.pageLabel).toBe('Our Founder');
    expect(userEntry.pagePath).toBeNull();
    expect(userEntry.pageLabel).toBeNull();
  });
});
