import { env } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderPage } from '../src/render/page';

const CATEGORY_PAGE = 'pages/events/celebration.html';
const EVENT_PAGE = 'pages/events/christmas2024.html';
const R2 = 'https://img.example.test';

/** A minimal category page carrying only the sentinel pair, as the seeder leaves it. */
const categoryHtml = (inner: string) =>
  `<div>\n                        <ul class="imgCatList"><!--vhs:begin gallery-cat:celebrations-->${inner}<!--vhs:end gallery-cat:celebrations--></ul>\n</div>`;

const eventHtml = (inner: string) =>
  `<div>\n        <ul class="imgCatList"><!--vhs:begin gallery-event:christmas2024-->${inner}<!--vhs:end gallery-event:christmas2024--></ul>\n</div>`;

beforeEach(async () => {
  for (const t of ['pending_page_ops', 'pending_publish', 'gallery_photos', 'gallery_events', 'assets']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.prepare(
    `INSERT INTO gallery_events
       (id, category, slug, title, page_path, href, cover_src, new_tab, visible, position,
        indent, close_indent, page_owned, has_title_region)
     VALUES
       (1,'celebrations','christmas2024','CHRISTMAS DAY (2024)','${EVENT_PAGE}',
        'christmas2024.html','../../resources/Gallery/christmasDay24/cd%20(3).jpeg',1,1,1,
        '            ','        ',0,0),
       (2,'celebrations','teachersday2024','TEACHERS DAY (2024)','pages/events/teachersday2024.html',
        'teachersday2024.html','../../resources/Gallery/teachersDay2024/td%20(1).jpg',1,0,2,
        '            ','        ',0,0)`,
  ).run();
});

describe('rendering a category page', () => {
  it('renders a shown event as a live tile and a hidden one as a comment', async () => {
    const out = await renderPage(env.DB, CATEGORY_PAGE, categoryHtml('OLD'), R2);
    expect(out).toContain("<a href='christmas2024.html' target=\"_blank\">");
    expect(out).toContain('CHRISTMAS DAY (2024)');
    // The hidden event survives as a commented tile rather than vanishing.
    expect(out).toContain('<!--                                    <li>-->');
    expect(out).toContain('TEACHERS DAY (2024)');
  });

  it('changes nothing outside the sentinel pair', async () => {
    const before = categoryHtml('OLD');
    const out = await renderPage(env.DB, CATEGORY_PAGE, before, R2);
    expect(out.startsWith('<div>\n                        <ul class="imgCatList">')).toBe(true);
    expect(out.endsWith('</ul>\n</div>')).toBe(true);
  });

  it('reflects a reorder', async () => {
    await env.DB.prepare('UPDATE gallery_events SET position = 1 WHERE id = 2').run();
    await env.DB.prepare('UPDATE gallery_events SET position = 2 WHERE id = 1').run();
    const out = await renderPage(env.DB, CATEGORY_PAGE, categoryHtml('OLD'), R2);
    expect(out.indexOf('TEACHERS DAY')).toBeLessThan(out.indexOf('CHRISTMAS DAY'));
  });

  it('renders an empty category without collapsing the list', async () => {
    await env.DB.prepare('DELETE FROM gallery_events').run();
    const out = await renderPage(env.DB, CATEGORY_PAGE, categoryHtml('OLD'), R2);
    expect(out).not.toContain('<li>');
    expect(out).toContain('<ul class="imgCatList">');
  });
});

describe('rendering an event page', () => {
  it('uses the path as-is for a photo already in the repo', async () => {
    await env.DB.prepare(
      `INSERT INTO gallery_photos (event_id, src, r2_key, position)
       VALUES (1,'../../resources/Gallery/christmasDay24/cd%20(1).jpeg',NULL,1)`,
    ).run();
    const out = await renderPage(env.DB, EVENT_PAGE, eventHtml('OLD'), R2);
    expect(out).toContain("src='../../resources/Gallery/christmasDay24/cd%20(1).jpeg'");
    expect(out).not.toContain(R2);
  });

  it('builds an absolute R2 url for an uploaded photo', async () => {
    await env.DB.prepare(
      `INSERT INTO assets (r2_key, mime, sha256, origin, bound) VALUES ('up/ab/x.webp','image/webp','s1','upload',1)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO gallery_photos (event_id, src, r2_key, position) VALUES (1,'','up/ab/x.webp',1)`,
    ).run();
    const out = await renderPage(env.DB, EVENT_PAGE, eventHtml('OLD'), R2);
    expect(out).toContain(`src='${R2}/up/ab/x.webp'`);
    // A photo links to itself, as the old loader did.
    expect(out).toContain(`<a href='${R2}/up/ab/x.webp' target="_blank">`);
  });

  it('carries no caption on a photo', async () => {
    await env.DB.prepare(
      `INSERT INTO gallery_photos (event_id, src, r2_key, position) VALUES (1,'a.jpg',NULL,1)`,
    ).run();
    const out = await renderPage(env.DB, EVENT_PAGE, eventHtml('OLD'), R2);
    expect(out).not.toContain('<p>');
  });

  it('keeps photo order', async () => {
    await env.DB.prepare(
      `INSERT INTO gallery_photos (event_id, src, r2_key, position) VALUES
        (1,'one.jpg',NULL,1),(1,'two.jpg',NULL,2),(1,'three.jpg',NULL,3)`,
    ).run();
    const out = await renderPage(env.DB, EVENT_PAGE, eventHtml('OLD'), R2);
    expect(out.indexOf('one.jpg')).toBeLessThan(out.indexOf('two.jpg'));
    expect(out.indexOf('two.jpg')).toBeLessThan(out.indexOf('three.jpg'));
  });
});

describe('safety', () => {
  it('leaves a page with no gallery and no slots untouched', async () => {
    const html = '<html><body><p>An ordinary page</p></body></html>';
    expect(await renderPage(env.DB, 'pages/about/AboutSchool.html', html, R2)).toBe(html);
  });

  it('refuses a page whose sentinel is missing rather than committing it', async () => {
    await expect(renderPage(env.DB, CATEGORY_PAGE, '<ul class="imgCatList"></ul>', R2)).rejects.toThrow();
  });

  it('renders the title region only for a generated page', async () => {
    // Event 1 predates the console, so no title region is expected...
    const out = await renderPage(env.DB, EVENT_PAGE, eventHtml(''), R2);
    expect(out).not.toContain('gallery-title');

    // ...but a generated one has both regions, and both must be present.
    await env.DB.prepare('UPDATE gallery_events SET has_title_region = 1 WHERE id = 1').run();
    const withTitle =
      eventHtml('') .replace('</ul>', '</ul><h3><!--vhs:begin gallery-title:christmas2024-->old<!--vhs:end gallery-title:christmas2024--></h3>');
    const out2 = await renderPage(env.DB, EVENT_PAGE, withTitle, R2);
    expect(out2).toContain('>CHRISTMAS DAY (2024)<');
  });
});
