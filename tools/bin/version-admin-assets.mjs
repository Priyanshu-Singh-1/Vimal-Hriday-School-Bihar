#!/usr/bin/env node
/**
 * Stamps `?v=<n>` on every console asset reference.
 *
 * Why: the console is plain static files with no build step, so a browser will
 * happily keep serving a cached admin.js after a deploy. That already bit us --
 * a fixed layout looked broken because the old stylesheet was still cached, and
 * "press ctrl+shift+R" is not something school staff should ever need to know.
 *
 * Rerunnable: an existing ?v= is replaced, so bump the version and run again
 * after changing anything under admin/ or js/admin/.
 *
 *   node tools/bin/version-admin-assets.mjs 3
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const NAMES =
  'admin\\.css|admin\\.js|activity\\.js|event\\.js|gallery\\.js|pages\\.js|' +
  'password\\.js|people\\.js|published\\.js|editor\\.v1\\.js';

/**
 * Only an actual attribute value is stamped: `href="admin.css"`,
 * `src="admin.js"`, or the boot snippet's `s.src = '../../js/admin/editor.v1.js'`.
 *
 * An earlier version matched the bare file name anywhere, which rewrote the
 * word `admin.css` inside explanatory comments as `admin.css?v=2`. Prose is not
 * a url.
 */
const ATTR = new RegExp(
  '((?:href|src)\\s*=\\s*)(["\'])([^"\']*(?:' + NAMES + '))(?:\\?v=\\d+)?\\2',
  'g',
);

export function stamp(text, version) {
  return text.replace(ATTR, (_m, lead, quote, path) => `${lead}${quote}${path}?v=${version}${quote}`);
}

function main() {
  const version = process.argv[2];
  if (!/^\d+$/.test(version || '')) {
    console.error('usage: node tools/bin/version-admin-assets.mjs <integer version>');
    process.exit(2);
  }

  const targets = [];
  for (const f of readdirSync(join(REPO, 'admin'))) {
    if (f.endsWith('.html')) targets.push(join('admin', f));
  }
  // The boot snippet on each pilot page injects the editor script by url.
  for (const dir of ['pages/about', 'pages/events', 'pages/curriculum', '']) {
    const abs = join(REPO, dir);
    for (const f of readdirSync(abs)) {
      if (!f.endsWith('.html')) continue;
      const rel = join(dir, f);
      if (readFileSync(join(REPO, rel), 'utf8').includes('editor.v1.js')) targets.push(rel);
    }
  }

  let changed = 0;
  for (const rel of targets) {
    const abs = join(REPO, rel);
    const before = readFileSync(abs, 'utf8');
    const after = stamp(before, version);
    if (after !== before) {
      writeFileSync(abs, after);
      changed += 1;
      console.log(`  stamped v=${version}  ${rel}`);
    }
  }
  console.log(`\n  ${changed} file(s) updated`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
