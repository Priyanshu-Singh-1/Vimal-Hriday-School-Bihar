/**
 * Resolve a slot's stored image path to an absolute URL for the admin console.
 * `originalSrc` may already be absolute (already-hosted media), in which case
 * it is passed through untouched. Otherwise it is resolved as a path relative
 * to `pagePath`'s own directory — the same rule a browser applies to an
 * `<img src>` on that page — normalising any `../` and `./` segments, then
 * prefixed with `siteBase`. Percent-encoding already present in `originalSrc`
 * is preserved byte-for-byte: the path is only split and rejoined on `/`,
 * never decoded or re-encoded.
 */
export function absoluteImageUrl(originalSrc: string, pagePath: string, siteBase: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(originalSrc)) return originalSrc;

  const pageDir = pagePath.includes('/') ? pagePath.slice(0, pagePath.lastIndexOf('/')) : '';
  const combined = pageDir ? `${pageDir}/${originalSrc}` : originalSrc;

  const segments: string[] = [];
  for (const part of combined.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }

  return `${siteBase.replace(/\/+$/, '')}/${segments.join('/')}`;
}

/**
 * Absolute URL for a slot's current image: a bound `r2Key` resolves against
 * `r2Base` (already the rule the render layer uses); an unedited slot's
 * `original_src` resolves against `siteBase` via `absoluteImageUrl`.
 */
export function slotAbsoluteSrc(
  slot: { r2_key: string | null; original_src: string; page_path: string },
  r2Base: string,
  siteBase: string,
): string {
  if (slot.r2_key) return `${r2Base.replace(/\/+$/, '')}/${slot.r2_key.replace(/^\/+/, '')}`;
  return absoluteImageUrl(slot.original_src, slot.page_path, siteBase);
}
