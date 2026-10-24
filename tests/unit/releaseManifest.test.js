// Release helpers used by scripts/release.mjs (RELEASING.md).

import { describe, it, expect } from 'vitest';
import {
  assetName,
  buildLatestJson,
  formatSums,
  pickBundle,
  readVersions,
  tagVersion,
  versionProblems,
} from '../../scripts/release-manifest.mjs';

describe('release versions', () => {
  it('the app declares one version everywhere', () => {
    expect(versionProblems(readVersions())).toEqual([]);
  });

  it('flags mismatches and a tag that does not match', () => {
    const ok = { 'tauri.conf.json': '2.0.0', 'package.json': '2.0.0', 'src-tauri/Cargo.toml': '2.0.0' };
    expect(versionProblems(ok, 'v2.0.0')).toEqual([]);
    expect(versionProblems({ ...ok }, 'v2.0.0-beta.1')).toEqual(['tag v2.0.0-beta.1 does not match version 2.0.0']);
    expect(versionProblems({ ...ok, 'package.json': '1.1.0' })[0]).toMatch(/versions differ/);
    expect(tagVersion('v2.0.0-beta.2')).toBe('2.0.0-beta.2');
  });
});

describe('bundle picking', () => {
  it('prefers the v1-compatible .nsis.zip updater bundle', () => {
    const files = ['DrVibe_2.0.0_x64-setup.exe', 'DrVibe_2.0.0_x64-setup.nsis.zip', 'DrVibe_2.0.0_x64-setup.nsis.zip.sig'];
    expect(pickBundle('windows', files)).toEqual({
      installer: 'DrVibe_2.0.0_x64-setup.exe',
      updater: 'DrVibe_2.0.0_x64-setup.nsis.zip',
    });
  });

  it('falls back to the signed installer itself', () => {
    const files = ['DrVibe_2.0.0_x64-setup.exe', 'DrVibe_2.0.0_x64-setup.exe.sig'];
    expect(pickBundle('windows', files).updater).toBe('DrVibe_2.0.0_x64-setup.exe');
  });

  it('refuses an unsigned build', () => {
    expect(() => pickBundle('windows', ['DrVibe_2.0.0_x64-setup.exe'])).toThrow(/TAURI_SIGNING_PRIVATE_KEY/);
    expect(() => pickBundle('macos', ['Dr. Vibe.app.tar.gz'])).toThrow(/signed/);
  });

  it('names assets without spaces so the website finds the installer', () => {
    expect(assetName('windows', '2.0.0', 'DrVibe_2.0.0_x64-setup.exe')).toBe('DrVibe_2.0.0_x64-setup.exe');
    expect(assetName('windows', '2.0.0', 'DrVibe_2.0.0_x64-setup.nsis.zip')).toBe('DrVibe_2.0.0_x64-setup.nsis.zip');
    expect(assetName('macos', '2.0.0', 'Dr. Vibe.app.tar.gz')).toBe('DrVibe_2.0.0_universal.app.tar.gz');
    expect(assetName('macos', '2.0.0', 'DrVibe_2.0.0_universal.dmg')).toBe('DrVibe_2.0.0_universal.dmg');
  });
});

describe('latest.json and SHA256SUMS', () => {
  it('builds the updater manifest with release download URLs', () => {
    const json = buildLatestJson({
      version: '2.0.0',
      notes: 'Dr. Vibe 2.0.0',
      pubDate: '2026-11-01T10:00:00Z',
      repo: 'acme/dr-vibe-releases',
      tag: 'v2.0.0',
      fragments: [
        { platform: 'windows', file: 'DrVibe_2.0.0_x64-setup.nsis.zip', signature: 'sig-w' },
        { platform: 'macos', file: 'DrVibe_2.0.0_universal.app.tar.gz', signature: 'sig-m' },
      ],
    });
    expect(json.version).toBe('2.0.0');
    expect(json.platforms['windows-x86_64']).toEqual({
      signature: 'sig-w',
      url: 'https://github.com/acme/dr-vibe-releases/releases/download/v2.0.0/DrVibe_2.0.0_x64-setup.nsis.zip',
    });
    expect(json.platforms['darwin-aarch64'].signature).toBe('sig-m');
    expect(json.platforms['darwin-x86_64'].url).toMatch(/universal\.app\.tar\.gz$/);
  });

  it('needs a Windows build', () => {
    expect(() =>
      buildLatestJson({ version: '2.0.0', repo: 'a/b', tag: 'v2.0.0', fragments: [{ platform: 'macos', file: 'x', signature: 's' }] }),
    ).toThrow(/Windows/);
  });

  it('writes sha256sum-compatible lines sorted by name', () => {
    const h = (c) => c.repeat(64);
    expect(formatSums([{ name: 'b.exe', sha256: h('b') }, { name: 'a.json', sha256: h('a') }])).toBe(
      `${h('a')}  a.json\n${h('b')}  b.exe\n`,
    );
  });
});
