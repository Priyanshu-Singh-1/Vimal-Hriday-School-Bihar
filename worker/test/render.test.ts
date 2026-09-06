import { env } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { slotSrc, renderSlotTag, escapeAttr, type SlotRow } from '../src/render/slot';
import { renderPage } from '../src/render/page';

const BASE = 'https://img.test';

const slot = (over: Partial<SlotRow> = {}) => ({
  id: 'p.img.1', page_path: 'p.html', label: 'l', optional: 0,
  r2_key: null, original_src: '../../resources/a/b.jpg', alt: 'Alt', ...over,
});

describe('escapeAttr', () => {
  it('escapes the characters that would break an attribute', () => {
    expect(escapeAttr('a"b<c>d&e')).toBe('a&quot;b&lt;c&gt;d&amp;e');
  });
  it('escapes ampersand before the entities it introduces', () => {
    expect(escapeAttr('&quot;')).toBe('&amp;quot;');
  });
});

describe('slotSrc', () => {
  it('uses original_src while r2_key is null', () => {
    expect(slotSrc(slot(), BASE)).toBe('../../resources/a/b.jpg');
  });
  it('uses the R2 public URL once r2_key is set', () => {
    expect(slotSrc(slot({ r2_key: 'mgmt/x.abc123.webp' }), BASE)).toBe(`${BASE}/mgmt/x.abc123.webp`);
  });
  it('does not double a slash when the base ends in one', () => {
    expect(slotSrc(slot({ r2_key: 'a.webp' }), 'https://img.test/')).toBe('https://img.test/a.webp');
  });
});

describe('renderSlotTag', () => {
  const tag = '<img data-vhs-slot="p.img.1" alt="Alt" src="../../resources/a/b.jpg">';

  it('leaves an unedited tag byte-identical', () => {
    expect(renderSlotTag(tag, slot(), BASE)).toBe(tag);
  });

  it('swaps only the src value once r2_key is set', () => {
    expect(renderSlotTag(tag, slot({ r2_key: 'mgmt/x.abc123.webp' }), BASE))
      .toBe('<img data-vhs-slot="p.img.1" alt="Alt" src="https://img.test/mgmt/x.abc123.webp">');
  });

  it('escapes a hostile src value', () => {
    expect(renderSlotTag(tag, slot({ original_src: '"><script>' }), BASE))
      .toContain('src="&quot;&gt;&lt;script&gt;"');
  });

  it('leaves a percent-encoded original src encoded', () => {
    expect(renderSlotTag(tag, slot({ original_src: '../r/School%20(6).jpeg' }), BASE))
      .toContain('src="../r/School%20(6).jpeg"');
  });

  it('updates alt in place when it differs', () => {
    expect(renderSlotTag(tag, slot({ alt: 'New' }), BASE))
      .toBe('<img data-vhs-slot="p.img.1" alt="New" src="../../resources/a/b.jpg">');
  });

  it('escapes a hostile alt value', () => {
    expect(renderSlotTag(tag, slot({ alt: '"><script>' }), BASE))
      .toContain('alt="&quot;&gt;&lt;script&gt;"');
  });

  it('inserts alt right after <img when the tag has none', () => {
    const noAlt = '<img data-vhs-slot="p.img.1" src="../../resources/a/b.jpg">';
    expect(renderSlotTag(noAlt, slot({ alt: 'New' }), BASE))
      .toBe('<img alt="New" data-vhs-slot="p.img.1" src="../../resources/a/b.jpg">');
  });

  it('never injects alt="" into a tag that never had one', () => {
    const noAlt = '<img data-vhs-slot="p.img.1" src="../../resources/a/b.jpg">';
    expect(renderSlotTag(noAlt, slot({ alt: '' }), BASE)).toBe(noAlt);
  });

  it('throws naming the slot id when the tag has no src attribute', () => {
    expect(() => renderSlotTag('<img data-vhs-slot="p.img.1">', slot(), BASE)).toThrow(/p\.img\.1/);
  });
});

