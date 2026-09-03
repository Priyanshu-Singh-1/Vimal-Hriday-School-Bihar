import { env, exports } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { hashPassword } from '../src/lib/password';
import { MAX_PHOTOS_PER_BATCH, MAX_PHOTOS_PER_EVENT } from '../src/lib/galleryLimits';

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
  return exports.default.fetch(`https://api.test/v1/gallery${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

const dirty = async () => {
  const { results } = await env.DB.prepare('SELECT page_path FROM pending_publish ORDER BY page_path').all<{ page_path: string }>();
  return results.map((r) => r.page_path);
};

let t: string;
let eventId: number;

beforeEach(async () => {
  for (const table of [
    'pending_page_ops', 'pending_publish', 'audit_log', 'gallery_photos', 'gallery_events',
    'slots', 'assets', 'users', 'login_attempts',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  // Two events mirroring the live page: one shown, one hidden, neither owned.
  await env.DB.prepare(
    `INSERT INTO gallery_events
       (id, category, slug, title, page_path, href, cover_src, new_tab, visible, position,
        indent, close_indent, page_owned, has_title_region)
     VALUES
       (1,'celebrations','christmas2024','CHRISTMAS DAY (2024)','pages/events/christmas2024.html',
        'christmas2024.html','../../resources/Gallery/christmasDay24/cd%20(3).jpeg',1,1,1,'            ','        ',0,0),
       (2,'celebrations','teachersday2024','TEACHERS DAY (2024)','pages/events/teachersday2024.html',
        'teachersday2024.html','../../resources/Gallery/teachersDay2024/td%20(1).jpg',1,0,2,'            ','        ',0,0)`,
  ).run();

  await env.DB.prepare(
    `INSERT INTO gallery_photos (event_id, src, r2_key, position) VALUES
       (1,'../../resources/Gallery/christmasDay24/cd%20(1).jpeg',NULL,1),
       (1,'../../resources/Gallery/christmasDay24/cd%20(2).jpeg',NULL,2)`,
  ).run();

  eventId = 1;
  t = await tokenFor('editor');
});

describe('auth', () => {
  it('requires a token', async () => {
    expect((await exports.default.fetch('https://api.test/v1/gallery/categories')).status).toBe(401);
  });
});

describe('GET /categories', () => {
  it('lists all three parts of the gallery', async () => {
    const body = await (await api(t, '/categories')).json<any>();
    expect(body.map((c: any) => c.id).sort()).toEqual(['celebrations', 'cultural', 'noncurricular']);
  });

  it('reports the event and shown counts for a part', async () => {
    const body = await (await api(t, '/categories')).json<any>();
    const celebrations = body.find((c: any) => c.id === 'celebrations');
    expect(celebrations).toMatchObject({ label: 'Celebrations', eventCount: 2, shownCount: 1 });
  });

  it('reports zero for a part with no events seeded in this test', async () => {
    const body = await (await api(t, '/categories')).json<any>();
    expect(body.find((c: any) => c.id === 'cultural')).toMatchObject({ eventCount: 0, shownCount: 0 });
  });
});

describe('GET /categories/:id/events', () => {
  it('lists events in position order with photo counts', async () => {
    const body = await (await api(t, '/categories/celebrations/events')).json<any>();
    expect(body.map((e: any) => e.slug)).toEqual(['christmas2024', 'teachersday2024']);
    expect(body[0]).toMatchObject({ visible: true, photoCount: 2, pageOwned: false });
    expect(body[1]).toMatchObject({ visible: false, photoCount: 0 });
  });
});

describe('GET /events/:id', () => {
  it('returns the photos in order', async () => {
    const body = await (await api(t, `/events/${eventId}`)).json<any>();
    expect(body.photos.map((p: any) => p.src)).toEqual([
      '../../resources/Gallery/christmasDay24/cd%20(1).jpeg',
      '../../resources/Gallery/christmasDay24/cd%20(2).jpeg',
    ]);
  });

  it('404s for an unknown event', async () => {
    expect((await api(t, '/events/999')).status).toBe(404);
  });
});

describe('PATCH /events/:id', () => {
  it('renames an event and marks both pages dirty', async () => {
    const res = await api(t, `/events/${eventId}`, {
      method: 'PATCH', body: JSON.stringify({ title: 'Christmas Day 2024' }),
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT title FROM gallery_events WHERE id = ?').bind(eventId).first<any>();
    expect(row.title).toBe('Christmas Day 2024');
    expect(await dirty()).toContain('pages/events/celebration.html');
  });

  it('refuses a blank title in plain English', async () => {
    const res = await api(t, `/events/${eventId}`, { method: 'PATCH', body: JSON.stringify({ title: '   ' }) });
    expect(res.status).toBe(400);
    expect((await res.json<any>()).error).toBe('Please type a name for this event.');
  });

  it('refuses an over-long title', async () => {
    const res = await api(t, `/events/${eventId}`, { method: 'PATCH', body: JSON.stringify({ title: 'x'.repeat(121) }) });
    expect(res.status).toBe(400);
  });

  it('can hide and unhide', async () => {
    await api(t, `/events/${eventId}`, { method: 'PATCH', body: JSON.stringify({ visible: false }) });
    let row = await env.DB.prepare('SELECT visible FROM gallery_events WHERE id = ?').bind(eventId).first<any>();
    expect(row.visible).toBe(0);
    await api(t, `/events/${eventId}`, { method: 'PATCH', body: JSON.stringify({ visible: true }) });
    row = await env.DB.prepare('SELECT visible FROM gallery_events WHERE id = ?').bind(eventId).first<any>();
    expect(row.visible).toBe(1);
  });

  it('rejects a malformed body', async () => {
    expect((await api(t, `/events/${eventId}`, { method: 'PATCH', body: 'not json' })).status).toBe(400);
  });
});

describe('DELETE /events/:id', () => {
  it('hides by default, keeping the row and the page', async () => {
    const res = await api(t, `/events/${eventId}`, { method: 'DELETE' });
    expect(await res.json<any>()).toMatchObject({ mode: 'hide' });
    const row = await env.DB.prepare('SELECT visible FROM gallery_events WHERE id = ?').bind(eventId).first<any>();
    expect(row.visible).toBe(0);
    // The page file is untouched, so a direct link still works.
    expect(await dirty()).not.toContain('pages/events/christmas2024.html');
  });

  it('refuses to permanently delete a page it did not create', async () => {
    const res = await api(t, `/events/${eventId}?mode=delete`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect((await res.json<any>()).error).toContain('cannot be deleted here');
    // Still present.
    expect(await env.DB.prepare('SELECT id FROM gallery_events WHERE id = ?').bind(eventId).first()).toBeTruthy();
  });

  it('permanently deletes an owned page, queueing the file removal', async () => {
    await env.DB.prepare('UPDATE gallery_events SET page_owned = 1 WHERE id = ?').bind(eventId).run();
    const res = await api(t, `/events/${eventId}?mode=delete`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await env.DB.prepare('SELECT id FROM gallery_events WHERE id = ?').bind(eventId).first()).toBeNull();
    expect(await dirty()).toContain('pages/events/christmas2024.html');
  });

  it('cascades photos away with the event', async () => {
    await env.DB.prepare('UPDATE gallery_events SET page_owned = 1 WHERE id = ?').bind(eventId).run();
    await api(t, `/events/${eventId}?mode=delete`, { method: 'DELETE' });
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM gallery_photos WHERE event_id = ?').bind(eventId).first<any>();
    expect(left.n).toBe(0);
  });
});

describe('POST /events/:id/photos', () => {
  const seedAssets = async (n: number) => {
    const keys: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const key = `up/ab/photo${i}.webp`;
      await env.DB.prepare(
        `INSERT INTO assets (r2_key, mime, sha256, origin, bound) VALUES (?, 'image/webp', ?, 'upload', 0)`,
      ).bind(key, `sha${i}`).run();
      keys.push(key);
    }
    return keys;
  };

  it('attaches photos and marks the event page dirty', async () => {
    const keys = await seedAssets(3);
    const res = await api(t, `/events/${eventId}/photos`, { method: 'POST', body: JSON.stringify({ r2Keys: keys }) });
    expect(res.status).toBe(201);
    const rows = await env.DB.prepare('SELECT r2_key, position FROM gallery_photos WHERE event_id = ? ORDER BY position').bind(eventId).all<any>();
    // Appended after the two existing photos.
    expect(rows.results.map((r: any) => r.position)).toEqual([1, 2, 3, 4, 5]);
    expect(await dirty()).toContain('pages/events/christmas2024.html');
  });

  it('marks the uploaded assets bound', async () => {
    const keys = await seedAssets(2);
    await api(t, `/events/${eventId}/photos`, { method: 'POST', body: JSON.stringify({ r2Keys: keys }) });
    const a = await env.DB.prepare('SELECT bound FROM assets WHERE r2_key = ?').bind(keys[0]).first<any>();
    expect(a.bound).toBe(1);
  });

  it(`refuses more than ${MAX_PHOTOS_PER_BATCH} in one request`, async () => {
    const keys = await seedAssets(MAX_PHOTOS_PER_BATCH + 1);
    const res = await api(t, `/events/${eventId}/photos`, { method: 'POST', body: JSON.stringify({ r2Keys: keys }) });
    expect(res.status).toBe(413);
    expect((await res.json<any>()).error).toContain(`up to ${MAX_PHOTOS_PER_BATCH} photos at a time`);
  });

  it('refuses a batch that would exceed the per-event cap', async () => {
    // Fill the event to one short of the cap.
    const stmts: string[] = [];
    for (let i = 3; i <= MAX_PHOTOS_PER_EVENT; i += 1) stmts.push(`(${eventId},'x${i}.jpg',NULL,${i})`);
    await env.DB.prepare(`INSERT INTO gallery_photos (event_id, src, r2_key, position) VALUES ${stmts.join(',')}`).run();
    const keys = await seedAssets(2);
    const res = await api(t, `/events/${eventId}/photos`, { method: 'POST', body: JSON.stringify({ r2Keys: keys }) });
    expect(res.status).toBe(409);
  });

  it('refuses a key that is not a real uploaded asset', async () => {
    const res = await api(t, `/events/${eventId}/photos`, { method: 'POST', body: JSON.stringify({ r2Keys: ['up/made/up.webp'] }) });
    expect(res.status).toBe(400);
    expect((await res.json<any>()).error).toContain('no longer available');
  });

  it('refuses an empty list', async () => {
    expect((await api(t, `/events/${eventId}/photos`, { method: 'POST', body: JSON.stringify({ r2Keys: [] }) })).status).toBe(400);
  });

  it('404s for an unknown event', async () => {
    const keys = await seedAssets(1);
    expect((await api(t, '/events/999/photos', { method: 'POST', body: JSON.stringify({ r2Keys: keys }) })).status).toBe(404);
  });
});

describe('DELETE /events/:eventId/photos/:photoId', () => {
  it('removes one photo without renumbering the others', async () => {
    const before = await env.DB.prepare('SELECT id FROM gallery_photos WHERE event_id = ? ORDER BY position').bind(eventId).all<any>();
    const res = await api(t, `/events/${eventId}/photos/${before.results[0].id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const after = await env.DB.prepare('SELECT id FROM gallery_photos WHERE event_id = ?').bind(eventId).all<any>();
    expect(after.results).toHaveLength(1);
  });

  it('refuses to remove the last photo, since an event needs one', async () => {
    const rows = await env.DB.prepare('SELECT id FROM gallery_photos WHERE event_id = ? ORDER BY position').bind(eventId).all<any>();
    await api(t, `/events/${eventId}/photos/${rows.results[0].id}`, { method: 'DELETE' });
    const res = await api(t, `/events/${eventId}/photos/${rows.results[1].id}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect((await res.json<any>()).error).toContain('at least one photo');
  });

  it("404s for a photo that belongs to another event", async () => {
    const rows = await env.DB.prepare('SELECT id FROM gallery_photos WHERE event_id = 1').all<any>();
    expect((await api(t, `/events/2/photos/${rows.results[0].id}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('reordering', () => {
  it('reorders events and marks the category page dirty', async () => {
    const res = await api(t, '/categories/celebrations/order', { method: 'POST', body: JSON.stringify({ ids: [2, 1] }) });
    expect(res.status).toBe(200);
    const rows = await env.DB.prepare('SELECT id, position FROM gallery_events ORDER BY position').all<any>();
    expect(rows.results.map((r: any) => r.id)).toEqual([2, 1]);
    expect(await dirty()).toContain('pages/events/celebration.html');
  });

  it('refuses a partial event list, so nothing can be silently dropped', async () => {
    expect((await api(t, '/categories/celebrations/order', { method: 'POST', body: JSON.stringify({ ids: [1] }) })).status).toBe(400);
  });

  it('refuses an id from another category', async () => {
    expect((await api(t, '/categories/celebrations/order', { method: 'POST', body: JSON.stringify({ ids: [1, 999] }) })).status).toBe(400);
  });

  it('reorders photos within an event', async () => {
    const rows = await env.DB.prepare('SELECT id FROM gallery_photos WHERE event_id = ? ORDER BY position').bind(eventId).all<any>();
    const reversed = rows.results.map((r: any) => r.id).reverse();
    const res = await api(t, `/events/${eventId}/photos/order`, { method: 'POST', body: JSON.stringify({ ids: reversed }) });
    expect(res.status).toBe(200);
    const after = await env.DB.prepare('SELECT id FROM gallery_photos WHERE event_id = ? ORDER BY position').bind(eventId).all<any>();
    expect(after.results.map((r: any) => r.id)).toEqual(reversed);
  });
});

describe('audit', () => {
  it('records a plain action name for each gallery change', async () => {
    await api(t, `/events/${eventId}`, { method: 'PATCH', body: JSON.stringify({ title: 'Renamed' }) });
    await api(t, `/events/${eventId}`, { method: 'DELETE' });
    const { results } = await env.DB.prepare('SELECT action FROM audit_log ORDER BY id').all<any>();
    const actions = results.map((r: any) => r.action);
    expect(actions).toContain('gallery.event.update');
    expect(actions).toContain('gallery.event.hide');
  });
});

describe('POST /categories/:id/events', () => {
  // Every check below runs before the template is fetched from GitHub, so
  // these exercise the real validation path without any network.
  it('refuses a blank name', async () => {
    const res = await api(t, '/categories/celebrations/events', { method: 'POST', body: JSON.stringify({ title: '  ' }) });
    expect(res.status).toBe(400);
    expect((await res.json<any>()).error).toBe('Please type a name for this event.');
  });

  it('refuses an over-long name', async () => {
    const res = await api(t, '/categories/celebrations/events', { method: 'POST', body: JSON.stringify({ title: 'x'.repeat(121) }) });
    expect(res.status).toBe(400);
  });

  it('refuses a name with no letters or numbers', async () => {
    const res = await api(t, '/categories/celebrations/events', { method: 'POST', body: JSON.stringify({ title: '!!!' }) });
    expect(res.status).toBe(400);
    expect((await res.json<any>()).error).toContain('letters or numbers');
  });

  it('refuses a duplicate name in the same category', async () => {
    const res = await api(t, '/categories/celebrations/events', {
      method: 'POST', body: JSON.stringify({ title: 'christmas2024' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json<any>()).error).toContain('already an event with that name');
  });

  it('404s for an unknown category', async () => {
    const res = await api(t, '/categories/nope/events', { method: 'POST', body: JSON.stringify({ title: 'Sports Day' }) });
    expect(res.status).toBe(404);
  });

  it('rejects a malformed body', async () => {
    expect((await api(t, '/categories/celebrations/events', { method: 'POST', body: 'nope' })).status).toBe(400);
  });

  it('creates nothing when validation fails', async () => {
    await api(t, '/categories/celebrations/events', { method: 'POST', body: JSON.stringify({ title: '' }) });
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM gallery_events').first<any>();
    expect(n.n).toBe(2);
    const ops = await env.DB.prepare('SELECT COUNT(*) AS n FROM pending_page_ops').first<any>();
    expect(ops.n).toBe(0);
  });
});
