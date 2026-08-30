import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../bin/create-user.mjs', import.meta.url));

function run(args) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('create-user.mjs', () => {
  it('prints a single INSERT statement for a valid invocation', () => {
    const { status, stdout } = run(['teacher2', 'teacherpass99', 'editor']);
    expect(status).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^INSERT INTO users \(username, password_hash, salt, iterations, role\) VALUES \('teacher2', '[A-Za-z0-9+/=]+', '[A-Za-z0-9+/=]+', 100000, 'editor'\);$/,
    );
  });

  it('rejects a password shorter than 10 characters', () => {
    const { status, stderr } = run(['teacher2', 'short', 'editor']);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/at least 10 characters/);
  });

  it('rejects a role that is not owner or editor', () => {
    const { status, stderr } = run(['teacher2', 'teacherpass99', 'admin']);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/role must be owner or editor/);
  });

  it('rejects a missing username', () => {
    const { status, stderr } = run(['', 'teacherpass99', 'editor']);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/usage:/);
  });

  it('escapes single quotes in the username by doubling them', () => {
    const { status, stdout } = run(["o'brien", 'teacherpass99', 'owner']);
    expect(status).toBe(0);
    expect(stdout).toContain("'o''brien'");
  });
});
