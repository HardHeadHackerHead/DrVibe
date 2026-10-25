#!/usr/bin/env node
// Builds a Dr. Vibe release on this machine and uploads it to GitHub Releases
// as a draft (RELEASING.md has the whole procedure and every env var).
//
//   npm run release -- v2.0.0                 checks, build, tag, push the tag, draft release
//   npm run release -- v2.0.0 --dry-run       everything except tag, push and upload
//   npm run release -- v2.0.0 --skip-checks   skip vitest / cargo fmt / clippy / test
//   npm run release -- v2.0.0 --notes "..."   release notes (default "Dr. Vibe 2.0.0")
//   npm run release -- v2.0.0 --notes-file notes.md   multi-line notes from a file
//                                             (npm on Windows cuts --notes at the first line break)
//
// Env: TAURI_SIGNING_PRIVATE_KEY (required) and TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
// GITHUB_RELEASES_REPO (default HardHeadHackerHead/DrVibe);
// optional Authenticode: WINDOWS_CERTIFICATE_THUMBPRINT or WINDOWS_SIGN_COMMAND.

import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { checkCommands, ROOT, spawnRunner } from './check.mjs';
import { assetName, readVersions, tagVersion, versionProblems } from './release-manifest.mjs';

/** Where players download from; the website's /api/v1/downloads redirect defaults to the same repo. */
export const DEFAULT_RELEASES_REPO = 'HardHeadHackerHead/DrVibe';

const TAG_RE = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export const USAGE = 'usage: npm run release -- <vX.Y.Z> [--dry-run] [--skip-checks] [--notes "text" | --notes-file path]';

/** Parses the command line; throws with a message on anything unexpected. */
export function parseArgs(argv, readFile = (p) => readFileSync(p, 'utf8')) {
  const opts = { tag: null, dryRun: false, skipChecks: false, notes: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--skip-checks') opts.skipChecks = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--notes') {
      if (argv[i + 1] === undefined) throw new Error('--notes needs a value');
      if (opts.notes !== null) throw new Error('give --notes or --notes-file, not both');
      opts.notes = argv[++i];
    } else if (a === '--notes-file') {
      if (argv[i + 1] === undefined) throw new Error('--notes-file needs a path');
      if (opts.notes !== null) throw new Error('give --notes or --notes-file, not both');
      const path = argv[++i];
      let text;
      try {
        text = readFile(path);
      } catch (e) {
        throw new Error(`can't read --notes-file ${path}: ${e.message}`);
      }
      opts.notes = text.replace(/\r\n/g, '\n').trim();
      if (!opts.notes) throw new Error(`--notes-file ${path} is empty`);
    } else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else if (opts.tag) throw new Error(`more than one tag given (${opts.tag}, ${a})`);
    else opts.tag = a;
  }
  if (opts.help) return opts;
  if (!opts.tag) throw new Error('give the tag to release, for example v2.0.0');
  if (!TAG_RE.test(opts.tag)) throw new Error(`tag ${opts.tag} is not v<semver> (for example v2.0.0 or v2.0.0-beta.1)`);
  return opts;
}

/**
 * Optional Authenticode signing, passed to `tauri build --config` so Tauri
 * signs the app exe and the installer before it signs the updater bundle.
 */
export function signingConfig(env) {
  const thumbprint = env.WINDOWS_CERTIFICATE_THUMBPRINT?.trim();
  const signCommand = env.WINDOWS_SIGN_COMMAND?.trim();
  if (thumbprint && signCommand) throw new Error('set WINDOWS_CERTIFICATE_THUMBPRINT or WINDOWS_SIGN_COMMAND, not both');
  if (thumbprint) return { bundle: { windows: { certificateThumbprint: thumbprint } } };
  if (signCommand) return { bundle: { windows: { signCommand } } };
  return null;
}

/** Reasons not to release (empty when good to go). */
export function preflightProblems({ opts, env, versions, gitStatus, headCommit, tagCommit }) {
  const problems = [];
  if (gitStatus.trim()) problems.push(`the working tree is not clean:\n${gitStatus.trimEnd()}`);
  problems.push(...versionProblems(versions, opts.tag));
  if (!env.TAURI_SIGNING_PRIVATE_KEY?.trim()) {
    problems.push('TAURI_SIGNING_PRIVATE_KEY is not set; the updater bundle cannot be signed (RELEASING.md, "Env vars")');
  }
  if (tagCommit && tagCommit !== headCommit) problems.push(`tag ${opts.tag} already exists on another commit (${tagCommit.slice(0, 12)})`);
  try {
    signingConfig(env);
  } catch (e) {
    problems.push(e.message);
  }
  return problems;
}

