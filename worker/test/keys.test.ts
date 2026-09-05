import { describe, it, expect } from 'vitest';
import { slugify, buildKey, sha256Hex } from '../src/lib/keys';

describe('slugify', () => {
  it('lowercases and replaces runs of unsafe characters with one dash', () => {
    expect(slugify('School (6).jpeg')).toBe('school-6');
  });
  it('strips the extension', () => {
    expect(slugify('fd (25).JPG')).toBe('fd-25');
  });
  it('trims leading and trailing dashes', () => {
    expect(slugify('  (weird)  .png')).toBe('weird');
  });
  it('handles a name that is entirely unsafe', () => {
    expect(slugify('***.jpg')).toBe('img');
  });
  it('caps length at 60 characters', () => {
    expect(slugify('a'.repeat(200) + '.jpg')).toHaveLength(60);
  });
  it('never emits a space, parenthesis, or percent', () => {
    expect(slugify('a b(c)%20d.jpg')).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('buildKey', () => {
  it('composes a content-addressed key', () => {
    expect(buildKey('School (6).jpeg', 'abcdef1234567890', 'webp'))
      .toBe('up/ab/school-6.abcdef12.webp');
  });
  it('produces the same key for identical content and name', () => {
    expect(buildKey('a.jpg', 'ffee0011', 'webp')).toBe(buildKey('a.jpg', 'ffee0011', 'webp'));
  });
  it('contains no character needing URL encoding', () => {
    expect(buildKey('a b (c).JPG', '0123456789', 'webp')).toMatch(/^[a-z0-9./-]+$/);
  });
});

describe('sha256Hex', () => {
  it('hashes an empty buffer to the known digest', async () => {
    expect(await sha256Hex(new ArrayBuffer(0)))
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('differs for different content', async () => {
    const a = await sha256Hex(new TextEncoder().encode('a').buffer as ArrayBuffer);
    const b = await sha256Hex(new TextEncoder().encode('b').buffer as ArrayBuffer);
    expect(a).not.toBe(b);
  });
});
