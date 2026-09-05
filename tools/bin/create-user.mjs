#!/usr/bin/env node
// Usage: node tools/bin/create-user.mjs <username> <password> <role> [display name]
// Prints the INSERT statement to provision a new user. Account creation is
// intentionally backend-only in Phase 1 — this replaces the removed
// POST /v1/users route.
import { webcrypto as crypto } from 'node:crypto';

const [username, password, role, displayName] = process.argv.slice(2);
if (!username || !password || !role) {
  console.error('usage: create-user.mjs <username> <password> <role> [display name]');
  process.exit(1);
}
if (password.length < 10) {
  console.error('password must be at least 10 characters');
  process.exit(1);
}
if (role !== 'owner' && role !== 'editor') {
  console.error('role must be owner or editor');
  process.exit(1);
}

const ITERATIONS = 100_000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey(
  'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256,
);
const b64 = (b) => Buffer.from(b).toString('base64');
const displayNameSql = displayName ? `'${displayName.replace(/'/g, "''")}'` : 'NULL';

console.log(
  `INSERT INTO users (username, password_hash, salt, iterations, role, display_name) VALUES ` +
  `('${username.replace(/'/g, "''")}', '${b64(new Uint8Array(bits))}', ` +
  `'${b64(salt)}', ${ITERATIONS}, '${role}', ${displayNameSql});`,
);
