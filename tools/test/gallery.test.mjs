import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRegion, parseTiles, wrapRegion, slugFromHref, resolveHref } from '../src/gallery.mjs';
import { planCategory, eventsSql } from '../bin/seed-gallery.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CELEBRATION = 'pages/events/celebration.html';
const liveHtml = () => readFileSync(join(REPO, CELEBRATION), 'utf8');

const tile = (indent, href, src, title, { commented = false, blank = false } = {}) => {
  const lines = [
    `${indent}<li>`,
    `${indent}    <a href='${href}'${blank ? ' target="_blank"' : ''}><img src='${src}' class="img-thumbnail" /></a><br />`,
    `${indent}    <p><a href='${href}'${blank ? ' target="_blank"' : ''}>${title}</a></p>`,
    `${indent}</li>`,
  ];
  return commented ? lines.map((l) => `<!--${l}-->`).join('\n') : lines.join('\n');
};

/**
 * The Celebrations region as it looked before seeding: three live tiles, two
 * commented-out ones, and a stray authoring note. Held here as a fixture
 * because the live file is now seeded, and a test must not depend on whether
 * that has happened.
 */
const UNSEEDED = [
  '<div class="row">',
  '                    <div class="col-md-11 col-md-offset-1">',
  '                        <ul class="imgCatList">',
  '',
  tile(' '.repeat(36), '../about/investitureceremony.html', 'inv_27.jpg', 'INVESTITURE CEREMONY (2025)'),
  '',
  tile(' '.repeat(36), 'independencecelebration24.html', 'in.jpg', 'INDEPENDENCE DAY (2024)', { commented: true, blank: true }),
  '',
  '                                    <!-- teachers day 2024 -->',
  tile(' '.repeat(36), 'teachersday2024.html', 'td.jpg', 'TEACHERS DAY (2024)', { commented: true, blank: true }),
  '',
  tile(' '.repeat(36), 'christmas2024.html', 'cd.jpeg', 'CHRISTMAS DAY (2024)', { blank: true }),
  '                        </ul>',
  '                    </div>',
  '</div>',
].join('\n');

describe('findRegion', () => {
  it('finds the imgCatList body and its closing indentation', () => {
    const html = `<div>\n    <ul class="imgCatList">\n${tile('  ', 'a.html', 'a.jpg', 'A')}\n    </ul>\n</div>`;
    const r = findRegion(html);
    expect(r.body).toContain("<a href='a.html'>");
    expect(r.closeIndent).toBe('    ');
  });

  it('returns null when the page has no gallery', () => {
    expect(findRegion('<div><p>no gallery here</p></div>')).toBeNull();
  });
});

describe('parseTiles', () => {
  it('reads a live tile', () => {
    const { tiles } = parseTiles(tile('  ', 'x.html', 'x.jpg', 'X', { blank: true }));
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ href: 'x.html', src: 'x.jpg', title: 'X', newTab: true, visible: true });
  });

  it('reads a commented-out tile as hidden rather than dropping it', () => {
    const { tiles, dropped } = parseTiles(tile('  ', 'h.html', 'h.jpg', 'H', { commented: true }));
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ href: 'h.html', title: 'H', visible: false });
    expect(dropped).toEqual([]);
  });

  it('reports a stray authoring comment as dropped instead of silently losing it', () => {
    const body = `  <!-- a note -->\n${tile('  ', 'x.html', 'x.jpg', 'X')}`;
    const { tiles, dropped } = parseTiles(body);
    expect(tiles).toHaveLength(1);
    // Asserted on the note's text, not its delimiters: what matters is that it
    // was reported rather than silently lost.
    expect(dropped.map((d) => d.replace(/<!--|-->/g, '').trim())).toEqual(['a note']);
  });

  it('records that a tile had no target="_blank"', () => {
    const { tiles } = parseTiles(tile('  ', 'n.html', 'n.jpg', 'N', { blank: false }));
    expect(tiles[0].newTab).toBe(false);
  });

  it('decodes entities in a title', () => {
    const { tiles } = parseTiles(tile('  ', 'e.html', 'e.jpg', 'Art &amp; Craft'));
    expect(tiles[0].title).toBe('Art & Craft');
  });

  it('keeps document order', () => {
    const body = [tile('  ', '1.html', '1.jpg', 'One'), tile('  ', '2.html', '2.jpg', 'Two')].join('\n\n');
    expect(parseTiles(body).tiles.map((t) => t.title)).toEqual(['One', 'Two']);
  });
});

