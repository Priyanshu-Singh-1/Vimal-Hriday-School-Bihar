import { env, exports } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { hashPassword } from '../src/lib/password';

const WEBP_HEADER = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];

function webpBlob(padding = 100): Blob {
  return new Blob([new Uint8Array([...WEBP_HEADER, ...new Array(padding).fill(0x41)])],
    { type: 'image/webp' });
}

async function token(): Promise<string> {
  const { hash, salt, iterations } = await hashPassword('editorpass11');
  await env.DB.prepare(
    `INSERT INTO users (username, password_hash, salt, iterations, role)
     VALUES ('e1', ?, ?, ?, 'editor')`,
  ).bind(hash, salt, iterations).run();
  const res = await exports.default.fetch('https://api.test/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e1', password: 'editorpass11' }),
  });
  return (await res.json<any>()).token;
}

function upload(t: string, form: FormData) {
  return exports.default.fetch('https://api.test/v1/uploads', {
    method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: form,
  });
}

let t: string;
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM assets').run();
  await env.DB.prepare('DELETE FROM users').run();
  await env.DB.prepare('DELETE FROM login_attempts').run();
  t = await token();
});

describe('uploads', () => {
  it('requires authentication', async () => {
    const form = new FormData();
    form.set('file', webpBlob(), 'a.webp');
    expect((await exports.default.fetch('https://api.test/v1/uploads', { method: 'POST', body: form })).status).toBe(401);
  });

  it('stores the object in R2 and records an unbound asset', async () => {
    const form = new FormData();
    form.set('file', webpBlob(), 'School (6).jpeg');
    form.set('width', '1600');
    form.set('height', '900');
    const res = await upload(t, form);
    expect(res.status).toBe(201);

    const body = await res.json<any>();
    expect(body.r2Key).toMatch(/^up\/[0-9a-f]{2}\/school-6\.[0-9a-f]{8}\.webp$/);
    expect(body.mime).toBe('image/webp');
    expect(body.width).toBe(1600);

    expect(await env.BUCKET.get(body.r2Key)).not.toBeNull();
    const row = await env.DB.prepare('SELECT bound, origin FROM assets WHERE r2_key = ?')
      .bind(body.r2Key).first<any>();
    expect(row).toMatchObject({ bound: 0, origin: 'upload' });
  });

  it('rejects a file whose bytes are not an allowed image', async () => {
    const form = new FormData();
    form.set('file', new Blob([new TextEncoder().encode('#!/bin/sh\necho hi      ')]), 'evil.webp');
    const res = await upload(t, form);
    expect(res.status).toBe(415);
  });

  it('rejects a file over the 3 MB cap', async () => {
    const form = new FormData();
    form.set('file', webpBlob(3 * 1024 * 1024 + 1), 'big.webp');
    expect((await upload(t, form)).status).toBe(413);
  });

  it('rejects a request with no file part', async () => {
    expect((await upload(t, new FormData())).status).toBe(400);
  });

  it('stores an optional thumbnail alongside', async () => {
    const form = new FormData();
    form.set('file', webpBlob(), 'a.webp');
    form.set('thumb', webpBlob(50), 'a-thumb.webp');
    const body = await (await upload(t, form)).json<any>();
    expect(body.thumbKey).toMatch(/\.thumb\.webp$/);
    expect(await env.BUCKET.get(body.thumbKey)).not.toBeNull();
  });

  it('is idempotent for identical content and name', async () => {
    const mk = () => { const f = new FormData(); f.set('file', webpBlob(), 'same.webp'); return f; };
    const a = await (await upload(t, mk())).json<any>();
    const b = await (await upload(t, mk())).json<any>();
    expect(b.r2Key).toBe(a.r2Key);
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM assets').first<any>();
    expect(row.n).toBe(1);
  });
});
