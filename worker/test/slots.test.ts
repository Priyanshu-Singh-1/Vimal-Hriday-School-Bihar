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

function api(t: string, path: string, init: RequestInit = {}) {
  return exports.default.fetch(`https://api.test/v1/slots${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

let t: string;

beforeEach(async () => {
  for (const table of ['pending_publish', 'audit_log', 'slots', 'assets', 'users', 'login_attempts']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare(
    `INSERT INTO slots (id, page_path, label, optional, r2_key, original_src, alt) VALUES
       ('p.img.1','pages/about/OurFounder.html','Founder',0,NULL,'../../resources/management/founder.jpg','Founder'),
       ('p.img.2','pages/about/OurFounder.html','Second',1,NULL,'../../resources/management/1.jpeg','')`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO assets (r2_key, mime, sha256, origin, bound) VALUES ('up/ab/new.deadbeef.webp','image/webp','deadbeef','upload',0)`,
  ).run();
  t = await tokenFor('editor');
});

describe('GET /slots', () => {
  it('requires authentication', async () => {
    expect((await exports.default.fetch('https://api.test/v1/slots?page=x')).status).toBe(401);
  });

  it('lists slots for a page with the currently rendered src', async () => {
    const res = await api(t, '?page=pages/about/OurFounder.html');
    expect(res.status).toBe(200);
    const list = await res.json<any[]>();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: 'p.img.1', src: '../../resources/management/founder.jpg', optional: 0 });
  });

  it('returns an empty array for a page with no slots', async () => {
    expect(await (await api(t, '?page=nope.html')).json()).toEqual([]);
  });

  it('requires the page parameter', async () => {
    expect((await api(t, '')).status).toBe(400);
  });
});

describe('PUT /slots/:id', () => {
  it('sets the image, binds the asset, and marks the page dirty', async () => {
    const res = await api(t, '/p.img.1', {
      method: 'PUT',
      body: JSON.stringify({ r2Key: 'up/ab/new.deadbeef.webp', alt: 'New founder' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json<any>()).src).toBe('https://img.test/up/ab/new.deadbeef.webp');

    const slot = await env.DB.prepare(`SELECT r2_key, alt FROM slots WHERE id='p.img.1'`).first<any>();
    expect(slot).toMatchObject({ r2_key: 'up/ab/new.deadbeef.webp', alt: 'New founder' });

    const asset = await env.DB.prepare(`SELECT bound FROM assets WHERE r2_key='up/ab/new.deadbeef.webp'`).first<any>();
    expect(asset.bound).toBe(1);

    const dirty = await env.DB.prepare(`SELECT page_path FROM pending_publish`).all();
    expect(dirty.results).toEqual([{ page_path: 'pages/about/OurFounder.html' }]);
  });

  it('rejects an unknown slot id', async () => {
    const res = await api(t, '/does.not.exist', {
      method: 'PUT', body: JSON.stringify({ r2Key: 'up/ab/new.deadbeef.webp', alt: '' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects an r2Key with no asset row', async () => {
    const res = await api(t, '/p.img.1', {
      method: 'PUT', body: JSON.stringify({ r2Key: 'up/zz/ghost.00000000.webp', alt: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 409 when If-Match does not match updatedAt', async () => {
    const res = await api(t, '/p.img.1', {
      method: 'PUT',
      headers: { 'If-Match': '1999-01-01 00:00:00' },
      body: JSON.stringify({ r2Key: 'up/ab/new.deadbeef.webp', alt: '' }),
    });
    expect(res.status).toBe(409);
  });

  it('succeeds when If-Match is current', async () => {
    const list = await (await api(t, '?page=pages/about/OurFounder.html')).json<any[]>();
    const res = await api(t, '/p.img.1', {
      method: 'PUT',
      headers: { 'If-Match': list[0].updatedAt },
      body: JSON.stringify({ r2Key: 'up/ab/new.deadbeef.webp', alt: '' }),
    });
    expect(res.status).toBe(200);
  });

  it('records the change in audit_log', async () => {
    await api(t, '/p.img.1', { method: 'PUT', body: JSON.stringify({ r2Key: 'up/ab/new.deadbeef.webp', alt: '' }) });
    const row = await env.DB.prepare(`SELECT action, target FROM audit_log ORDER BY id DESC LIMIT 1`).first<any>();
    expect(row).toMatchObject({ action: 'slot.update', target: 'p.img.1' });
  });

  it('marks the page dirty only once across repeated edits', async () => {
    for (let i = 0; i < 3; i++) {
      await api(t, '/p.img.1', { method: 'PUT', body: JSON.stringify({ r2Key: 'up/ab/new.deadbeef.webp', alt: `v${i}` }) });
    }
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM pending_publish').first<any>();
    expect(row.n).toBe(1);
  });
});

describe('revert and clear', () => {
  it('revert restores the original src', async () => {
    await api(t, '/p.img.1', { method: 'PUT', body: JSON.stringify({ r2Key: 'up/ab/new.deadbeef.webp', alt: 'x' }) });
    const res = await api(t, '/p.img.1/revert', { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json<any>()).src).toBe('../../resources/management/founder.jpg');
    const slot = await env.DB.prepare(`SELECT r2_key FROM slots WHERE id='p.img.1'`).first<any>();
    expect(slot.r2_key).toBeNull();
  });

  it('refuses to clear a non-optional slot', async () => {
    expect((await api(t, '/p.img.1/image', { method: 'DELETE' })).status).toBe(400);
  });

  it('clears an optional slot', async () => {
    await api(t, '/p.img.2', { method: 'PUT', body: JSON.stringify({ r2Key: 'up/ab/new.deadbeef.webp', alt: '' }) });
    expect((await api(t, '/p.img.2/image', { method: 'DELETE' })).status).toBe(200);
    const slot = await env.DB.prepare(`SELECT r2_key FROM slots WHERE id='p.img.2'`).first<any>();
    expect(slot.r2_key).toBeNull();
  });
});
