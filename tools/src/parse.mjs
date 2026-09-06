import { posix } from 'node:path';
export { isChrome, CHROME } from './chrome.mjs';

const COMMENT = /<!--[\s\S]*?-->/g;
const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTR = /\bsrc\s*=\s*(['"])(.*?)\1/i;
const ALT_ATTR = /\balt\s*=\s*(['"])(.*?)\1/i;

/**
 * Blank out HTML comments while preserving total length, so indices taken from
 * the result map exactly onto the original string.
 */
export function stripComments(html) {
  return html.replace(COMMENT, (m) => ' '.repeat(m.length));
}

export function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Live <img> tags only — anything inside a comment is invisible here. */
export function extractImageTags(html) {
  const live = stripComments(html);
  const out = [];
  for (const m of live.matchAll(IMG_TAG)) {
    const tag = html.slice(m.index, m.index + m[0].length);
    const src = SRC_ATTR.exec(tag);
    if (!src) continue;
    const alt = ALT_ATTR.exec(tag);
    out.push({ tag, index: m.index, src: src[2], alt: alt ? alt[2] : '' });
  }
  return out;
}

/**
 * Resolve a page-relative src to a repo-relative POSIX path, percent-decoded.
 * Returns null for remote URLs and for anything that escapes the repo root.
 */
export function resolveRef(pageRepoPath, rawSrc) {
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(rawSrc)) return null;
  if (rawSrc.startsWith('data:')) return null;
  const decoded = safeDecode(rawSrc);
  const resolved = posix.normalize(posix.join(posix.dirname(pageRepoPath), decoded));
  if (resolved.startsWith('..') || posix.isAbsolute(resolved)) return null;
  return resolved;
}

function pageKey(pageRepoPath) {
  return posix
    .basename(pageRepoPath)
    .replace(/\.html?$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function slotIdFor(pageRepoPath, n) {
  return `${pageKey(pageRepoPath)}.img.${n}`;
}

export function labelFor(pageRepoPath, n) {
  return `${posix.basename(pageRepoPath).replace(/\.html?$/i, '')} — image ${n}`;
}
