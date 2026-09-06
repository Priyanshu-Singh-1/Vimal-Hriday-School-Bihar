import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Migrations are read here, in Node, before the Workers pool starts. The pool's D1
// is fresh and empty for every run and is not the database that
// `wrangler d1 migrations apply --local` writes to, so test/apply-migrations.ts
// applies them from the TEST_MIGRATIONS binding instead.
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            JWT_SECRET: 'test-secret-at-least-32-bytes-long',
            GITHUB_TOKEN: 'test-token',
            R2_PUBLIC_BASE: 'https://img.test',
            ALLOWED_ORIGINS: 'https://vhspurnea.com',
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
