import { env, exports } from 'cloudflare:workers';
import { describe, it, expect } from 'vitest';

describe('health', () => {
  it('reports ok and reaches D1', async () => {
    const res = await exports.default.fetch('https://api.test/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sections: 3 });
  });

  it('404s an unknown route', async () => {
    const res = await exports.default.fetch('https://api.test/v1/nope');
    expect(res.status).toBe(404);
  });

  it('echoes an allowed origin and refuses an unknown one', async () => {
    const ok = await exports.default.fetch('https://api.test/v1/health', {
      headers: { Origin: 'https://vhspurnea.com' },
    });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://vhspurnea.com');

    const bad = await exports.default.fetch('https://api.test/v1/health', {
      headers: { Origin: 'https://evil.example' },
    });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });
});