// The reader (tools/src/parse.mjs IMG_TAG) matches <img case-insensitively,
// so an uppercase tag can reach renderSlotTag even though none exist on the
// live site today. These prove the writer stays consistent with the reader.
describe('renderSlotTag against uppercase tags', () => {
  const fixtures: Array<{ id: string; tag: string; src: string; alt: string }> = [
    {
      id: 'x.img.1',
      tag: '<IMG data-vhs-slot="x.img.1" SRC="resources/a.jpg" width="50%" class="img-rounded"/>',
      src: 'resources/a.jpg',
      alt: '',
    },
    {
      id: 'x.img.2',
      tag: '<IMG data-vhs-slot="x.img.2" CLASS="img-responsive" SRC="resources/b.jpg" ALT=" " />',
      src: 'resources/b.jpg',
      alt: ' ',
    },
  ];

  for (const { id, tag, src, alt } of fixtures) {
    describe(id, () => {
      const original = (over: Partial<SlotRow> = {}) =>
        slot({ id, original_src: src, alt, ...over });

      it('is byte-identical when r2_key is NULL and alt is unchanged', () => {
        expect(renderSlotTag(tag, original({ r2_key: null }), BASE)).toBe(tag);
      });

      it('changes only the src value when r2_key is set, keeping <IMG and SRC= case', () => {
        const out = renderSlotTag(tag, original({ r2_key: 'new/pic.webp' }), BASE);
        expect(out).toContain(`SRC="${BASE}/new/pic.webp"`);
        expect(out.startsWith('<IMG')).toBe(true);
        expect(out).not.toBe(tag);
      });
    });
  }

  it('inserts alt into an uppercase tag with none, preserving <IMG', () => {
    const noAlt = '<IMG data-vhs-slot="x.img.3" SRC="resources/c.jpg">';
    const out = renderSlotTag(noAlt, slot({ id: 'x.img.3', original_src: 'resources/c.jpg', alt: 'New' }), BASE);
    expect(out.startsWith('<IMG alt="New"')).toBe(true);
    expect(out).not.toContain('<img');
  });
});

describe('renderPage', () => {
  const page = [
    '<body>',
    '  <!--vhs:begin t.img.1--><img data-vhs-slot="t.img.1" alt="One" src="old1.jpg"><!--vhs:end t.img.1-->',
    '  <img src="../../resources/new.gif">',
    '  <!--vhs:begin t.img.2--><img data-vhs-slot="t.img.2" alt="Two" src="old2.jpg"><!--vhs:end t.img.2-->',
    '</body>',
  ].join('\n');

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM slots').run();
    await env.DB.prepare('DELETE FROM assets').run();
    await env.DB.prepare(
      `INSERT INTO slots (id, page_path, label, optional, r2_key, original_src, alt)
       VALUES ('t.img.1','t.html','one',0,NULL,'old1.jpg','One'),
              ('t.img.2','t.html','two',0,NULL,'old2.jpg','Two')`,
    ).run();
  });

  it('is a no-op when nothing has been edited', async () => {
    expect(await renderPage(env.DB, 't.html', page, BASE)).toBe(page);
  });

  it('swaps only the edited slot and preserves every other byte', async () => {
    await env.DB.prepare(
      `INSERT INTO assets (r2_key, mime, sha256, origin) VALUES ('new/2.webp', 'image/webp', 'deadbeef', 'upload')`,
    ).run();
    await env.DB.prepare(`UPDATE slots SET r2_key='new/2.webp' WHERE id='t.img.2'`).run();
    const out = await renderPage(env.DB, 't.html', page, BASE);
    expect(out).toContain('src="old1.jpg"');
    expect(out).toContain(`src="${BASE}/new/2.webp"`);
    expect(out).toContain('<img src="../../resources/new.gif">');
    expect(out.split('\n')).toHaveLength(page.split('\n').length);
  });

  it('throws when a slot in the database has no sentinel on the page', async () => {
    await env.DB.prepare(
      `INSERT INTO slots (id, page_path, label, optional, r2_key, original_src, alt)
       VALUES ('t.img.9','t.html','nine',0,NULL,'x.jpg','')`,
    ).run();
    await expect(renderPage(env.DB, 't.html', page, BASE)).rejects.toThrow();
  });

  it('returns the page unchanged when it has no slots at all', async () => {
    const plain = '<p>no slots here</p>';
    expect(await renderPage(env.DB, 'other.html', plain, BASE)).toBe(plain);
  });

  it('is idempotent across repeated renders', async () => {
    await env.DB.prepare(
      `INSERT INTO assets (r2_key, mime, sha256, origin) VALUES ('new/1.webp', 'image/webp', 'deadbeef', 'upload')`,
    ).run();
    await env.DB.prepare(`UPDATE slots SET r2_key='new/1.webp' WHERE id='t.img.1'`).run();
    const once = await renderPage(env.DB, 't.html', page, BASE);
    expect(await renderPage(env.DB, 't.html', once, BASE)).toBe(once);
  });
});

