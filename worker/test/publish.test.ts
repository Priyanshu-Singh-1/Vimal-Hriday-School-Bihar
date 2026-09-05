import { env, exports } from 'cloudflare:workers';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hashPassword } from '../src/lib/password';
import { publishPending, sweepUnboundAssets } from '../src/routes/publish';

const PAGE = [
  '<body>',
  '  <!--vhs:begin t.img.1--><img data-vhs-slot="t.img.1" alt="One" src="old1.jpg"><!--vhs:end t.img.1-->',
  '</body>',
].join('\n');

const OTHER = '<body><!--vhs:begin o.img.1--><img data-vhs-slot="o.img.1" alt="O" src="o.jpg"><!--vhs:end o.img.1--></body>';

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

function ghMock(over: Record<string, any> = {}) {
  const calls: any[] = [];
  const impl = vi.fn(async (input: any, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (over.fail?.(url)) return new Response('boom', { status: 500 });
    if (url.includes('/contents/t.html')) return new Response(PAGE, { status: 200 });
    if (url.includes('/contents/o.html')) return new Response(OTHER, { status: 200 });
    if (url.includes('/git/ref/heads/')) return json({ object: { sha: 'HEAD' } });
    if (url.includes('/git/commits/HEAD')) return json({ tree: { sha: 'TREE' } });
    if (url.includes('/git/blobs')) return json({ sha: 'BLOB' }, 201);
    if (url.includes('/git/trees')) return json({ sha: 'NEWTREE' }, 201);
    if (url.includes('/git/commits')) return json({ sha: 'COMMIT' }, 201);
    if (url.includes('/git/refs/heads/')) return json({ object: { sha: 'COMMIT' } });
    return new Response('unmatched ' + url, { status: 599 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

async function token(role: 'owner' | 'editor' = 'editor') {
  const { hash, salt, iterations } = await hashPassword('somepassword1');
  await env.DB.prepare(
    `INSERT INTO users (username, password_hash, salt, iterations, role) VALUES ('u1',?,?,?,?)`,
  ).bind(hash, salt, iterations, role).run();
  const res = await exports.default.fetch('https://api.test/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'u1', password: 'somepassword1' }),
  });
  return (await res.json<any>()).token as string;
}

beforeEach(async () => {
  for (const t of ['pending_publish', 'audit_log', 'slots', 'assets', 'users', 'login_attempts']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.prepare(
    `INSERT INTO slots (id, page_path, label, optional, r2_key, original_src, alt) VALUES
       ('t.img.1','t.html','one',0,NULL,'old1.jpg','One'),
       ('o.img.1','o.html','o',0,NULL,'o.jpg','O')`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO assets (r2_key, mime, sha256, origin, bound) VALUES ('up/ab/n.deadbeef.webp','image/webp','deadbeef','upload',1)`,
  ).run();
});

describe('publishPending', () => {
  it('does nothing when no page is dirty', async () => {
    const { impl, calls } = ghMock();
    expect(await publishPending(env as any, null, impl)).toEqual({ commit: null, pages: [], failed: [] });
    expect(calls).toHaveLength(0);
  });

  it('produces exactly one commit covering two dirty pages', async () => {
    await env.DB.prepare(`UPDATE slots SET r2_key='up/ab/n.deadbeef.webp' WHERE id IN ('t.img.1','o.img.1')`).run();
    await env.DB.prepare(`INSERT INTO pending_publish (page_path) VALUES ('t.html'),('o.html')`).run();

    const { impl, calls } = ghMock();
    const result = await publishPending(env as any, null, impl);
    expect(result.commit).toBe('COMMIT');
    expect(result.pages.sort()).toEqual(['o.html', 't.html']);

    const commitPosts = calls.filter((c) => c.url.includes('/git/commits') && c.init?.method === 'POST');
    expect(commitPosts).toHaveLength(1);
    const tree = calls.find((c) => c.url.includes('/git/trees'));
    expect(JSON.parse(tree.init.body).tree).toHaveLength(2);
  });

  it('clears pending_publish after a successful publish', async () => {
    await env.DB.prepare(`UPDATE slots SET r2_key='up/ab/n.deadbeef.webp' WHERE id='t.img.1'`).run();
    await env.DB.prepare(`INSERT INTO pending_publish (page_path) VALUES ('t.html')`).run();
    await publishPending(env as any, null, ghMock().impl);
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM pending_publish').first<any>();
    expect(row.n).toBe(0);
  });

  it('skips a dirty page whose rendered output already matches', async () => {
    await env.DB.prepare(`INSERT INTO pending_publish (page_path) VALUES ('t.html')`).run();
    const { impl, calls } = ghMock();
    const result = await publishPending(env as any, null, impl);
    expect(result.commit).toBeNull();
    expect(result.pages).toEqual([]);
    expect(calls.some((c) => c.url.includes('/git/blobs'))).toBe(false);
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM pending_publish').first<any>();
    expect(row.n).toBe(0);
  });

  it('leaves the page dirty and records the error when GitHub fails', async () => {
    await env.DB.prepare(`UPDATE slots SET r2_key='up/ab/n.deadbeef.webp' WHERE id='t.img.1'`).run();
    await env.DB.prepare(`INSERT INTO pending_publish (page_path) VALUES ('t.html')`).run();

    const { impl } = ghMock({ fail: (u: string) => u.includes('/git/trees') });
    await expect(publishPending(env as any, null, impl)).rejects.toBeTruthy();

    const row = await env.DB.prepare('SELECT attempts, last_error FROM pending_publish WHERE page_path=?')
      .bind('t.html').first<any>();
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBeTruthy();
  });

  it('retries successfully after a failure', async () => {
    await env.DB.prepare(`UPDATE slots SET r2_key='up/ab/n.deadbeef.webp' WHERE id='t.img.1'`).run();
    await env.DB.prepare(`INSERT INTO pending_publish (page_path) VALUES ('t.html')`).run();
    await expect(
      publishPending(env as any, null, ghMock({ fail: (u: string) => u.includes('/git/trees') }).impl),
    ).rejects.toBeTruthy();
    const result = await publishPending(env as any, null, ghMock().impl);
    expect(result.commit).toBe('COMMIT');
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM pending_publish').first<any>();
    expect(row.n).toBe(0);
  });

  it('records the publish in audit_log', async () => {
    await env.DB.prepare(`UPDATE slots SET r2_key='up/ab/n.deadbeef.webp' WHERE id='t.img.1'`).run();
    await env.DB.prepare(`INSERT INTO pending_publish (page_path) VALUES ('t.html')`).run();
    await publishPending(env as any, null, ghMock().impl);
    const row = await env.DB.prepare(`SELECT action FROM audit_log ORDER BY id DESC LIMIT 1`).first<any>();
    expect(row.action).toBe('publish');
  });
});

describe('sweepUnboundAssets', () => {
  it('removes an unbound asset older than 24 hours from D1 and R2', async () => {
    await env.BUCKET.put('up/zz/old.11111111.webp', new Uint8Array([1, 2, 3]));
    await env.DB.prepare(
      `INSERT INTO assets (r2_key, mime, sha256, origin, bound, created_at)
       VALUES ('up/zz/old.11111111.webp','image/webp','1','upload',0, datetime('now','-2 days'))`,
    ).run();
    expect(await sweepUnboundAssets(env as any)).toBe(1);
    expect(await env.BUCKET.get('up/zz/old.11111111.webp')).toBeNull();
  });

  it('keeps a bound asset and a recent unbound one', async () => {
    await env.DB.prepare(
      `INSERT INTO assets (r2_key, mime, sha256, origin, bound, created_at)
       VALUES ('up/zz/fresh.22222222.webp','image/webp','2','upload',0, datetime('now'))`,
    ).run();
    expect(await sweepUnboundAssets(env as any)).toBe(0);
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM assets').first<any>();
    expect(row.n).toBe(2);
  });
});

describe('publish routes', () => {
  it('lists pending pages for an authenticated user', async () => {
    await env.DB.prepare(`INSERT INTO pending_publish (page_path) VALUES ('t.html')`).run();
    const t = await token();
    const res = await exports.default.fetch('https://api.test/v1/publish/pending', {
      headers: { Authorization: `Bearer ${t}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ count: 1, pages: [{ pagePath: 't.html', attempts: 0 }] });
  });

  it('requires authentication for both routes', async () => {
    expect((await exports.default.fetch('https://api.test/v1/publish/pending')).status).toBe(401);
    expect((await exports.default.fetch('https://api.test/v1/publish', { method: 'POST' })).status).toBe(401);
  });
});

describe('GET /publish/pending labels each page', () => {
  // The confirm dialog used to look each pending path up in /v1/pages, which
  // lists only pages with photo slots -- so a gallery-only change produced a
  // dialog with an empty list. The label now comes from the server.
  const pending = async (t: string) =>
    (await (await exports.default.fetch('https://api.test/v1/publish/pending', {
      headers: { Authorization: `Bearer ${t}` },
    })).json<any>()).pages;

  beforeEach(async () => {
    for (const tbl of ['gallery_photos', 'gallery_events']) {
      await env.DB.prepare(`DELETE FROM ${tbl}`).run();
    }
  });

  it('names a gallery category page by its part name', async () => {
    await env.DB.prepare(
      `INSERT INTO pending_publish (page_path) VALUES ('pages/events/celebration.html')`,
    ).run();
    const rows = await pending(await token());
    expect(rows.find((r: any) => r.pagePath === 'pages/events/celebration.html').label).toBe('Celebrations');
  });

  it('names a gallery event page by its event title', async () => {
    await env.DB.prepare(
      `INSERT INTO gallery_events
         (id, category, slug, title, page_path, href, cover_src, new_tab, visible, position,
          indent, close_indent, page_owned, has_title_region)
       VALUES (77,'celebrations','xmas','CHRISTMAS DAY (2024)','pages/events/christmas2024.html',
               'christmas2024.html','c.jpg',1,1,1,'            ','        ',0,0)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO pending_publish (page_path) VALUES ('pages/events/christmas2024.html')`,
    ).run();
    const rows = await pending(await token());
    expect(rows.find((r: any) => r.pagePath === 'pages/events/christmas2024.html').label)
      .toBe('CHRISTMAS DAY (2024)');
  });

  it('falls back to the friendly name for a slot page', async () => {
    await env.DB.prepare(
      `INSERT INTO pending_publish (page_path) VALUES ('pages/about/OurFounder.html')`,
    ).run();
    const rows = await pending(await token());
    expect(rows.find((r: any) => r.pagePath === 'pages/about/OurFounder.html').label).toBe('Our Founder');
  });

  it('gives every pending page a non-empty label, so none can be dropped', async () => {
    for (const path of ['pages/events/celebration.html', 'index.html', 't.html']) {
      await env.DB.prepare('INSERT INTO pending_publish (page_path) VALUES (?)').bind(path).run();
    }
    const rows = await pending(await token());
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(typeof r.label === 'string' && r.label.length > 0).toBe(true);
  });
});
