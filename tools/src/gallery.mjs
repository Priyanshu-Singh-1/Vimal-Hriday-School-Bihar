/**
 * Parses a gallery `<ul class="imgCatList">` region into event/photo rows and
 * wraps it in a sentinel pair.
 *
 * Two properties this must hold, both checked by tools/test/gallery.test.mjs:
 *
 *  1. Seeding adds ONLY the two sentinel comments. Every other byte of the
 *     page is preserved, so seeding cannot change what a visitor sees.
 *  2. Commented-out tiles are read back as hidden events rather than dropped.
 *     The live pages already use a commented `<li>` to take an event down, and
 *     regenerating the region from the database would otherwise delete them.
 */

// Event pages carry an id on the list (`id="imageGallery"`), category pages
// do not, so any further attributes are allowed after the class.
const UL_OPEN = /<ul\s+class="imgCatList"[^>]*>/i;

/**
 * Split a region into lines, recording for each whether its markup sits inside
 * an HTML comment.
 *
 * The live pages use two different styles to take a tile down, and one of them
 * spans several tiles at once:
 *
 *     <!--                <li>-->      per line (celebration.html)
 *     <!--                    ...-->
 *
 *     <!-- <li>                        one comment wrapping THREE tiles
 *            ...                       (cultural.html lines 7-20)
 *          </li>
 *          <li> ... </li>
 *          <li> ... </li> -->
 *
 * A per-line matcher reads the middle tiles of that second form as visible,
 * which is wrong: cultural.html shows 5 tiles to a visitor, not 7. So the
 * comment state is tracked across the whole region instead, and a line is
 * commented if it was inside a comment where its first non-space character
 * appeared.
 */
function annotateLines(body) {
  const lines = [];
  let inComment = false;
  let cur = { content: '', commented: false, sawContent: false };

  for (let i = 0; i < body.length; ) {
    if (!inComment && body.startsWith('<!--', i)) { inComment = true; i += 4; continue; }
    if (inComment && body.startsWith('-->', i)) { inComment = false; i += 3; continue; }

    const ch = body[i];
    if (ch === '\n') {
      lines.push(cur);
      cur = { content: '', commented: false, sawContent: false };
      i += 1;
      continue;
    }
    if (!cur.sawContent && ch.trim() !== '') {
      cur.sawContent = true;
      cur.commented = inComment;
    }
    cur.content += ch;
    i += 1;
  }
  lines.push(cur);
  return lines;
}