/**
 * The release as a list of steps. Command steps are `{ name, cmd, args, cwd }`,
 * in-process steps `{ name, fn }`. `publish: true` steps are skipped by --dry-run.
 * `release` (an existing draft, or null) decides between create and upload.
 */
export function planRelease({ opts, env, root = ROOT, tagExists = false, release = null }) {
  const version = tagVersion(opts.tag);
  const repo = env.GITHUB_RELEASES_REPO?.trim() || DEFAULT_RELEASES_REPO;
  const notes = opts.notes ?? `Dr. Vibe ${version}`;
  const bundleDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  const outDir = join(root, 'release', opts.tag);
  const manifest = join(root, 'scripts', 'release-manifest.mjs');
  const signing = signingConfig(env);
  const node = process.execPath;
  const installer = join(outDir, assetName('windows', version, '-setup.exe'));

  const steps = [{ name: 'npm ci', cmd: 'npm', args: ['ci', '--ignore-scripts'], cwd: root, shell: true }];
  if (!opts.skipChecks) steps.push(...checkCommands(root));
  steps.push({
    name: 'clean old bundles',
    fn: () => {
      rmSync(bundleDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    },
  });
  const buildArgs = [join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), 'build', '--bundles', 'nsis', '--ci'];
  if (signing) buildArgs.push('--config', JSON.stringify(signing));
  steps.push({ name: 'tauri build (NSIS)', cmd: node, args: buildArgs, cwd: root });
  steps.push({
    name: 'collect',
    cmd: node,
    args: [manifest, 'collect', '--platform', 'windows', '--bundle-dir', bundleDir, '--out', outDir],
    cwd: root,
  });
  if (signing) {
    const ps = `$s = Get-AuthenticodeSignature -LiteralPath '${installer.replace(/'/g, "''")}'; `
      + 'Write-Host "Authenticode: $($s.Status) $($s.SignerCertificate.Subject) (timestamped: $($null -ne $s.TimeStamperCertificate))"; '
      + "if ($s.Status -ne 'Valid') { exit 1 }";
    steps.push({ name: 'verify Authenticode', cmd: 'powershell', args: ['-NoProfile', '-Command', ps], cwd: root });
  }
  steps.push({
    name: 'latest.json + SHA256SUMS',
    cmd: node,
    args: [manifest, 'finalize', '--dir', outDir, '--repo', repo, '--tag', opts.tag, '--notes', notes],
    cwd: root,
  });

  if (!tagExists) {
    steps.push({ name: 'git tag', cmd: 'git', args: ['tag', '-a', opts.tag, '-m', `Dr. Vibe ${version}`], cwd: root, publish: true });
  }
  steps.push({ name: 'git push tag', cmd: 'git', args: ['push', 'origin', `refs/tags/${opts.tag}`], cwd: root, publish: true });
  // The asset list is only known after the build, so the upload expands outDir when it runs.
  const assets = { expandDir: outDir };
  if (release) {
    steps.push({
      name: 'upload to the existing draft',
      cmd: 'gh',
      args: ['release', 'upload', opts.tag, assets, '--repo', repo, '--clobber'],
      cwd: root,
      publish: true,
    });
  } else {
    steps.push({
      name: 'create draft release',
      cmd: 'gh',
      args: ['release', 'create', opts.tag, assets, '--repo', repo, '--draft', '--title', `Dr. Vibe ${version}`, '--notes', notes],
      cwd: root,
      publish: true,
    });
  }
  return { version, repo, outDir, steps };
}

/** Expands `{ expandDir }` placeholders into the files in that directory. */
function expandArgs(args, listDir) {
  return args.flatMap((a) => (typeof a === 'object' && a?.expandDir ? listDir(a.expandDir).map((f) => join(a.expandDir, f)) : [a]));
}

