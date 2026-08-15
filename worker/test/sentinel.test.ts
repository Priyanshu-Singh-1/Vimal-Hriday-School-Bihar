import { describe, it, expect } from 'vitest';
import { replaceSentinel, assertSentinelsBalanced, SentinelError } from '../src/render/sentinel';

const page = [
  '<div class="x">',
  '  <!--vhs:begin a.b-->',
  '  <img src="old.jpg">',
  '  <!--vhs:end a.b-->',
  '</div>',
].join('\n');

describe('replaceSentinel', () => {
  it('replaces only the bytes between the sentinels', () => {
    const out = replaceSentinel(page, 'a.b', '\n  <img src="new.webp">\n  ');
    expect(out).toBe([
      '<div class="x">',
      '  <!--vhs:begin a.b-->',
      '  <img src="new.webp">',
      '  <!--vhs:end a.b-->',
      '</div>',
    ].join('\n'));
  });

  it('leaves every byte outside the sentinel pair untouched', () => {
    const out = replaceSentinel(page, 'a.b', 'ANYTHING');
    const beginAt = page.indexOf('<!--vhs:begin a.b-->') + '<!--vhs:begin a.b-->'.length;
    expect(out.slice(0, beginAt)).toBe(page.slice(0, beginAt));
    expect(out.slice(out.indexOf('<!--vhs:end a.b-->'))).toBe(page.slice(page.indexOf('<!--vhs:end a.b-->')));
  });

  it('is idempotent when the same content is written twice', () => {
    const once = replaceSentinel(page, 'a.b', 'X');
    expect(replaceSentinel(once, 'a.b', 'X')).toBe(once);
  });

  it('handles replacement content that mentions the id', () => {
    const out = replaceSentinel(page, 'a.b', '<img data-vhs-slot="a.b" src="n.webp">');
    expect(out).toContain('data-vhs-slot="a.b"');
    expect(out.match(/vhs:begin a\.b/g)).toHaveLength(1);
    expect(out.match(/vhs:end a\.b/g)).toHaveLength(1);
  });

  it('does not confuse an id that prefixes another', () => {
    const two = '<!--vhs:begin a-->1<!--vhs:end a--><!--vhs:begin a.b-->2<!--vhs:end a.b-->';
    expect(replaceSentinel(two, 'a', 'X')).toBe(
      '<!--vhs:begin a-->X<!--vhs:end a--><!--vhs:begin a.b-->2<!--vhs:end a.b-->',
    );
  });

  it('throws when the begin sentinel is missing', () => {
    expect(() => replaceSentinel('<p>nothing</p>', 'a.b', 'X')).toThrow(SentinelError);
  });

  it('throws when the end sentinel is missing', () => {
    expect(() => replaceSentinel('<!--vhs:begin a.b-->orphan', 'a.b', 'X')).toThrow(SentinelError);
  });

  it('throws when the sentinels are reversed', () => {
    expect(() => replaceSentinel('<!--vhs:end a.b--><!--vhs:begin a.b-->', 'a.b', 'X')).toThrow(SentinelError);
  });

  it('throws on a duplicate begin sentinel', () => {
    const dup = '<!--vhs:begin a.b-->1<!--vhs:end a.b--><!--vhs:begin a.b-->2<!--vhs:end a.b-->';
    expect(() => replaceSentinel(dup, 'a.b', 'X')).toThrow(SentinelError);
  });
});

describe('assertSentinelsBalanced', () => {
  it('passes for a well-formed page', () => {
    expect(() => assertSentinelsBalanced(page, ['a.b'])).not.toThrow();
  });

  it('throws when an expected id is absent', () => {
    expect(() => assertSentinelsBalanced(page, ['a.b', 'missing.one'])).toThrow(SentinelError);
  });

  it('throws when the page holds an unexpected sentinel', () => {
    const extra = page + '\n<!--vhs:begin ghost--><!--vhs:end ghost-->';
    expect(() => assertSentinelsBalanced(extra, ['a.b'])).toThrow(SentinelError);
  });
});
