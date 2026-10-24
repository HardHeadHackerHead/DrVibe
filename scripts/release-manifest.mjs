#!/usr/bin/env node
// Release helpers for scripts/release.mjs (see RELEASING.md).
//
//   node scripts/release-manifest.mjs check-version [--tag v2.0.0]
//       Fails unless tauri.conf.json, Cargo.toml and package.json agree
//       (and match the tag, when given).
//   node scripts/release-manifest.mjs collect --platform windows|macos --bundle-dir <dir> --out <dir>
//       Copies the installer, the updater bundle and its .sig out of Tauri's
//       bundle directory under stable names, plus an updater-<platform>.json
//       fragment (file name + minisign signature).
//   node scripts/release-manifest.mjs finalize --dir <dir> --repo owner/name --tag v2.0.0
//       Merges the fragments into the Tauri updater's latest.json and writes
//       SHA256SUMS over every file in <dir>.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Updater platform keys each build serves (tauri-plugin-updater `{os}-{arch}`). */
export const PLATFORM_KEYS = {
  windows: ['windows-x86_64'],
  // One universal build serves both Mac architectures.
  macos: ['darwin-aarch64', 'darwin-x86_64'],
};

/** Strips a leading `v` from a tag. */
export function tagVersion(tag) {
  return String(tag).trim().replace(/^v/, '');
}

