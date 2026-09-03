import { describe, expect, it } from 'vitest';
import { renderGalleryList, type GalleryTile } from '../src/render/galleryList';

/**
 * The real imgCatList body from pages/events/celebration.html, verbatim.
 *
 * Phase 1 taught that mocked markup hides the bugs that matter: `slotMarkup`
 * passed its own tests and would still have stripped width/class/style from
 * all 19 production images. So this region is the live bytes, not a fixture
 * written to suit the renderer.
 */
const LIVE_REGION = `

                                    <li>
                                        <a href='../about/investitureceremony.html'><img src='../../resources/noncurricular/investiture/investiture2025/inv_27.jpg' class="img-thumbnail" /></a><br />
                                        <p><a href='../about/investitureceremony.html'>INVESTITURE CEREMONY (2025)</a></p>
                                    </li>

<!--                                    <li>-->
<!--                                        <a href='independencecelebration24.html' target="_blank"><img src='../../resources/Gallery/independenceDay24/in%20(103).jpg' class="img-thumbnail" /></a><br />-->
<!--                                        <p><a href='independencecelebration24.html' target="_blank">INDEPENDENCE DAY (2024)</a></p>-->
<!--                                    </li>-->

                                    <!-- teachers day 2024 -->
<!--                                    <li>-->
<!--                                        <a href='teachersday2024.html' target="_blank"><img src='../../resources/Gallery/teachersDay2024/td%20(1).jpg' class="img-thumbnail" /></a><br />-->
<!--                                        <p><a href='teachersday2024.html' target="_blank">TEACHERS DAY (2024)</a></p>-->
<!--                                    </li>-->

                                     <li>
                                        <a href='christmas2024.html' target="_blank"><img src='../../resources/Gallery/christmasDay24/cd%20(3).jpeg' class="img-thumbnail" /></a><br />
                                        <p><a href='christmas2024.html' target="_blank">CHRISTMAS DAY (2024)</a></p>
                                    </li>

                                    <li>
                                        <a href='prizeDistribution24.html' target="_blank"><img src='../../resources/Gallery/prizeDistribution25/pd%20(15).jpg' class="img-thumbnail" /></a><br />
                                        <p><a href='prizeDistribution24.html' target="_blank">PRIZE DISTRIBUTION (2024)</a></p>
                                    </li>
                        `;

/** The five Celebrations tiles as the seeder reads them out of LIVE_REGION. */
const LIVE_TILES: GalleryTile[] = [
  {
    href: '../about/investitureceremony.html',
    src: '../../resources/noncurricular/investiture/investiture2025/inv_27.jpg',
    title: 'INVESTITURE CEREMONY (2025)',
    newTab: false,
  },
  {
    href: 'independencecelebration24.html',
    src: '../../resources/Gallery/independenceDay24/in%20(103).jpg',
    title: 'INDEPENDENCE DAY (2024)',
    visible: false,
  },
  {
    href: 'teachersday2024.html',
    src: '../../resources/Gallery/teachersDay2024/td%20(1).jpg',
    title: 'TEACHERS DAY (2024)',
    visible: false,
  },
  {
    href: 'christmas2024.html',
    src: '../../resources/Gallery/christmasDay24/cd%20(3).jpeg',
    title: 'CHRISTMAS DAY (2024)',
  },
  {
    href: 'prizeDistribution24.html',
    src: '../../resources/Gallery/prizeDistribution25/pd%20(15).jpg',
    title: 'PRIZE DISTRIBUTION (2024)',
  },
];

const FORMAT = { indent: ' '.repeat(36), closeIndent: ' '.repeat(24) };

/** Everything a browser ignores, so only meaningful drift can fail a test. */
const normalize = (html: string) =>
  html
    .replace(/<!--\s*teachers day 2024\s*-->/i, '') // stray authoring note, see below
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();

describe('the live Celebrations region', () => {
  it('round-trips: rendering the parsed tiles reproduces it', () => {
    expect(normalize(renderGalleryList(LIVE_TILES, FORMAT))).toBe(normalize(LIVE_REGION));
  });

  it('keeps all five tiles, three shown and two hidden', () => {
    const out = renderGalleryList(LIVE_TILES, FORMAT);
    const lis = out.match(/<li>/g) ?? [];
    expect(lis).toHaveLength(5);
    // A hidden tile is a commented li; the live page had exactly two.
    expect(out.match(/<!--\s+<li>-->/g) ?? []).toHaveLength(2);
  });

  it('preserves the one tile the site never opened in a new tab', () => {
    const out = renderGalleryList(LIVE_TILES, FORMAT);
    const investiture = out.split('\n\n')[0]!;
    expect(investiture).toContain('investitureceremony.html');
    expect(investiture).not.toContain('target="_blank"');
    // ...while the others keep theirs.
    expect(out).toContain("<a href='christmas2024.html' target=\"_blank\">");
  });

  it('changes only whitespace and the authoring note, never a link or image', () => {
    const urls = (html: string) => (html.match(/(?:href|src)='([^']*)'/g) ?? []).sort();
    expect(urls(renderGalleryList(LIVE_TILES, FORMAT))).toEqual(urls(LIVE_REGION));
  });
});
