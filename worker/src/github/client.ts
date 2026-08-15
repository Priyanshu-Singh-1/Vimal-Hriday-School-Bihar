import type { Env } from '../env';

export class GitHubError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

export type FileChange = { path: string; content: string };

/** UTF-8 safe base64, since btoa alone mangles multi-byte characters. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export function createGitHubClient(env: Env, fetchImpl: typeof fetch = fetch) {
  const base = `https://api.github.com/repos/${env.GITHUB_REPO}`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'vhs-admin-worker',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
    const res = await fetchImpl(url, {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new GitHubError(`${method} ${url} failed: ${await res.text()}`, res.status);
    return (await res.json()) as T;
  }

  return {
    async readFile(path: string): Promise<string> {
      const res = await fetchImpl(`${base}/contents/${encodePath(path)}?ref=${env.GITHUB_BRANCH}`, {
        headers: { ...headers, Accept: 'application/vnd.github.raw' },
      });
      if (!res.ok) throw new GitHubError(`read ${path} failed: ${await res.text()}`, res.status);
      return res.text();
    },

    /** Blobs, one tree, one commit, then advance the ref. Null when nothing to do. */
    async commitFiles(files: FileChange[], message: string): Promise<string | null> {
      if (!files.length) return null;

      const ref = await api<{ object: { sha: string } }>(
        `${base}/git/ref/heads/${env.GITHUB_BRANCH}`,
      );
      const headSha = ref.object.sha;
      const headCommit = await api<{ tree: { sha: string } }>(`${base}/git/commits/${headSha}`);

      const blobs = await Promise.all(
        files.map((f) =>
          api<{ sha: string }>(`${base}/git/blobs`, 'POST', {
            content: toBase64(f.content),
            encoding: 'base64',
          }),
        ),
      );

      const tree = await api<{ sha: string }>(`${base}/git/trees`, 'POST', {
        base_tree: headCommit.tree.sha,
        tree: files.map((f, i) => ({
          path: f.path,
          mode: '100644',
          type: 'blob',
          sha: blobs[i]!.sha,
        })),
      });

      const commit = await api<{ sha: string }>(`${base}/git/commits`, 'POST', {
        message,
        tree: tree.sha,
        parents: [headSha],
      });

      await api(`${base}/git/refs/heads/${env.GITHUB_BRANCH}`, 'PATCH', {
        sha: commit.sha,
        force: false,
      });

      return commit.sha;
    },
  };
}
