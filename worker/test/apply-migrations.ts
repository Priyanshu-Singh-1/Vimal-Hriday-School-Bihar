// Applies the D1 migrations to the pool's per-run database once, before any test
// file runs. `env` and `exports` come from 'cloudflare:workers' in
// @cloudflare/vitest-pool-workers 0.21, but applyD1Migrations is still exported
// from 'cloudflare:test'.
import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
