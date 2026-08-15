export class SentinelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SentinelError';
  }
}

const begin = (id: string) => `<!--vhs:begin ${id}-->`;
const end = (id: string) => `<!--vhs:end ${id}-->`;

/**
 * Replace the bytes between the sentinel pair for `id`. Every byte outside the
 * pair is preserved exactly. Never parses HTML.
 */
export function replaceSentinel(html: string, id: string, inner: string): string {
  const b = begin(id);
  const e = end(id);

  const bStart = html.indexOf(b);
  if (bStart === -1) throw new SentinelError(`missing begin sentinel for "${id}"`);
  if (html.indexOf(b, bStart + b.length) !== -1) {
    throw new SentinelError(`duplicate begin sentinel for "${id}"`);
  }

  const bEnd = bStart + b.length;
  const eStart = html.indexOf(e, bEnd);
  if (eStart === -1) throw new SentinelError(`missing end sentinel for "${id}" after its begin`);
  if (html.indexOf(e, eStart + e.length) !== -1) {
    throw new SentinelError(`duplicate end sentinel for "${id}"`);
  }

  return html.slice(0, bEnd) + inner + html.slice(eStart);
}

/**
 * Return the exact bytes between the sentinel pair for `id`, unparsed.
 */
export function readSentinel(html: string, id: string): string {
  const b = begin(id);
  const e = end(id);

  const bStart = html.indexOf(b);
  if (bStart === -1) throw new SentinelError(`missing begin sentinel for "${id}"`);
  if (html.indexOf(b, bStart + b.length) !== -1) {
    throw new SentinelError(`duplicate begin sentinel for "${id}"`);
  }

  const bEnd = bStart + b.length;
  const eStart = html.indexOf(e, bEnd);
  if (eStart === -1) throw new SentinelError(`missing end sentinel for "${id}" after its begin`);
  if (html.indexOf(e, eStart + e.length) !== -1) {
    throw new SentinelError(`duplicate end sentinel for "${id}"`);
  }

  return html.slice(bEnd, eStart);
}

const ANY_BEGIN = /<!--vhs:begin ([^>]+?)-->/g;
const ANY_END = /<!--vhs:end ([^>]+?)-->/g;

/**
 * Verify the page contains exactly the expected sentinel ids, each once, with
 * every begin followed by its end. Called before any commit.
 */
export function assertSentinelsBalanced(html: string, ids: string[]): void {
  const found = (re: RegExp) => {
    re.lastIndex = 0;
    const seen: string[] = [];
    for (const m of html.matchAll(re)) seen.push(m[1]!);
    return seen;
  };

  const begins = found(ANY_BEGIN);
  const ends = found(ANY_END);

  const dup = (list: string[]) => list.filter((v, i) => list.indexOf(v) !== i);
  if (dup(begins).length) throw new SentinelError(`duplicate begin sentinels: ${dup(begins).join(', ')}`);
  if (dup(ends).length) throw new SentinelError(`duplicate end sentinels: ${dup(ends).join(', ')}`);

  const expected = [...ids].sort();
  if ([...begins].sort().join('|') !== expected.join('|')) {
    throw new SentinelError(
      `begin sentinels ${JSON.stringify([...begins].sort())} do not match expected ${JSON.stringify(expected)}`,
    );
  }
  if ([...ends].sort().join('|') !== expected.join('|')) {
    throw new SentinelError(
      `end sentinels ${JSON.stringify([...ends].sort())} do not match expected ${JSON.stringify(expected)}`,
    );
  }

  for (const id of ids) {
    const bStart = html.indexOf(begin(id));
    const eStart = html.indexOf(end(id));
    if (eStart < bStart) throw new SentinelError(`sentinels for "${id}" are reversed`);
  }
}