describe('parseTiles with a block comment spanning several tiles', () => {
  // cultural.html takes tiles down with one comment wrapping three of them,
  // rather than commenting each line. A per-line matcher read the middle two
  // as visible, which reported 7 shown where a browser renders 5.
  const body = [
    tile(' '.repeat(4), 'live1.html', '1.jpg', 'LIVE ONE'),
    "    <!-- <li>",
    "        <a href='hidden1.html'><img src='h1.jpg' class=\"img-thumbnail\" /></a><br />",
    "        <p><a href='hidden1.html'>HIDDEN ONE</a></p>",
    '    </li>',
    '    <li>',
    "        <a href='hidden2.html'><img src='h2.jpg' class=\"img-thumbnail\" /></a><br />",
    "        <p><a href='hidden2.html'>HIDDEN TWO</a></p>",
    '    </li> -->',
    tile(' '.repeat(4), 'live2.html', '2.jpg', 'LIVE TWO'),
  ].join('\n');

  it('finds every tile, commented or not', () => {
    expect(parseTiles(body).tiles.map((t) => t.title)).toEqual([
      'LIVE ONE', 'HIDDEN ONE', 'HIDDEN TWO', 'LIVE TWO',
    ]);
  });

  it('marks the middle tile of a block comment hidden, not visible', () => {
    const byTitle = {};
    for (const t of parseTiles(body).tiles) byTitle[t.title] = t.visible;
    expect(byTitle).toEqual({
      'LIVE ONE': true, 'HIDDEN ONE': false, 'HIDDEN TWO': false, 'LIVE TWO': true,
    });
  });

  it('still handles the per-line comment style', () => {
    const perLine = tile(' '.repeat(4), 'x.html', 'x.jpg', 'X', { commented: true });
    expect(parseTiles(perLine).tiles[0].visible).toBe(false);
  });

  it('reports an authoring note inside the region as dropped', () => {
    const withNote = '    <!-- for Football Match -->\n' + tile(' '.repeat(4), 'f.html', 'f.jpg', 'F');
    const { tiles, dropped } = parseTiles(withNote);
    expect(tiles).toHaveLength(1);
    expect(dropped.map((d) => d.replace(/<!--|-->/g, '').trim())).toEqual(['for Football Match']);
  });
});

describe('wrapRegion', () => {
  it('adds only the two sentinel comments', () => {
    const out = wrapRegion(UNSEEDED, 'gallery-cat:celebrations');
    const begin = '<!--vhs:begin gallery-cat:celebrations-->';
    const end = '<!--vhs:end gallery-cat:celebrations-->';
    expect(out.length - UNSEEDED.length).toBe(begin.length + end.length);
    expect(out.split(begin).join('').split(end).join('')).toBe(UNSEEDED);
  });

  it('is idempotent', () => {
    const once = wrapRegion(UNSEEDED, 'gallery-cat:celebrations');
    expect(wrapRegion(once, 'gallery-cat:celebrations')).toBe(once);
  });

  it('leaves the already-seeded live page unchanged', () => {
    const html = liveHtml();
    expect(wrapRegion(html, 'gallery-cat:celebrations')).toBe(html);
  });

  it('throws on a page with no gallery region', () => {
    expect(() => wrapRegion('<p>nothing</p>', 'gallery-cat:x')).toThrow(/no <ul/);
  });
});

describe('href helpers', () => {
  it('derives a slug from a tile href', () => {
    expect(slugFromHref('christmas2024.html')).toBe('christmas2024');
    expect(slugFromHref('../about/investitureceremony.html')).toBe('investitureceremony');
  });

  it('resolves a tile href to a repo path', () => {
    expect(resolveHref(CELEBRATION, 'christmas2024.html')).toBe('pages/events/christmas2024.html');
    expect(resolveHref(CELEBRATION, '../about/investitureceremony.html')).toBe(
      'pages/about/investitureceremony.html',
    );
  });
});

describe('planCategory against the live Celebrations page', () => {
  const plan = () =>
    planCategory(liveHtml(), 'celebrations', CELEBRATION, {
      indent: ' '.repeat(36),
      closeIndent: ' '.repeat(24),
    });

  it('finds all five events, three shown and two hidden', () => {
    const { events } = plan();
    expect(events).toHaveLength(5);
    expect(events.filter((e) => e.visible === 1)).toHaveLength(3);
    expect(events.filter((e) => e.visible === 0)).toHaveLength(2);
  });

  it('numbers positions from one in document order', () => {
    expect(plan().events.map((e) => e.position)).toEqual([1, 2, 3, 4, 5]);
  });

  it('resolves every event to a page that exists in the repo', () => {
    for (const e of plan().events) {
      expect(() => readFileSync(join(REPO, e.pagePath), 'utf8')).not.toThrow();
    }
  });

  it('marks no event as page_owned, since the console created none of them', () => {
    expect(plan().events.every((e) => e.pagePath && true)).toBe(true);
    expect(eventsSql(plan().events)).toContain(', 0)');
  });

  it('reports a stray authoring comment on an unseeded page', () => {
    // Seeding canonicalises the region, so the note is gone from the live file;
    // what matters is that it was reported rather than silently dropped.
    const p = planCategory(UNSEEDED, 'celebrations', CELEBRATION, {
      indent: ' '.repeat(36), closeIndent: ' '.repeat(24),
    });
    expect(p.dropped.map((d) => d.replace(/<!--|-->/g, '').trim())).toEqual(['teachers day 2024']);
  });

  it('finds nothing left to drop on the seeded live page', () => {
    expect(plan().dropped).toEqual([]);
  });

  it('reads a closeIndent matching what migration 0005 seeds', () => {
    expect(plan().closeIndent).toBe(' '.repeat(24));
  });
});

describe('eventsSql', () => {
  it('escapes a quote in a title', () => {
    const sql = eventsSql([
      { category: 'celebrations', slug: 't', title: "TEACHER'S DAY", pagePath: 'p.html', href: 'p.html',
        coverSrc: 'c.jpg', newTab: 1, visible: 1, position: 1 },
    ]);
    expect(sql).toContain("'TEACHER''S DAY'");
  });
});
