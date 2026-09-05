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
    expect(list[0]).toMatchObject({ pagePath: 'index.html', label: 'Home page', slotCount: 7 });
  });

  it('includes up to 3 absolute thumbnail URLs per page, ordered by slot id', async () => {
    const t = await tokenFor('editor');
    const list = await (await api(t)).json<any[]>();

    const home = list.find((p) => p.pagePath === 'index.html');
    expect(home.thumbs).toHaveLength(3);
    for (const url of home.thumbs) expect(url).toMatch(/^https:\/\//);

    const founder = list.find((p) => p.pagePath === 'pages/about/OurFounder.html');
    expect(founder.thumbs).toEqual(['https://vhspurnea.com/resources/management/founder.jpg']);

    const management = list.find((p) => p.pagePath === 'pages/about/OurManagement.html');
    expect(management.thumbs).toHaveLength(3);
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
    expect(fih).toMatchObject({ label: 'FIH Congregation', slotCount: 3, editedCount: 0 });
  });

  it('reports unpublishedCount 0 for an edited page with no pending_publish row (published edits stay edited but not unpublished)', async () => {
    const t = await tokenFor('editor');
    await env.DB.prepare(
      `INSERT INTO assets (r2_key, mime, sha256, origin) VALUES ('up/ab/notpending.deadbeef.webp','image/webp','deadbeef','upload')`,
    ).run();
    await env.DB.prepare(
      `UPDATE slots SET r2_key = 'up/ab/notpending.deadbeef.webp' WHERE id = 'ourfounder.img.1'`,
    ).run();

    const list = await (await api(t)).json<any[]>();
    const founder = list.find((p) => p.pagePath === 'pages/about/OurFounder.html');
    expect(founder).toMatchObject({ editedCount: 1, unpublishedCount: 0 });
  });

  it('reports a non-zero unpublishedCount for a page with a pending_publish row', async () => {
    const t = await tokenFor('editor');
    await env.DB.prepare(
      `INSERT INTO assets (r2_key, mime, sha256, origin) VALUES ('up/ab/pending.deadbeef.webp','image/webp','deadbeef','upload')`,
    ).run();
    await env.DB.prepare(
      `UPDATE slots SET r2_key = 'up/ab/pending.deadbeef.webp' WHERE id = 'ourfounder.img.1'`,
    ).run();
    await env.DB.prepare(`INSERT INTO pending_publish (page_path) VALUES ('pages/about/OurFounder.html')`).run();

    const list = await (await api(t)).json<any[]>();
    const founder = list.find((p) => p.pagePath === 'pages/about/OurFounder.html');
    expect(founder).toMatchObject({ editedCount: 1, unpublishedCount: 1 });
  });

  it('reports 0 for both editedCount and unpublishedCount on a page with no edits', async () => {
    const t = await tokenFor('editor');
    const list = await (await api(t)).json<any[]>();
    const management = list.find((p) => p.pagePath === 'pages/about/OurManagement.html');
    expect(management).toMatchObject({ editedCount: 0, unpublishedCount: 0 });
  });
});

describe('pageLabel', () => {
  it('derives a human-readable label from each seeded slug', () => {
    expect(pageLabel('nested/index.html')).toBe('Home');
    expect(pageLabel('OurFounder')).toBe('Our Founder');
    expect(pageLabel('PrincipalMessage')).toBe('Principal Message');
    expect(pageLabel('FIH')).toBe('FIH');
  });

  it('returns the exact friendly name for each phase-1 page path', () => {
    expect(pageLabel('index.html')).toBe('Home page');
    expect(pageLabel('pages/about/OurManagement.html')).toBe('Our Management');
    expect(pageLabel('pages/about/OurFounder.html')).toBe('Our Founder');
    expect(pageLabel('pages/about/PrincipalMessage.html')).toBe("Principal's Message");
    expect(pageLabel('pages/about/FIH.html')).toBe('FIH Congregation');
  });

  it('falls back to the derived name for a page path not in the friendly-name map', () => {
    expect(pageLabel('pages/about/NewPhase2Page.html')).toBe('New Phase2 Page');
  });
});