const A_TAG = /<a\s+href='([^']*)'([^>]*)>\s*<img\s+src='([^']*)'/i;
// `</p>` is optional: cultural.html's interSchool tile omits it, and
// requiring it made the title fall back to the slug ('interSchool').
const P_TAG = /<p>\s*<a\s+href='[^']*'[^>]*>([\s\S]*?)<\/a>/i;

/** Minimal entity decode for titles read back out of the html. */
function decode(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Locate the first imgCatList region. Returns the byte offsets of the region
 * body (between `<ul ...>` and its `</ul>`) plus the body itself.
 */
export function findRegion(html) {
  const open = UL_OPEN.exec(html);
  if (!open) return null;
  const bodyStart = open.index + open[0].length;

  // The gallery lists never nest a <ul>, so the next </ul> is the match.
  const close = html.indexOf('</ul>', bodyStart);
  if (close === -1) return null;

  const body = html.slice(bodyStart, close);

  // Indentation of the `</ul>`, taken from the `<ul>` itself rather than from
  // the region's last line: on a page already wrapped, that line ends with our
  // own end-sentinel, which is not indentation.
  const lineStart = html.lastIndexOf('\n', open.index) + 1;
  const ulIndent = html.slice(lineStart, open.index);
  const closeIndent = /^[ \t]*$/.test(ulIndent) ? ulIndent : '';

  return { bodyStart, bodyEnd: close, body, closeIndent, ulIndent: closeIndent };
}

/**
 * Split a region body into tiles. Each tile is one `<li>`..`</li>` run;
 * anything else (blank lines, stray authoring comments) is returned in
 * `dropped` so the caller can report what regenerating the region will lose.
 */
export function parseTiles(body) {
  const tiles = [];
  const dropped = [];

  // A page wrapped on an earlier run has the sentinel comments inside the
  // region. They are ours, not content, so drop them before parsing tiles --
  // otherwise re-seeding would report them as content about to be lost, and
  // the scanner below would treat them as comment spans.
  const lines = annotateLines(body.replace(/<!--vhs:(?:begin|end) [^>]*?-->/g, ''));
  let current = null;

  for (const entry of lines) {
    const commented = entry.commented;
    const content = entry.content;
    const raw = commented ? `<!--${content}-->` : content;
    const trimmed = content.trim();

    if (!trimmed) continue;

    if (trimmed === '<li>') {
      current = { lines: [], commented, indent: content.slice(0, content.indexOf('<')) };
      continue;
    }

    if (trimmed === '</li>') {
      if (!current) {
        dropped.push(raw);
        continue;
      }
      const joined = current.lines.join('\n');
      const a = A_TAG.exec(joined);
      if (!a) {
        dropped.push(...current.lines);
        current = null;
        continue;
      }
      const p = P_TAG.exec(joined);
      tiles.push({
        href: decode(a[1]),
        src: decode(a[3]),
        title: p ? decode(p[1].trim()) : null,
        newTab: /target\s*=\s*"_blank"/i.test(a[2]),
        visible: !current.commented,
        indent: current.indent,
      });
      current = null;
      continue;
    }

    if (current) current.lines.push(content);
    else dropped.push(raw);
  }

  if (current) dropped.push(...current.lines);
  return { tiles, dropped };
}

/**
 * Insert the sentinel pair around the region body. Adds exactly the two
 * comment strings and changes nothing else.
 */
export function wrapRegion(html, sentinelId) {
  const region = findRegion(html);
  if (!region) throw new Error('no <ul class="imgCatList"> region found');

  const begin = `<!--vhs:begin ${sentinelId}-->`;
  if (html.includes(begin)) return html; // idempotent

  return (
    html.slice(0, region.bodyStart) +
    begin +
    region.body +
    `<!--vhs:end ${sentinelId}-->` +
    html.slice(region.bodyEnd)
  );
}

/** Slug for an event, derived from its tile href. */
export function slugFromHref(href) {
  const file = href.split('/').pop() || href;
  return file.replace(/\.html?$/i, '');
}

/**
 * Repo-relative path of the event page a tile links to, resolved against the
 * category page's own directory.
 */
export function resolveHref(categoryPagePath, href) {
  const parts = categoryPagePath.split('/').slice(0, -1);
  for (const seg of href.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/**
 * Mirror of worker/src/render/galleryList.ts `renderGalleryList`, so the
 * codemod writes exactly the bytes the Worker will re-render on publish. Both
 * are pinned to the same literal expectations (tools/test/gallery.test.mjs and
 * worker/test/galleryList.test.ts), so they cannot drift apart silently.
 */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escAttr = (v) => String(v).replace(/[&<>"']/g, (c) => ESCAPES[c]);

export function renderTiles(tiles, format) {
  const blocks = tiles.map((t) => {
    const inner = format.indent + '    ';
    const target = t.newTab === false ? '' : ' target="_blank"';
    const href = escAttr(t.href);
    const lines = [
      `${format.indent}<li>`,
      `${inner}<a href='${href}'${target}><img src='${escAttr(t.src)}' class="img-thumbnail" /></a><br />`,
    ];
    if (t.title != null && t.title !== '') {
      lines.push(`${inner}<p><a href='${href}'${target}>${escAttr(t.title)}</a></p>`);
    }
    lines.push(`${format.indent}</li>`);
    return t.visible === false ? lines.map((l) => `<!--${l}-->`).join('\n') : lines.join('\n');
  });

  if (!blocks.length) return `\n${format.closeIndent}`;
  return `\n${blocks.join('\n\n')}\n${format.closeIndent}`;
}

/**
 * Put `inner` between the sentinel pair for `id`, inserting the pair when the
 * page has not been wrapped yet.
 *
 * Seeding canonicalises the region rather than preserving the hand-written
 * bytes. If it did not, the region on disk would never match what the Worker
 * renders, and the very first publish would rewrite every gallery page at once
 * -- a huge diff that would bury the actual change. The caller must verify
 * that the images and their order are unchanged.
 */
export function writeRegion(html, id, inner) {
  const begin = `<!--vhs:begin ${id}-->`;
  const end = `<!--vhs:end ${id}-->`;

  const b = html.indexOf(begin);
  if (b !== -1) {
    const e = html.indexOf(end, b);
    if (e === -1) throw new Error(`begin sentinel for "${id}" has no end`);
    return html.slice(0, b + begin.length) + inner + html.slice(e);
  }

  const region = findRegion(html);
  if (!region) throw new Error('no <ul class="imgCatList"> region found');
  return (
    html.slice(0, region.bodyStart) + begin + inner + end + html.slice(region.bodyEnd)
  );
}
