const MAX_SLUG = 60;

export function slugify(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const slug = base
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
  return slug || 'img';
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Content-addressed and URL-safe: no spaces, parentheses, or percent-escapes. */
export function buildKey(originalName: string, sha: string, ext: string): string {
  return `up/${sha.slice(0, 2)}/${slugify(originalName)}.${sha.slice(0, 8)}.${ext}`;
}
