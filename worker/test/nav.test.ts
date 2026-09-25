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
  return exports.default.fetch(`https://api.test/v1/nav${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

const dirtyCount = async () => {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM pending_publish').first<{ n: number }>();
  return row?.n ?? 0;
};

let t: string;

beforeEach(async () => {
  for (const table of ['pending_publish', 'audit_log', 'nav_menu_items', 'users', 'login_attempts']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare(
    `INSERT INTO nav_menu_items (id, menu, label, href, new_tab, badge, position) VALUES
       (1,'the_school','Online Registration Form','https://forms.example/one',1,1,1),
       (2,'the_school','Manual Registration Form','https://forms.example/two',1,1,2),
       (3,'circulars','Visiting Hours','https://drive.example/hours',1,1,1)`,
  ).run();
  t = await tokenFor('editor');
});

describe('auth', () => {
  it('requires a token', async () => {
    expect((await exports.default.fetch('https://api.test/v1/nav')).status).toBe(401);
  });
});

describe('GET /', () => {
  it('groups items by menu, in position order', async () => {
    const body = await (await api(t, '')).json<any>();
    expect(body.the_school.map((i: any) => i.label)).toEqual(['Online Registration Form', 'Manual Registration Form']);
    expect(body.circulars.map((i: any) => i.label)).toEqual(['Visiting Hours']);
    expect(body.the_school[0]).toMatchObject({ newTab: true, badge: true, position: 1 });
  });
});

describe('POST /:menu', () => {
  it('appends a link and marks every nav page dirty', async () => {
    const res = await api(t, '/circulars', {
      method: 'POST',
      body: JSON.stringify({ label: 'Notice to Parents', href: 'https://drive.example/notice' }),
    });
    expect(res.status).toBe(201);
    const created = await res.json<any>();
    expect(created).toMatchObject({ menu: 'circulars', label: 'Notice to Parents', position: 2, newTab: true, badge: true });

    expect(await dirtyCount()).toBe(45);
    const marked = await env.DB.prepare("SELECT 1 FROM pending_publish WHERE page_path = 'index.html'").first();
    expect(marked).not.toBeNull();
  });

  it('rejects an unknown menu', async () => {
    const res = await api(t, '/not-a-menu', { method: 'POST', body: JSON.stringify({ label: 'x', href: 'https://x' }) });
    expect(res.status).toBe(404);
  });

  it('rejects an empty label', async () => {
    const res = await api(t, '/circulars', { method: 'POST', body: JSON.stringify({ label: '  ', href: 'https://x' }) });
    expect(res.status).toBe(400);
  });

  it('rejects an empty address', async () => {
    const res = await api(t, '/circulars', { method: 'POST', body: JSON.stringify({ label: 'x', href: '' }) });
    expect(res.status).toBe(400);
  });

  it('records the change in audit_log', async () => {
    await api(t, '/circulars', { method: 'POST', body: JSON.stringify({ label: 'x', href: 'https://x' }) });
    const row = await env.DB.prepare('SELECT action FROM audit_log ORDER BY id DESC LIMIT 1').first<any>();
    expect(row.action).toBe('nav.item.create');
  });
});

describe('PATCH /items/:id', () => {
  it('updates only the given fields', async () => {
    const res = await api(t, '/items/1', { method: 'PATCH', body: JSON.stringify({ newTab: false }) });
    expect(res.status).toBe(200);
    const updated = await res.json<any>();
    expect(updated).toMatchObject({ label: 'Online Registration Form', newTab: false, badge: true });
    expect(await dirtyCount()).toBe(45);
  });

  it('rejects an unknown id', async () => {
    expect((await api(t, '/items/999', { method: 'PATCH', body: JSON.stringify({ label: 'x' }) })).status).toBe(404);
  });

  it('rejects an empty body', async () => {
    expect((await api(t, '/items/1', { method: 'PATCH', body: JSON.stringify({}) })).status).toBe(400);
  });
});

describe('DELETE /items/:id', () => {
  it('removes the link and renumbers the rest of its menu', async () => {
    const res = await api(t, '/items/1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const remaining = await env.DB.prepare('SELECT id, position FROM nav_menu_items WHERE menu = ? ORDER BY position').bind('the_school').all<any>();
    expect(remaining.results).toEqual([{ id: 2, position: 1 }]);
    expect(await dirtyCount()).toBe(45);
  });
});

describe('POST /:menu/order', () => {
  it('reorders every item in the menu', async () => {
    const res = await api(t, '/the_school/order', { method: 'POST', body: JSON.stringify({ ids: [2, 1] }) });
    expect(res.status).toBe(200);
    const rows = await env.DB.prepare('SELECT id FROM nav_menu_items WHERE menu = ? ORDER BY position').bind('the_school').all<any>();
    expect(rows.results.map((r: any) => r.id)).toEqual([2, 1]);
  });

  it('rejects a list that omits an item', async () => {
    const res = await api(t, '/the_school/order', { method: 'POST', body: JSON.stringify({ ids: [1] }) });
    expect(res.status).toBe(400);
  });
});
