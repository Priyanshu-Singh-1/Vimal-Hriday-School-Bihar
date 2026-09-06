import { Hono } from 'hono';
import type { Env, Vars } from '../env';
import { requireAuth } from '../lib/middleware';
import { writeAudit } from '../lib/audit';
import { sniffImage, extFor } from '../lib/sniff';
import { buildKey, sha256Hex } from '../lib/keys';

const MAX_BYTES = 3 * 1024 * 1024;

export const uploads = new Hono<{ Bindings: Env; Variables: Vars }>();

uploads.use('*', requireAuth);

uploads.post('/', async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'expected multipart/form-data' }, 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ error: 'missing file part' }, 400);
  if (file.size > MAX_BYTES) return c.json({ error: 'file exceeds 3 MB' }, 413);

  const buf = await file.arrayBuffer();
  const mime = sniffImage(new Uint8Array(buf.slice(0, 16)));
  if (!mime) return c.json({ error: 'file is not a WebP, JPEG, or PNG image' }, 415);

  const sha = await sha256Hex(buf);
  const r2Key = buildKey(file.name || 'image', sha, extFor(mime));

  await c.env.BUCKET.put(r2Key, buf, {
    httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' },
  });

  let thumbKey: string | null = null;
  const thumb = form.get('thumb');
  if (thumb instanceof File && thumb.size > 0 && thumb.size <= MAX_BYTES) {
    const tbuf = await thumb.arrayBuffer();
    const tmime = sniffImage(new Uint8Array(tbuf.slice(0, 16)));
    if (tmime) {
      thumbKey = r2Key.replace(/\.([a-z0-9]+)$/, '.thumb.$1');
      await c.env.BUCKET.put(thumbKey, tbuf, {
        httpMetadata: { contentType: tmime, cacheControl: 'public, max-age=31536000, immutable' },
      });
    }
  }

  const width = Number(form.get('width')) || null;
  const height = Number(form.get('height')) || null;

  await c.env.DB.prepare(
    `INSERT INTO assets (r2_key, thumb_key, width, height, bytes, mime, sha256, origin, uploaded_by, bound)
     VALUES (?,?,?,?,?,?,?, 'upload', ?, 0)
     ON CONFLICT(r2_key) DO UPDATE SET thumb_key = COALESCE(excluded.thumb_key, assets.thumb_key)`,
  )
    .bind(r2Key, thumbKey, width, height, file.size, mime, sha, c.var.user.id)
    .run();

  await writeAudit(c.env.DB, c.var.user, 'asset.upload', r2Key, { bytes: file.size, mime });

  return c.json({ r2Key, thumbKey, width, height, bytes: file.size, mime }, 201);
});
