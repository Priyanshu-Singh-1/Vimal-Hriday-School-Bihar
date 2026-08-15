import { describe, it, expect, vi } from 'vitest';
import { createGitHubClient, GitHubError } from '../src/github/client';

const env = {
  GITHUB_TOKEN: 'test-token',
  GITHUB_REPO: 'owner/repo',
  GITHUB_BRANCH: 'main',
} as any;

function mockFetch(handlers: Record<string, (init?: RequestInit) => Response>) {
  return vi.fn(async (input: any, init?: RequestInit) => {
    const url = String(input);
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url.includes(pattern)) return handler(init);
    }
    return new Response('unmatched: ' + url, { status: 599 });
  }) as unknown as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('readFile', () => {
  it('requests the raw file on the configured branch', async () => {
    const f = mockFetch({ '/contents/': () => new Response('<html>hi</html>', { status: 200 }) });
    const gh = createGitHubClient(env, f);
    expect(await gh.readFile('index.html')).toBe('<html>hi</html>');

    const [url, init] = (f as any).mock.calls[0];
    expect(String(url)).toBe('https://api.github.com/repos/owner/repo/contents/index.html?ref=main');
    expect((init.headers as any).Authorization).toBe('Bearer test-token');
    expect((init.headers as any).Accept).toBe('application/vnd.github.raw');
  });

  it('encodes a path containing an ampersand', async () => {
    const f = mockFetch({ '/contents/': () => new Response('x', { status: 200 }) });
    await createGitHubClient(env, f).readFile('pages/about/aim&objective.html');
    expect(String((f as any).mock.calls[0][0])).toContain('aim%26objective.html');
  });

  it('throws GitHubError with the status on failure', async () => {
    const f = mockFetch({ '/contents/': () => new Response('nope', { status: 404 }) });
    await expect(createGitHubClient(env, f).readFile('missing.html')).rejects.toMatchObject({
      name: 'GitHubError', status: 404,
    });
  });
});

describe('commitFiles', () => {
  const happy = () => ({
    '/git/ref/heads/main': () => json({ object: { sha: 'HEADSHA' } }),
    '/git/commits/HEADSHA': () => json({ tree: { sha: 'BASETREE' } }),
    '/git/blobs': () => json({ sha: 'BLOBSHA' }, 201),
    '/git/trees': () => json({ sha: 'NEWTREE' }, 201),
    '/git/commits': () => json({ sha: 'NEWCOMMIT' }, 201),
    '/git/refs/heads/main': () => json({ object: { sha: 'NEWCOMMIT' } }),
  });

  it('creates one commit for several files and returns its sha', async () => {
    const f = mockFetch(happy());
    const sha = await createGitHubClient(env, f).commitFiles(
      [{ path: 'a.html', content: '<a>' }, { path: 'b.html', content: '<b>' }],
      'chore: publish',
    );
    expect(sha).toBe('NEWCOMMIT');

    const bodies = (f as any).mock.calls
      .filter((c: any[]) => String(c[0]).includes('/git/commits') && c[1]?.method === 'POST')
      .map((c: any[]) => JSON.parse(c[1].body));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ message: 'chore: publish', tree: 'NEWTREE', parents: ['HEADSHA'] });
  });

  it('base64-encodes blob content and preserves non-ASCII', async () => {
    const f = mockFetch(happy());
    await createGitHubClient(env, f).commitFiles([{ path: 'a.html', content: 'Vimal — Hridäy' }], 'm');
    const blobCall = (f as any).mock.calls.find((c: any[]) => String(c[0]).includes('/git/blobs'));
    const body = JSON.parse(blobCall[1].body);
    expect(body.encoding).toBe('base64');
    expect(new TextDecoder().decode(Uint8Array.from(atob(body.content), (ch) => ch.charCodeAt(0))))
      .toBe('Vimal — Hridäy');
  });

  it('sends one tree entry per file with blob mode 100644', async () => {
    const f = mockFetch(happy());
    await createGitHubClient(env, f).commitFiles(
      [{ path: 'a.html', content: 'x' }, { path: 'b.html', content: 'y' }], 'm',
    );
    const treeCall = (f as any).mock.calls.find((c: any[]) => String(c[0]).includes('/git/trees'));
    const body = JSON.parse(treeCall[1].body);
    expect(body.base_tree).toBe('BASETREE');
    expect(body.tree).toHaveLength(2);
    expect(body.tree[0]).toMatchObject({ path: 'a.html', mode: '100644', type: 'blob', sha: 'BLOBSHA' });
  });

  it('advances the branch ref to the new commit', async () => {
    const f = mockFetch(happy());
    await createGitHubClient(env, f).commitFiles([{ path: 'a.html', content: 'x' }], 'm');
    const patch = (f as any).mock.calls.find(
      (c: any[]) => String(c[0]).includes('/git/refs/heads/main') && c[1]?.method === 'PATCH',
    );
    expect(JSON.parse(patch[1].body)).toEqual({ sha: 'NEWCOMMIT', force: false });
  });

  it('returns early without calling GitHub when given no files', async () => {
    const f = mockFetch(happy());
    expect(await createGitHubClient(env, f).commitFiles([], 'm')).toBeNull();
    expect((f as any).mock.calls).toHaveLength(0);
  });

  it('surfaces a failure at the ref update step', async () => {
    const f = mockFetch({ ...happy(), '/git/refs/heads/main': () => new Response('conflict', { status: 422 }) });
    await expect(
      createGitHubClient(env, f).commitFiles([{ path: 'a.html', content: 'x' }], 'm'),
    ).rejects.toBeInstanceOf(GitHubError);
  });
});
