import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stripComments, safeDecode, extractImageTags, resolveRef,
  isChrome, slotIdFor, labelFor,
} from '../src/parse.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(join(here, 'fixtures', n), 'utf8');

describe('stripComments', () => {
  it('preserves total length so offsets stay valid', () => {
    const html = '<a><!-- hidden --><b>';
    const out = stripComments(html);
    expect(out).toHaveLength(html.length);
    expect(out.indexOf('<b>')).toBe(html.indexOf('<b>'));
  });

  it('removes multi-line comments', () => {
    expect(stripComments('x<!--\nline\n-->y')).not.toContain('line');
  });

  it('leaves non-comment content alone', () => {
    expect(stripComments('<p>keep</p>')).toBe('<p>keep</p>');
  });
});

describe('safeDecode', () => {
  it('decodes percent-encoded spaces and parentheses', () => {
    expect(safeDecode('School%20(6).jpeg')).toBe('School (6).jpeg');
  });

  it('returns the input unchanged for a malformed escape', () => {
    expect(safeDecode('bad%ZZ.jpg')).toBe('bad%ZZ.jpg');
  });

  it('is a no-op for a plain name', () => {
    expect(safeDecode('plain.jpg')).toBe('plain.jpg');
  });
});

describe('extractImageTags', () => {
  it('finds zero tags when every reference is commented out', () => {
    expect(extractImageTags(fixture('comments-only.html'))).toHaveLength(0);
  });

  it('finds live tags across both quote styles', () => {
    const tags = extractImageTags(fixture('hazards.html'));
    expect(tags).toHaveLength(5);
    expect(tags[0].src).toBe('../../resources/homeslider/School%20(6).jpeg');
    expect(tags[1].src).toBe('../../resources/CulturalEvents/sportsDay/fd%20(25).JPG');
    expect(tags[0].alt).toBe('School');
    expect(tags[1].alt).toBe('Sports');
  });

  it('reports an empty alt when the attribute is absent', () => {
    const tags = extractImageTags(fixture('hazards.html'));
    expect(tags[3].alt).toBe('');
  });

  it('reports offsets into the original string, not the stripped one', () => {
    const html = '<!-- <img src="a.jpg"> -->\n<img src="b.jpg">';
    const tags = extractImageTags(html);
    expect(tags).toHaveLength(1);
    expect(html.slice(tags[0].index, tags[0].index + tags[0].tag.length)).toBe('<img src="b.jpg">');
  });
});

describe('resolveRef', () => {
  it('resolves a two-level relative path', () => {
    expect(resolveRef('pages/about/FIH.html', '../../resources/FIH/fih1.jpg'))
      .toBe('resources/FIH/fih1.jpg');
  });

  it('resolves a dot-slash path from the repo root', () => {
    expect(resolveRef('index.html', './resources/yt.png')).toBe('resources/yt.png');
  });

  it('resolves a bare path from the repo root', () => {
    expect(resolveRef('index.html', 'resources/yt.png')).toBe('resources/yt.png');
  });

  it('decodes percent-escapes in the resolved path', () => {
    expect(resolveRef('pages/about/default2.html', '../../resources/homeslider/School%20(6).jpeg'))
      .toBe('resources/homeslider/School (6).jpeg');
  });

  it('returns null for remote and protocol-relative URLs', () => {
    expect(resolveRef('index.html', 'https://example.com/a.jpg')).toBeNull();
    expect(resolveRef('index.html', '//cdn.example.com/a.jpg')).toBeNull();
  });

  it('never escapes above the repo root', () => {
    expect(resolveRef('index.html', '../../../etc/passwd.png')).toBeNull();
  });
});

describe('isChrome', () => {
  it('recognises every chrome asset by exact path', () => {
    for (const p of [
      'resources/new.gif', 'resources/firework.gif', 'resources/yt.png',
      'resources/images/logo.png', 'resources/images/start.gif', 'resources/images/pdf.gif',
    ]) expect(isChrome(p)).toBe(true);
  });

  it('does not treat a content image as chrome', () => {
    expect(isChrome('resources/management/1.jpeg')).toBe(false);
  });

  it('is not fooled by a same-named file elsewhere', () => {
    expect(isChrome('resources/somewhere/logo.png')).toBe(false);
  });
});

describe('slotIdFor and labelFor', () => {
  it('derives a stable mechanical id', () => {
    expect(slotIdFor('pages/about/OurManagement.html', 3)).toBe('ourmanagement.img.3');
    expect(slotIdFor('index.html', 1)).toBe('index.img.1');
  });

  it('strips characters that are not id-safe', () => {
    expect(slotIdFor('pages/about/aim&objective.html', 1)).toBe('aim-objective.img.1');
  });

  it('produces a human label', () => {
    expect(labelFor('pages/about/OurManagement.html', 3)).toBe('OurManagement — image 3');
  });
});
