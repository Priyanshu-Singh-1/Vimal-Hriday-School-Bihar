#!/usr/bin/env node
/**
 * Converts an event page from the sequential `loadGalleryImages()` loader to
 * an explicit, sentinel-wrapped photo list.
 *
 * Why this is required: the loader walks `prefix1.ext … prefixN.ext` by
 * number, so removing photo 3 of 7 would leave a gap the loop cannot express.
 * An explicit list has no such constraint.
 *
 * The loader also calls `gallery.empty()` before appending, so leaving it in
 * place would wipe the static list on page load. Both the loader `<script
 * src>` and the inline call are therefore removed. `js/gallery-loader.js`
 * itself is left untouched.
 *
 * Dry run by default; --apply writes. Verification is built in: the ordered
 * list of image paths after conversion must equal the paths the loader would
 * have generated, or the page is refused.
 *
 *   node tools/bin/convert-gallery-loader.mjs            # all pages, dry run
 *   node tools/bin/convert-gallery-loader.mjs --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTiles } from '../src/gallery.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const CALL_RE =
  /loadGalleryImages\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*(\d+)\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)\s*;?/;

/** Paths the loader would have produced, in order. */
export function loaderPaths({ basePath, count, prefix, ext }) {
  return Array.from({ length: count }, (_, i) => `${basePath}${prefix}${i + 1}.${ext}`);
}

/** Extract the loader call's arguments, or null when a page has none. */
export function readLoaderCall(html) {
  const m = CALL_RE.exec(html);
  if (!m) return null;
  return { galleryId: m[1], basePath: m[2], count: Number(m[3]), prefix: m[4], ext: m[5] };
}

/** Remove the inline `<script>` element that contains the loader call. */
function stripInlineCall(html) {
  const at = html.indexOf('loadGalleryImages(');
  if (at === -1) return html;
  const open = html.lastIndexOf('<script', at);
  const close = html.indexOf('</script>', at);
  if (open === -1 || close === -1) throw new Error('loader call is not inside a <script> element');

  let start = open;
  let end = close + '</script>'.length;
  // Take the whole line, including the indentation before <script>.
  while (start > 0 && (html[start - 1] === ' ' || html[start - 1] === '\t')) start -= 1;
  if (start > 0 && html[start - 1] === '\n') start -= 1;
  return html.slice(0, start) + html.slice(end);
}

/** Remove the `<script src=".../gallery-loader.js">` tag and its comment. */
function stripLoaderScript(html) {
  return html
    .replace(/\n[ \t]*<!--\s*Dynamic Image Gallery Script\s*-->/i, '')
    .replace(/\n[ \t]*<script[^>]*src="[^"]*gallery-loader\.js"[^>]*>\s*<\/script>/i, '');
}

/**
 * Replace the gallery `<ul>` body with a sentinel-wrapped explicit list.
 * Locates the ul by the id the loader was targeting, so a page with more than
 * one list cannot be confused.
 */
export function convert(html, sentinelId) {
  const call = readLoaderCall(html);
  if (!call) return null;

  const ulRe = new RegExp(`([ \\t]*)<ul\\s+class="imgCatList"\\s+id="${call.galleryId}"\\s*>`, 'i');
  const open = ulRe.exec(html);
  if (!open) throw new Error(`no <ul class="imgCatList" id="${call.galleryId}"> found`);

  const ulIndent = open[1];
  const bodyStart = open.index + open[0].length;
  const close = html.indexOf('</ul>', bodyStart);
  if (close === -1) throw new Error('unclosed gallery <ul>');

  const paths = loaderPaths(call);
  const tiles = paths.map((p) => ({ href: p, src: p, title: null, newTab: true }));
  const inner = renderTiles(tiles, { indent: ulIndent + '    ', closeIndent: ulIndent });

  let out =
    html.slice(0, bodyStart) +
    `<!--vhs:begin ${sentinelId}-->` +
    inner +
    `<!--vhs:end ${sentinelId}-->` +
    // `inner` already ends with a newline plus the closing indentation, so the
    // slice resumes exactly at `</ul>`.
    html.slice(close);

  out = stripInlineCall(out);
  out = stripLoaderScript(out);

  return { converted: out, call, paths, tiles };
}

/** Ordered image srcs currently in a page's gallery list. */
export function srcsIn(html) {
  return [...html.matchAll(/<img\s+src='([^']*)'\s+class="img-thumbnail"/g)].map((m) => m[1]);
}

export const PAGES = [
  ['pages/about/investitureceremony.html', 'investitureceremony'],
  ['pages/events/classMonitor.html', 'classMonitor'],
  ['pages/events/teacherSeminar.html', 'teacherSeminar'],
  ['pages/events/drugAwarness.html', 'drugAwarness'],
  ['pages/events/planting.html', 'planting'],
  ['pages/events/donnaMarry.html', 'donnaMarry'],
  ['pages/events/election.html', 'election'],
  ['pages/events/drawing.html', 'drawing'],
];

function main() {
  const apply = process.argv.includes('--apply');
  let failures = 0;

  for (const [page, slug] of PAGES) {
    const abs = join(REPO, page);
    const html = readFileSync(abs, 'utf8');

    if (html.includes(`<!--vhs:begin gallery-event:${slug}-->`)) {
      console.log(`  skip     ${page} (already converted)`);
      continue;
    }

    let result;
    try {
      result = convert(html, `gallery-event:${slug}`);
    } catch (err) {
      console.log(`  FAILED   ${page}: ${err.message}`);
      failures += 1;
      continue;
    }
    if (!result) {
      console.log(`  skip     ${page} (no loader call)`);
      continue;
    }

    // The property that matters: the same images, in the same order.
    const after = srcsIn(result.converted);
    const same = after.length === result.paths.length && after.every((s, i) => s === result.paths[i]);
    const loaderGone =
      !result.converted.includes('loadGalleryImages(') &&
      !result.converted.includes('gallery-loader.js');

    if (!same || !loaderGone) {
      console.log(
        `  FAILED   ${page}: paths ${same ? 'ok' : 'DIFFER'}, loader ${loaderGone ? 'removed' : 'STILL PRESENT'}`,
      );
      failures += 1;
      continue;
    }

    console.log(
      `  ok       ${page}  ${result.paths.length} photos  ` +
        `(${result.call.prefix || '<no prefix>'}1..${result.call.count}.${result.call.ext})`,
    );
    if (apply) writeFileSync(abs, result.converted);
  }

  console.log(apply ? '\n  written' : '\n  dry run — pass --apply to write');
  if (failures) {
    console.log(`  ${failures} page(s) refused; nothing written for them`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
