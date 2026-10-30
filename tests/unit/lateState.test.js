// The windows load and call commands before `setup` has run, so a command
// must not use `state()` for state that `setup` adds (`app.manage(...)`):
// `state()` on missing state aborts the app (2.0.6 crashed at launch this way).
// Such commands use `try_state()`.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const dir = join(import.meta.dirname, '..', '..', 'src-tauri', 'src');
const files = readdirSync(dir).filter(f => f.endsWith('.rs')).map(f => [f, readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n')]);

// State added in setup: `app.manage(Type ...` / `app.manage(Mutex::new(Type ...`.
const late = new Set();
for (const [, src] of files) {
  for (const m of src.matchAll(/\bapp\.manage\((?:Mutex::new\()?(\w+)/g)) late.add(m[1]);
}

/** Each `#[tauri::command]` function's text, up to its closing brace at column 0. */
function commands(src) {
  return src.split('#[tauri::command]').slice(1).map(part => part.slice(0, part.search(/\n}\n|\n}$/) + 2));
}

describe('state added in setup', () => {
  it('finds the tray state', () => {
    expect([...late]).toEqual(expect.arrayContaining(['TrayMenuState', 'CompanionTrayState', 'MainTrayIcon']));
  });

  it('commands read it with try_state, never state', () => {
    const bad = [];
    for (const [file, src] of files) {
      for (const body of commands(src)) {
        for (const m of body.matchAll(/\.state::<(?:Mutex<)?(\w+)/g)) {
          if (late.has(m[1])) bad.push(`${file}: ${body.match(/fn (\w+)/)?.[1]} uses state::<${m[1]}>`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
