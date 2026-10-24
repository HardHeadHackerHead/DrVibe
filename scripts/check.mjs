#!/usr/bin/env node
// Every check a change must pass before it is merged or released (see
// CONTRIBUTING.md and RELEASING.md). `scripts/release.mjs` runs the same list.
//
//   npm run check                   vitest, then cargo fmt --check, cargo clippy -D warnings
//                                   and cargo test for src-tauri and crates/drvibe-protocol
//   npm run check -- --fail-fast    stop at the first failure
//
// Needs `npm ci --ignore-scripts` once.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The checks, in the order they run. `name` is what the summary prints. */
export function checkCommands(root = ROOT) {
  const tauri = join(root, 'src-tauri');
  // The protocol crate is a path dependency of src-tauri but not a member of
  // its workspace, so clippy there would skip it: check it as its own package.
  const protocol = join(root, 'crates', 'drvibe-protocol');
  return [
    { name: 'vitest', cmd: process.execPath, args: [join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run'], cwd: root },
    { name: 'cargo fmt --check', cmd: 'cargo', args: ['fmt', '--check'], cwd: tauri },
    { name: 'cargo clippy', cmd: 'cargo', args: ['clippy', '--all-targets', '--', '-D', 'warnings'], cwd: tauri },
    { name: 'cargo test', cmd: 'cargo', args: ['test'], cwd: tauri },
    { name: 'protocol: cargo fmt --check', cmd: 'cargo', args: ['fmt', '--check'], cwd: protocol },
    {
      name: 'protocol: cargo clippy',
      cmd: 'cargo',
      args: ['clippy', '--all-targets', '--all-features', '--locked', '--', '-D', 'warnings'],
      cwd: protocol,
    },
    { name: 'protocol: cargo test', cmd: 'cargo', args: ['test', '--all-features', '--locked'], cwd: protocol },
  ];
}

/** Why the checks can't run here, or null. */
export function setupProblem(root = ROOT) {
  if (!existsSync(join(root, 'node_modules', 'vitest'))) return 'node_modules is missing; run `npm ci --ignore-scripts` first';
  return null;
}

/** Runs a command with inherited output (or captured stdout); never throws on a non-zero exit. */
export function spawnRunner(cmd, args, { cwd, capture = false, shell = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, shell, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8' });
  if (r.error) return { code: 127, stdout: '', stderr: String(r.error.message) };
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Runs the checks; returns the names of the ones that failed. */
export function runChecks({ run = spawnRunner, log = console.log, failFast = false, root = ROOT } = {}) {
  const failed = [];
  for (const c of checkCommands(root)) {
    log(`\n==> ${c.name}`);
    if (run(c.cmd, c.args, { cwd: c.cwd }).code !== 0) {
      failed.push(c.name);
      if (failFast) break;
    }
  }
  return failed;
}

function main() {
  const argv = process.argv.slice(2);
  const unknown = argv.filter((a) => a !== '--fail-fast');
  if (unknown.length) {
    console.error(`usage: npm run check [-- --fail-fast]   (unknown: ${unknown.join(' ')})`);
    process.exit(2);
  }
  const problem = setupProblem();
  if (problem) {
    console.error(`error: ${problem}`);
    process.exit(1);
  }
  const failed = runChecks({ failFast: argv.includes('--fail-fast') });
  if (failed.length) {
    console.error(`\nFAILED: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

if (process.argv[1] && basename(process.argv[1]) === 'check.mjs') main();