function display(step, args) {
  const shown = args.map((a) => (typeof a === 'object' ? `${a.expandDir}/*` : a))
    .map((a) => (a === process.execPath ? 'node' : a))
    .map((a) => (/\s/.test(a) ? `"${a}"` : a));
  return [step.cmd === process.execPath ? 'node' : step.cmd, ...shown].join(' ');
}

/**
 * Runs the release. `run(cmd, args, { cwd, capture, shell })` returns `{ code, stdout }`;
 * tests pass a stub. Returns 0 on success, 1 on failure.
 */
export function release({ opts, env = process.env, run = spawnRunner, log = console.log, error = console.error, root = ROOT,
  listDir = (d) => readdirSync(d).sort(), readText = (f) => readFileSync(f, 'utf8') }) {
  const git = (...args) => run('git', args, { cwd: root, capture: true });
  const head = git('rev-parse', 'HEAD');
  if (head.code !== 0) {
    error('error: not a git checkout');
    return 1;
  }
  const headCommit = head.stdout.trim();
  const tagRef = git('rev-parse', '-q', '--verify', `refs/tags/${opts.tag}^{commit}`);
  const tagCommit = tagRef.code === 0 ? tagRef.stdout.trim() : null;
  const problems = preflightProblems({
    opts,
    env,
    versions: readVersions(root),
    // Not `git status`: tauri build rewrites src-tauri/Cargo.toml with LF line
    // endings, which status reports as modified under core.autocrlf even though
    // the content is unchanged. `git diff HEAD` compares content.
    gitStatus: git('diff', '--name-only', 'HEAD').stdout + git('ls-files', '--others', '--exclude-standard').stdout,
    headCommit,
    tagCommit,
  });

  let existing = null;
  if (!opts.dryRun && problems.length === 0) {
    const repo = env.GITHUB_RELEASES_REPO?.trim() || DEFAULT_RELEASES_REPO;
    if (run('gh', ['auth', 'status'], { cwd: root, capture: true }).code !== 0) {
      problems.push('the GitHub CLI is not logged in; run `gh auth login`');
    } else {
      const view = run('gh', ['release', 'view', opts.tag, '--repo', repo, '--json', 'isDraft', '-q', '.isDraft'], { cwd: root, capture: true });
      if (view.code === 0 && view.stdout.trim() !== 'true') {
        problems.push(`${repo} already has a published release ${opts.tag}; release a new version instead`);
      } else if (view.code === 0) existing = { draft: true };
    }
  }
  if (problems.length) {
    for (const p of problems) error(`error: ${p}`);
    return 1;
  }

  const plan = planRelease({ opts, env, root, tagExists: tagCommit !== null, release: existing });
  log(`Releasing Dr. Vibe ${plan.version} (${opts.tag}) to ${plan.repo}${opts.dryRun ? ' -- DRY RUN, nothing is tagged or uploaded' : ''}`);
  for (const step of plan.steps) {
    if (step.publish && opts.dryRun) {
      log(`\n--- skip (dry run): ${display(step, step.args)}`);
      continue;
    }
    log(`\n==> ${step.name}`);
    if (step.fn) {
      step.fn();
      continue;
    }
    const args = expandArgs(step.args, listDir);
    log(`    ${display(step, args)}`);
    if (run(step.cmd, args, { cwd: step.cwd, shell: step.shell }).code !== 0) {
      error(`\nerror: ${step.name} failed${opts.dryRun ? '' : '; nothing was uploaded unless the step above was an upload'}`);
      return 1;
    }
  }

  const rel = relative(root, plan.outDir);
  log(`\nRelease files in ${rel}:\n${readText(join(plan.outDir, 'SHA256SUMS'))}`);
  if (opts.dryRun) {
    log('Dry run finished. Run again without --dry-run to tag, push and upload.');
  } else {
    log(`Draft release uploaded to https://github.com/${plan.repo}/releases/tag/${opts.tag}`);
    log('Check the files, then publish it (the updater and drvibe.io/downloads only see published releases):');
    log(`  gh release edit ${opts.tag} --repo ${plan.repo} --draft=false --latest`);
    log('Then submit the installer to Microsoft (RELEASING.md, "Microsoft false-positive submission").');
  }
  return 0;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${e.message}\n${USAGE}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  process.exit(release({ opts }));
}

if (process.argv[1] && basename(process.argv[1]) === 'release.mjs') main();