// Real production tags, copied byte-for-byte from the live pages, cover every
// hazard shape on the site: extra attrs, missing alt, class before src,
// unquoted attribute values, and both `/>` and ` />` self-closing styles.
describe('renderSlotTag against real production tags', () => {
  const fixtures: Array<{ id: string; tag: string; src: string; alt: string }> = [
    {
      id: 'index.img.1',
      tag: '<img data-vhs-slot="index.img.1" src="resources/noncurricular/classMonitor/cm_30.jpg" width="50%" class="img-rounded img-borderd" style="border: 2px solid Black; margin-left: 1em;"/>',
      src: 'resources/noncurricular/classMonitor/cm_30.jpg',
      alt: '',
    },
    {
      id: 'index.img.6',
      tag: '<img data-vhs-slot="index.img.6" class="img-responsive" src="resources/management/1.jpeg" alt=" " />',
      src: 'resources/management/1.jpeg',
      alt: ' ',
    },
    {
      id: 'fih.img.2',
      tag: '<img data-vhs-slot="fih.img.2" src="../../resources/FIH/fih2.jpg" width="60%" height="60%" class="img-rounded img-borderd" style="border: 2px solid Black;"/>',
      src: '../../resources/FIH/fih2.jpg',
      alt: '',
    },
    {
      id: 'ourfounder.img.1',
      tag: '<img data-vhs-slot="ourfounder.img.1" src="../../resources/management/founder.jpg" width=35% class="pull-left img-rounded img-borderd" style="margin-left: 34%; border: 2px solid Black; margin-bottom: 1%;"/>',
      src: '../../resources/management/founder.jpg',
      alt: '',
    },
    {
      id: 'principalmessage.img.1',
      tag: '<img data-vhs-slot="principalmessage.img.1" src="../../resources/management/1.jpeg" height="200px" class="pull-left img-rounded img-borderd" style="margin:0px 50px 10px 0px; border: 2px solid Black;"/>',
      src: '../../resources/management/1.jpeg',
      alt: '',
    },
  ];

  for (const { id, tag, src, alt } of fixtures) {
    describe(id, () => {
      const original = (over: Partial<SlotRow> = {}) =>
        slot({ id, original_src: src, alt, ...over });

      it('is byte-identical when r2_key is NULL and alt is unchanged', () => {
        expect(renderSlotTag(tag, original({ r2_key: null }), BASE)).toBe(tag);
      });

      it('changes only the src value when r2_key is set', () => {
        const out = renderSlotTag(tag, original({ r2_key: 'new/pic.webp' }), BASE);
        expect(out).toContain(`src="${BASE}/new/pic.webp"`);
        expect(out).not.toBe(tag);
        // Every byte outside the src value is untouched.
        const withoutSrc = (s: string) => s.replace(/\bsrc\s*=\s*(["']).*?\1/, 'src=HOLE');
        expect(withoutSrc(out)).toBe(withoutSrc(tag));
      });

      it('is idempotent', () => {
        const once = renderSlotTag(tag, original({ r2_key: 'new/pic.webp' }), BASE);
        expect(renderSlotTag(once, original({ r2_key: 'new/pic.webp' }), BASE)).toBe(once);
      });

      it('updates alt in place without injecting alt="" into a tag that never had one', () => {
        const changed = renderSlotTag(tag, original({ alt: 'Changed' }), BASE);
        if (tag.includes('alt=')) {
          expect(changed).toContain('alt="Changed"');
        } else {
          expect(changed).not.toContain('alt=""');
          expect(changed).toContain('alt="Changed"');
        }
        const unchanged = renderSlotTag(tag, original(), BASE);
        expect(unchanged).toBe(tag);
      });
    });
  }
});
