// The local release command (scripts/release.mjs, RELEASING.md), driven by a
// stub command runner so nothing is built, tagged or uploaded.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_RELEASES_REPO,
  parseArgs,
  planRelease,
  preflightProblems,
  release,
  signingConfig,
} from '../../scripts/release.mjs';
import { checkCommands, runChecks } from '../../scripts/check.mjs';

const KEY_ENV = { TAURI_SIGNING_PRIVATE_KEY: 'untrusted comment: test key', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'pw' };
const versions = (v) => ({ 'tauri.conf.json': v, 'package.json': v, 'src-tauri/Cargo.toml': v });

describe('parseArgs', () => {
  it('takes a tag and flags in any order', () => {
    expect(parseArgs(['--dry-run', 'v2.0.0', '--skip-checks', '--notes', 'Hello there'])).toEqual({
      tag: 'v2.0.0',
      dryRun: true,
      skipChecks: true,
      notes: 'Hello there',
      help: false,
    });
    expect(parseArgs(['v2.0.0-beta.3']).tag).toBe('v2.0.0-beta.3');
  });

  it('refuses a missing or malformed tag and unknown options', () => {
    expect(() => parseArgs([])).toThrow(/give the tag/);
    expect(() => parseArgs(['2.0.0'])).toThrow(/not v<semver>/);
    expect(() => parseArgs(['v2.0'])).toThrow(/not v<semver>/);
    expect(() => parseArgs(['v2.0.0', '--force'])).toThrow(/unknown option --force/);
    expect(() => parseArgs(['v2.0.0', 'v2.0.1'])).toThrow(/more than one tag/);
    expect(() => parseArgs(['v2.0.0', '--notes'])).toThrow(/--notes needs a value/);
  });

  it('--notes-file reads multi-line notes from a file', () => {
    const read = (p) => (p === 'notes.md' ? '## Dr. Vibe 2.0.3\r\n\r\n- One\r\n- Two\r\n' : '');
    expect(parseArgs(['v2.0.3', '--notes-file', 'notes.md'], read).notes).toBe('## Dr. Vibe 2.0.3\n\n- One\n- Two');
    expect(() => parseArgs(['v2.0.3', '--notes-file'], read)).toThrow(/--notes-file needs a path/);
    expect(() => parseArgs(['v2.0.3', '--notes-file', 'empty.md'], read)).toThrow(/is empty/);
    expect(() => parseArgs(['v2.0.3', '--notes', 'x', '--notes-file', 'notes.md'], read)).toThrow(/not both/);
    const missing = () => { throw new Error('ENOENT'); };
    expect(() => parseArgs(['v2.0.3', '--notes-file', 'nope.md'], missing)).toThrow(/can't read --notes-file nope.md/);
  });

  it('--help needs no tag', () => {
    expect(parseArgs(['--help']).help).toBe(true);
  });
});

describe('signingConfig', () => {
  it('is off unless a certificate or sign command is configured', () => {
    expect(signingConfig({})).toBeNull();
    expect(signingConfig({ WINDOWS_CERTIFICATE_THUMBPRINT: 'ABC123' })).toEqual({
      bundle: { windows: { certificateThumbprint: 'ABC123' } },
    });
    expect(signingConfig({ WINDOWS_SIGN_COMMAND: 'qwick sign --verify %1' })).toEqual({
      bundle: { windows: { signCommand: 'qwick sign --verify %1' } },
    });
    expect(() => signingConfig({ WINDOWS_CERTIFICATE_THUMBPRINT: 'A', WINDOWS_SIGN_COMMAND: 'b' })).toThrow(/not both/);
  });
});

describe('preflightProblems', () => {
  const base = { opts: { tag: 'v2.0.0' }, env: KEY_ENV, versions: versions('2.0.0'), gitStatus: '', headCommit: 'aaa', tagCommit: null };

  it('passes a clean, matching, keyed checkout', () => {
    expect(preflightProblems(base)).toEqual([]);
    expect(preflightProblems({ ...base, tagCommit: 'aaa' })).toEqual([]);
  });

  it('refuses a dirty tree, a version mismatch, a missing key and a tag on another commit', () => {
    expect(preflightProblems({ ...base, gitStatus: 'src/app.js\n' })[0]).toMatch(/not clean/);
    expect(preflightProblems({ ...base, versions: { ...versions('2.0.0'), 'package.json': '1.1.0' } })[0]).toMatch(/versions differ/);
    expect(preflightProblems({ ...base, opts: { tag: 'v2.0.1' } })).toEqual(['tag v2.0.1 does not match version 2.0.0']);
    expect(preflightProblems({ ...base, env: {} })[0]).toMatch(/TAURI_SIGNING_PRIVATE_KEY is not set/);
    expect(preflightProblems({ ...base, tagCommit: 'bbbbbbbb' })[0]).toMatch(/already exists on another commit/);
  });
});

describe('planRelease', () => {
  const root = join(tmpdir(), 'drvibe-plan');
  const names = (plan) => plan.steps.map((s) => s.name);

  it('runs the checks, builds NSIS, writes the manifest, then tags and drafts', () => {
    const plan = planRelease({ opts: parseArgs(['v2.0.0']), env: KEY_ENV, root });
    expect(plan.repo).toBe(DEFAULT_RELEASES_REPO);
    expect(names(plan)).toEqual([
      'npm ci',
      ...checkCommands(root).map((c) => c.name),
      'clean old bundles',
      'tauri build (NSIS)',
      'collect',
      'latest.json + SHA256SUMS',
      'git tag',
      'git push tag',
      'create draft release',
    ]);
    const build = plan.steps.find((s) => s.name === 'tauri build (NSIS)');
    expect(build.args.slice(1)).toEqual(['build', '--bundles', 'nsis', '--ci']);
    const create = plan.steps.at(-1);
    expect(create.args).toContain('--draft');
    expect(create.args).toEqual(expect.arrayContaining(['--repo', DEFAULT_RELEASES_REPO, '--title', 'Dr. Vibe 2.0.0']));
    expect(plan.steps.filter((s) => s.publish).map((s) => s.name)).toEqual(['git tag', 'git push tag', 'create draft release']);
  });

  it('honours --skip-checks, GITHUB_RELEASES_REPO, signing, an existing tag and an existing draft', () => {
    const env = { ...KEY_ENV, GITHUB_RELEASES_REPO: 'someone/elsewhere', WINDOWS_SIGN_COMMAND: 'qwick sign --verify %1' };
    const plan = planRelease({ opts: parseArgs(['v2.0.0', '--skip-checks']), env, root, tagExists: true, release: { draft: true } });
    expect(plan.repo).toBe('someone/elsewhere');
    expect(names(plan)).toEqual([
      'npm ci',
      'clean old bundles',
      'tauri build (NSIS)',
      'collect',
      'verify Authenticode',
      'latest.json + SHA256SUMS',
      'git push tag',
      'upload to the existing draft',
    ]);
    const build = plan.steps.find((s) => s.name === 'tauri build (NSIS)');
    expect(JSON.parse(build.args.at(-1))).toEqual({ bundle: { windows: { signCommand: 'qwick sign --verify %1' } } });
    expect(plan.steps.at(-1).args).toContain('--clobber');
  });
});

describe('release (stubbed runner)', () => {
  let root;
  let calls;
  let out;

  const writeVersions = (v) => {
    mkdirSync(join(root, 'src-tauri'), { recursive: true });
    writeFileSync(join(root, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ version: v }));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: v }));
    writeFileSync(join(root, 'src-tauri', 'Cargo.toml'), `[package]\nname = "dr-vibe"\nversion = "${v}"\n`);
  };

  /** Answers the git/gh queries; every other command succeeds. */
  const stub = (answers = {}) => (cmd, args) => {
    const line = [cmd, ...args].join(' ');
    calls.push(line);
    for (const [prefix, reply] of Object.entries(answers)) if (line.startsWith(prefix)) return { stdout: '', ...reply };
    if (line === 'git rev-parse HEAD') return { code: 0, stdout: 'aaa\n' };
    if (line.startsWith('git rev-parse -q --verify')) return { code: 1, stdout: '' };
    if (line.startsWith('gh release view')) return { code: 1, stdout: '' };
    return { code: 0, stdout: '' };
  };

  const go = (argv, { env = KEY_ENV, answers } = {}) => release({
    opts: parseArgs(argv),
    env,
    run: stub(answers),
    log: (m) => out.push(m),
    error: (m) => out.push(m),
    root,
    listDir: () => ['DrVibe_2.0.0_x64-setup.exe', 'SHA256SUMS', 'latest.json'],
    readText: () => 'abc  DrVibe_2.0.0_x64-setup.exe\n',
  });

  beforeEach(() => {
    const parent = mkdtempSync(join(tmpdir(), 'drvibe-release-'));
    root = join(parent, 'drvibe-desktop');
    writeVersions('2.0.0');
    calls = [];
    out = [];
  });
  afterEach(() => rmSync(join(root, '..'), { recursive: true, force: true }));

  it('a dry run builds and writes the manifest but never tags, pushes or uploads', () => {
    expect(go(['v2.0.0', '--dry-run', '--skip-checks'])).toBe(0);
    expect(calls.some((c) => c.includes('tauri.js build --bundles nsis --ci'))).toBe(true);
    expect(calls.some((c) => c.includes('release-manifest.mjs finalize'))).toBe(true);
    expect(calls.filter((c) => /^git (tag|push)|^gh /.test(c))).toEqual([]);
    expect(out.join('\n')).toMatch(/Dry run finished/);
  });

  it('a real run tags, pushes and creates a draft with every release file, then prints the publish command', () => {
    expect(go(['v2.0.0', '--skip-checks'])).toBe(0);
    const tail = calls.slice(-3);
    expect(tail[0]).toBe('git tag -a v2.0.0 -m Dr. Vibe 2.0.0');
    expect(tail[1]).toBe('git push origin refs/tags/v2.0.0');
    expect(tail[2]).toMatch(/^gh release create v2.0.0 .*DrVibe_2.0.0_x64-setup.exe .*SHA256SUMS .*latest.json --repo HardHeadHackerHead\/DrVibe --draft/);
    expect(out.join('\n')).toContain(`gh release edit v2.0.0 --repo ${DEFAULT_RELEASES_REPO} --draft=false --latest`);
  });

  it('runs the checks first unless --skip-checks', () => {
    expect(go(['v2.0.0', '--dry-run'])).toBe(0);
    const build = calls.findIndex((c) => c.includes('tauri.js build'));
    for (const check of ['vitest.mjs run', 'cargo fmt --check', 'cargo clippy --all-targets -- -D warnings', 'cargo test']) {
      const i = calls.findIndex((c) => c.includes(check));
      expect(i).toBeGreaterThan(-1);
      expect(i).toBeLessThan(build);
    }
  });

  it('stops at the first failing step', () => {
    expect(go(['v2.0.0', '--dry-run'], { answers: { 'cargo clippy': { code: 1 } } })).toBe(1);
    expect(calls.some((c) => c.includes('tauri.js build'))).toBe(false);
  });

  it('refuses without the signing key, even for a dry run', () => {
    expect(go(['v2.0.0', '--dry-run'], { env: {} })).toBe(1);
    expect(out.join('\n')).toMatch(/TAURI_SIGNING_PRIVATE_KEY is not set/);
    expect(calls.some((c) => c.includes('tauri.js'))).toBe(false);
  });

  it('refuses a dirty tree and a tag that does not match the versions', () => {
    expect(go(['v2.0.0', '--dry-run'], { answers: { 'git diff --name-only HEAD': { code: 0, stdout: 'package.json\n' } } })).toBe(1);
    expect(go(['v2.0.1', '--dry-run'])).toBe(1);
    expect(out.join('\n')).toMatch(/not clean[\s\S]*tag v2.0.1 does not match version 2.0.0/);
  });

  it('refuses to touch an already published release, and uploads into an existing draft', () => {
    expect(go(['v2.0.0'], { answers: { 'gh release view': { code: 0, stdout: 'false\n' } } })).toBe(1);
    expect(out.join('\n')).toMatch(/already has a published release/);
    calls = [];
    expect(go(['v2.0.0', '--skip-checks'], { answers: { 'gh release view': { code: 0, stdout: 'true\n' } } })).toBe(0);
    expect(calls.at(-1)).toMatch(/^gh release upload v2.0.0 .* --clobber$/);
  });

  it('refuses when gh is not logged in', () => {
    expect(go(['v2.0.0'], { answers: { 'gh auth status': { code: 1 } } })).toBe(1);
    expect(out.join('\n')).toMatch(/gh auth login/);
  });
});

describe('npm run check', () => {
  it('runs every check and reports all failures', () => {
    const ran = [];
    const failed = runChecks({
      root: '/r',
      log: () => {},
      run: (cmd, args, { cwd }) => {
        ran.push([cmd, ...args].join(' '));
        // Only the protocol crate is badly formatted.
        return { code: args.includes('fmt') && cwd.endsWith('drvibe-protocol') ? 1 : 0 };
      },
    });
    expect(failed).toEqual(['protocol: cargo fmt --check']);
    expect(ran).toHaveLength(7);
  });
});
