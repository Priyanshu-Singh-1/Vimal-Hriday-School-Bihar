#!/usr/bin/env node
// Usage: node tools/bin/hash-password.mjs <username> <password>
// Prints the UPDATE statement to set that user's password.
import { webcrypto as crypto } from 'node:crypto';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('usage: hash-password.mjs <username> <password>');
  process.exit(1);
}
if (password.length < 10) {
  console.error('password must be at least 10 characters');
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

console.log(
  `UPDATE users SET password_hash='${b64(new Uint8Array(bits))}', ` +
  `salt='${b64(salt)}', iterations=${ITERATIONS}, ` +
  `token_version = token_version + 1 WHERE username='${username.replace(/'/g, "''")}';`,
);
