// The release CSP is only enforced in installed builds (dev uses devCsp), so
// a policy that blocks the app's own files passes every dev run and test
// while the shipped app fails to boot. These checks pin the essentials.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const { csp, devCsp } = conf.app.security;

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'assets' ? [] : jsFiles(p);
    return name.endsWith('.js') ? [p] : [];
  });
}

describe('content security policy', () => {
  it.each([['csp', csp], ['devCsp', devCsp]])('%s lets the app load its own files', (_, policy) => {
    // JSON module imports and fetch() of bundled files count as connect-src.
    expect(policy['connect-src'].split(/\s+/)).toContain("'self'");
  });

  it('the release policy allows every bundled JSON import', () => {
    const jsonImports = jsFiles(join(root, 'src')).filter((f) => /from\s+['"][^'"]+\.json['"]\s+with\s*\{\s*type:\s*['"]json['"]/.test(readFileSync(f, 'utf8')));
    expect(jsonImports.length).toBeGreaterThan(0);
    expect(csp['connect-src']).toContain("'self'");
  });

  it('loads images only from drvibe.io, its CDN and the avatar hosts', () => {
    const remote = csp['img-src'].split(/\s+/).filter((s) => /^https?:/.test(s) && !/asset\.localhost/.test(s));
    expect(remote.sort()).toEqual([
      'https://avatars.githubusercontent.com', 'https://cdn.discordapp.com', 'https://cdn.drvibe.io', 'https://drvibe.io',
    ]);
    expect(csp['img-src'].split(/\s+/)).not.toContain('https:');
  });

  it('only talks to drvibe.io in release builds', () => {
    const remote = csp['connect-src'].split(/\s+/).filter((s) => s.startsWith('http') && !/localhost/.test(s));
    expect(remote.every((s) => /^https:\/\/(\*\.)?drvibe\.io$/.test(s))).toBe(true);
  });
});