/** The versions the app declares; they must all be equal. */
export function readVersions(root = ROOT) {
  const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const cargo = readFileSync(join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
  const pkgSection = cargo.split(/^\[/m).find((s) => s.startsWith('package]')) ?? '';
  const cargoVersion = pkgSection.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  return { 'tauri.conf.json': conf.version, 'package.json': pkg.version, 'src-tauri/Cargo.toml': cargoVersion };
}

/** Problems with the declared versions (empty when releasable). */
export function versionProblems(versions, tag) {
  const problems = [];
  const values = new Set(Object.values(versions));
  if (values.size !== 1) {
    problems.push(`versions differ: ${Object.entries(versions).map(([f, v]) => `${f}=${v}`).join(', ')}`);
  }
  const version = versions['tauri.conf.json'];
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) problems.push(`not a semver version: ${version}`);
  if (tag && tagVersion(tag) !== version) problems.push(`tag ${tag} does not match version ${version}`);
  return problems;
}

/**
 * Picks the installer and updater bundle from a Tauri bundle directory
 * listing. Handles both updater formats: `createUpdaterArtifacts: true`
 * (the installer itself + `.sig`) and `"v1Compatible"` (`.nsis.zip` / `.app.tar.gz` + `.sig`).
 */
export function pickBundle(platform, files) {
  const has = (f) => files.includes(f);
  if (platform === 'windows') {
    const installer = files.find((f) => f.endsWith('-setup.exe'));
    if (!installer) throw new Error('no NSIS installer (*-setup.exe) in the bundle directory');
    const zip = `${installer.slice(0, -'.exe'.length)}.nsis.zip`;
    const updater = has(zip) && has(`${zip}.sig`) ? zip : has(`${installer}.sig`) ? installer : null;
    if (!updater) throw new Error(`no updater signature next to ${installer}; is TAURI_SIGNING_PRIVATE_KEY set?`);
    return { installer, updater };
  }
  if (platform === 'macos') {
    const installer = files.find((f) => f.endsWith('.dmg')) ?? null;
    const updater = files.find((f) => f.endsWith('.app.tar.gz') && has(`${f}.sig`));
    if (!updater) throw new Error('no signed .app.tar.gz in the bundle directory');
    return { installer, updater };
  }
  throw new Error(`unknown platform ${platform}`);
}

/** Stable, space-free asset names (GitHub mangles spaces in asset names). */
export function assetName(platform, version, file) {
  const arch = platform === 'windows' ? 'x64' : 'universal';
  const suffix = file.endsWith('-setup.exe')
    ? '-setup.exe'
    : file.endsWith('-setup.nsis.zip')
      ? '-setup.nsis.zip'
      : file.endsWith('.app.tar.gz')
        ? '.app.tar.gz'
        : file.slice(file.lastIndexOf('.'));
  return `DrVibe_${version}_${arch}${suffix}`;
}

/** The Tauri updater manifest for a release. */
export function buildLatestJson({ version, notes, pubDate, repo, tag, fragments }) {
  const platforms = {};
  for (const f of fragments) {
    for (const key of PLATFORM_KEYS[f.platform]) {
      platforms[key] = {
        signature: f.signature,
        url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(f.file)}`,
      };
    }
  }
  if (!platforms['windows-x86_64']) throw new Error('latest.json needs a Windows build');
  return { version, notes, pub_date: pubDate, platforms };
}

/** `sha256sum` format, sorted by file name, so `sha256sum -c` and the website both read it. */
export function formatSums(entries) {
  return [...entries]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => `${e.sha256}  ${e.name}\n`)
    .join('');
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? 'true' : argv[++i];
  }
  return out;
}

function collect({ platform, 'bundle-dir': bundleDir, out }) {
  const version = readVersions()['tauri.conf.json'];
  const files = readdirSync(bundleDir);
  const { installer, updater } = pickBundle(platform, files);
  mkdirSync(out, { recursive: true });
  const copied = [];
  for (const f of [installer, updater === installer ? null : updater].filter(Boolean)) {
    const name = assetName(platform, version, f);
    copyFileSync(join(bundleDir, f), join(out, name));
    copied.push(name);
  }
  const updaterName = assetName(platform, version, updater);
  const signature = readFileSync(join(bundleDir, `${updater}.sig`), 'utf8').trim();
  // The signature is in latest.json too; the .sig file is for anyone checking the bundle by hand.
  copyFileSync(join(bundleDir, `${updater}.sig`), join(out, `${updaterName}.sig`));
  writeFileSync(join(out, `updater-${platform}.json`), JSON.stringify({ platform, file: updaterName, signature }, null, 2));
  console.log(`collected ${copied.join(', ')}, ${updaterName}.sig`);
}

function finalize({ dir, repo, tag, notes }) {
  const version = tagVersion(tag);
  const fragmentFiles = readdirSync(dir).filter((f) => /^updater-\w+\.json$/.test(f));
  const fragments = fragmentFiles.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  for (const f of fragmentFiles) rmSync(join(dir, f));
  const latest = buildLatestJson({
    version,
    notes: notes ?? `Dr. Vibe ${version}`,
    pubDate: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    repo,
    tag,
    fragments,
  });
  writeFileSync(join(dir, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);
  const assets = readdirSync(dir).filter((f) => f !== 'SHA256SUMS');
  const sums = formatSums(assets.map((name) => ({ name, sha256: sha256File(join(dir, name)) })));
  writeFileSync(join(dir, 'SHA256SUMS'), sums);
  console.log(`latest.json: ${Object.keys(latest.platforms).join(', ')}\n${sums}`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = args(rest);
  if (cmd === 'check-version') {
    const versions = readVersions();
    const problems = versionProblems(versions, a.tag);
    if (problems.length) {
      for (const p of problems) console.error(`error: ${p}`);
      process.exit(1);
    }
    console.log(versions['tauri.conf.json']);
  } else if (cmd === 'collect') {
    collect(a);
  } else if (cmd === 'finalize') {
    if (!a.dir || !a.repo || !a.tag || !existsSync(a.dir)) throw new Error('finalize needs --dir, --repo and --tag');
    finalize(a);
  } else {
    console.error('usage: release-manifest.mjs check-version [--tag vX] | collect ... | finalize ...');
    process.exit(2);
  }
}

if (process.argv[1] && basename(process.argv[1]) === 'release-manifest.mjs') main();
