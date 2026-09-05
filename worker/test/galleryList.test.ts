import { describe, expect, it } from 'vitest';
import { renderGalleryList, type GalleryTile } from '../src/render/galleryList';

// Indentation measured from the live pages/events/celebration.html.
const CATEGORY = { indent: ' '.repeat(36), closeIndent: ' '.repeat(24) };

describe('renderGalleryList', () => {
  it('reproduces a live category tile byte for byte', () => {
    const out = renderGalleryList(
      [
        {
          href: 'prizeDistribution24.html',
          src: '../../resources/Gallery/prizeDistribution25/pd%20(15).jpg',
          title: 'PRIZE DISTRIBUTION (2024)',
        },
      ],
      CATEGORY,
    );

    // Verbatim from celebration.html lines 282-285.
    expect(out).toBe(
      '\n' +
        "                                    <li>\n" +
        "                                        <a href='prizeDistribution24.html' target=\"_blank\"><img src='../../resources/Gallery/prizeDistribution25/pd%20(15).jpg' class=\"img-thumbnail\" /></a><br />\n" +
        "                                        <p><a href='prizeDistribution24.html' target=\"_blank\">PRIZE DISTRIBUTION (2024)</a></p>\n" +
        "                                    </li>\n" +
        '                        ',
    );
  });

  it('omits target="_blank" for the tiles that never had it', () => {
    const out = renderGalleryList(
      [
        {
          href: '../about/investitureceremony.html',
          src: '../../resources/noncurricular/investiture/investiture2025/inv_27.jpg',
          title: 'INVESTITURE CEREMONY (2025)',
          newTab: false,
        },
      ],
      CATEGORY,
    );

    // Verbatim from celebration.html lines 261-264.
    expect(out).toContain(
      "                                        <a href='../about/investitureceremony.html'><img src='../../resources/noncurricular/investiture/investiture2025/inv_27.jpg' class=\"img-thumbnail\" /></a><br />",
    );
    expect(out).not.toContain('target="_blank"');
  });

  it('emits a hidden tile as a commented-out li, matching the live convention', () => {
    const out = renderGalleryList(
      [
        {
          href: 'independencecelebration24.html',
          src: '../../resources/Gallery/independenceDay24/in%20(103).jpg',
          title: 'INDEPENDENCE DAY (2024)',
          visible: false,
        },
      ],
      CATEGORY,
    );

    // Verbatim from celebration.html lines 266-269.
    expect(out).toContain('<!--                                    <li>-->');
    expect(out).toContain(
      "<!--                                        <a href='independencecelebration24.html' target=\"_blank\"><img src='../../resources/Gallery/independenceDay24/in%20(103).jpg' class=\"img-thumbnail\" /></a><br />-->",
    );
    expect(out).toContain(
      "<!--                                        <p><a href='independencecelebration24.html' target=\"_blank\">INDEPENDENCE DAY (2024)</a></p>-->",
    );
    expect(out).toContain('<!--                                    </li>-->');
  });

  it('separates tiles with a blank line and keeps the given order', () => {
    const tiles: GalleryTile[] = [
      { href: 'a.html', src: 'a.jpg', title: 'A' },
      { href: 'b.html', src: 'b.jpg', title: 'B' },
    ];
    const out = renderGalleryList(tiles, { indent: '  ', closeIndent: '' });
    expect(out).toBe(
      '\n' +
        "  <li>\n      <a href='a.html' target=\"_blank\"><img src='a.jpg' class=\"img-thumbnail\" /></a><br />\n      <p><a href='a.html' target=\"_blank\">A</a></p>\n  </li>\n" +
        '\n' +
        "  <li>\n      <a href='b.html' target=\"_blank\"><img src='b.jpg' class=\"img-thumbnail\" /></a><br />\n      <p><a href='b.html' target=\"_blank\">B</a></p>\n  </li>\n",
    );
    expect(out.indexOf('a.html')).toBeLessThan(out.indexOf('b.html'));
  });

  it('omits the caption for a photo list', () => {
    const out = renderGalleryList([{ href: 'p.jpg', src: 'p.jpg' }], { indent: '', closeIndent: '' });
    expect(out).not.toContain('<p>');
    expect(out).toContain("<a href='p.jpg' target=\"_blank\"><img src='p.jpg' class=\"img-thumbnail\" /></a><br />");
  });

  it('treats an empty title the same as none', () => {
    const out = renderGalleryList([{ href: 'p.jpg', src: 'p.jpg', title: '' }], { indent: '', closeIndent: '' });
    expect(out).not.toContain('<p>');
  });

  it('yields a well-formed empty region for no tiles', () => {
    expect(renderGalleryList([], CATEGORY)).toBe('\n' + ' '.repeat(24));
  });

  it('escapes a title so it cannot inject markup', () => {
    const out = renderGalleryList(
      [{ href: 'e.html', src: 'e.jpg', title: 'Sports <script>alert(1)</script> & "fun"' }],
      { indent: '', closeIndent: '' },
    );
    expect(out).toContain('Sports &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;fun&quot;');
    expect(out).not.toContain('<script>');
  });

  it('escapes a title so a hidden tile cannot break out of its comment', () => {
    // The dangerous input: `-->` would end the comment early and spill the
    // rest of the tile onto the live page as real markup.
    const out = renderGalleryList(
      [{ href: 'e.html', src: 'e.jpg', title: 'Break --> out', visible: false }],
      { indent: '', closeIndent: '' },
    );
    expect(out).not.toContain('--> out');
    expect(out).toContain('Break --&gt; out');
    // Every emitted line is still a self-contained comment.
    for (const line of out.trim().split('\n')) {
      expect(line.startsWith('<!--')).toBe(true);
      expect(line.endsWith('-->')).toBe(true);
    }
  });

  it("escapes a single quote in a url so it cannot close the attribute", () => {
    const out = renderGalleryList([{ href: "x'.html", src: "y'.jpg" }], { indent: '', closeIndent: '' });
    expect(out).toContain("href='x&#39;.html'");
    expect(out).toContain("src='y&#39;.jpg'");
  });
});
