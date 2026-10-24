// Rewrite the generated blocks of tools/generate-character.md (the row
// table and the ROWS constant) from src/config/animations.js.
// Usage: npm run sync:generator-prompt
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncPromptText } from '../src/features/make/generatorPrompt.js';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'generate-character.md');
const before = fs.readFileSync(file, 'utf8');
// Keep the file's line endings (Windows checkouts get CRLF).
const eol = before.includes('\r\n') ? '\r\n' : '\n';
const after = syncPromptText(before.replace(/\r\n/g, '\n')).replace(/\n/g, eol);
if (after === before) {
  console.log('tools/generate-character.md is up to date.');
} else {
  fs.writeFileSync(file, after);
  console.log('Updated tools/generate-character.md.');
}
