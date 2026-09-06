/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { D1Migration } from 'cloudflare:test';
import type { Env as AppEnv } from '../src/env';

// `env` from 'cloudflare:workers' is typed as the open `Cloudflare.Env` interface.
// Augment it with this Worker's bindings plus the test-only TEST_MIGRATIONS binding
// so test files get real types for env.DB and friends.
declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      TEST_MIGRATIONS: D1Migration[];
    }

    // `Cloudflare.Exports` — the type of `exports` from 'cloudflare:workers' — is
    // derived from GlobalProps["mainModule"]. Declaring it here is what gives
    // tests a typed `exports.default.fetch(...)`.
    interface GlobalProps {
      mainModule: typeof import('../src/index');
    }
  }
}
