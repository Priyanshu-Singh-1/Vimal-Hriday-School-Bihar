import { env, exports } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { hashPassword } from '../src/lib/password';
import { pageLabel } from '../src/routes/pages';

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
  return exports.default.fetch(`https://api.test/v1/pages${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM users').run();
});

describe('GET /pages', () => {
  it('requires authentication', async () => {
    expect((await exports.default.fetch('https://api.test/v1/pages')).status).toBe(401);
  });

  it('allows a signed-in editor to read it', async () => {
    const t = await tokenFor('editor');
    expect((await api(t)).status).toBe(200);
  });

  it('returns the five seeded pilot pages, with index.html first', async () => {
    const t = await tokenFor('editor');
    const list = await (await api(t)).json<any[]>();
    expect(list.map((p) => p.pagePath)).toEqual([
      'index.html',
      'pages/about/FIH.html',
      'pages/about/OurFounder.html',
      'pages/about/OurManagement.html',
      'pages/about/PrincipalMessage.html',
    ]);
    expect(list[0]).toMatchObject({ pagePath: 'index.html', label: 'Home', slotCount: 7 });
  });

  it('reports slotCount and editedCount for each page', async () => {
    const t = await tokenFor('editor');
    await env.DB.prepare(
      `INSERT INTO assets (r2_key, mime, sha256, origin) VALUES ('up/ab/new.deadbeef.webp','image/webp','deadbeef','upload')`,
    ).run();
    await env.DB.prepare(
      `UPDATE slots SET r2_key = 'up/ab/new.deadbeef.webp' WHERE id = 'ourfounder.img.1'`,
    ).run();

    const list = await (await api(t)).json<any[]>();
    const founder = list.find((p) => p.pagePath === 'pages/about/OurFounder.html');
    expect(founder).toMatchObject({ label: 'Our Founder', slotCount: 1, editedCount: 1 });
    const management = list.find((p) => p.pagePath === 'pages/about/OurManagement.html');
    expect(management).toMatchObject({ label: 'Our Management', slotCount: 7, editedCount: 0 });
    const fih = list.find((p) => p.pagePath === 'pages/about/FIH.html');
    expect(fih).toMatchObject({ label: 'FIH', slotCount: 3, editedCount: 0 });
  });
});

describe('pageLabel', () => {
  it('derives a human-readable label from each seeded slug', () => {
    expect(pageLabel('index.html')).toBe('Home');
    expect(pageLabel('OurFounder')).toBe('Our Founder');
    expect(pageLabel('PrincipalMessage')).toBe('Principal Message');
    expect(pageLabel('FIH')).toBe('FIH');
  });
});
