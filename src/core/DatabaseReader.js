// Dr. Vibe - Database Reader
// Lightweight accessor for secondary windows (dashboard, settings page, etc.)
// Reads/writes to the same unified dr-vibe-data.json store.
// Primary access is via localStorage (mirrored by the main window's Database).
// Falls back to Tauri Store plugin if localStorage is empty.

import { TauriStore } from './Database.js';

const DB_FILENAME = 'dr-vibe-data.json';
const LOCALSTORAGE_KEY = 'dr-vibe-database';

// Read-only fallback to the Tauri store (through the plugin's IPC commands,
// like Database.js). Writes go to localStorage only: the main window owns the
// store and persists what it receives through the settings-saved events.
async function _readFromStore(sections) {
  if (!window.__TAURI__?.core?.invoke) return null;
  const store = await TauriStore.load(DB_FILENAME);
  const out = {};
  for (const s of sections) out[s] = (await store.get(s)) ?? null;
  return out;
}

export async function readSection(section) {
  // Try localStorage first (fastest, mirrored by main window)
  const localValue = _readFromLocalStorage(section);
  if (localValue !== null) return localValue;

  // If localStorage is empty, try Tauri Store as fallback
  try {
    const fromStore = await _readFromStore([section]);
    if (fromStore) return fromStore[section];
  } catch (e) {
    console.log('DatabaseReader: Store fallback failed:', e);
  }

  return null;
}

export async function readSections(...sections) {
  // Try localStorage first
  const result = {};
  let allFound = true;
  for (const s of sections) {
    result[s] = _readFromLocalStorage(s);
    if (result[s] === null) allFound = false;
  }

  // If we got at least some data from localStorage, return it
  // (null sections just mean no data saved for that section yet)
  const hasAnyData = Object.values(result).some(v => v !== null);
  if (hasAnyData) return result;

  // If localStorage is completely empty, try Tauri Store as fallback
  try {
    const fromStore = await _readFromStore(sections);
    if (fromStore) return fromStore;
  } catch (e) {
    console.log('DatabaseReader: Store fallback failed:', e);
  }

  return result;
}

export async function writeSection(section, value) {
  // localStorage gives immediate cross-window visibility; the main window
  // persists to the store.
  _writeToLocalStorage(section, value);
}

export async function writeKey(section, key, value) {
  _writeKeyToLocalStorage(section, key, value);
}

// --- localStorage helpers ---

function _readFromLocalStorage(section) {
  try {
    const saved = localStorage.getItem(LOCALSTORAGE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      return data[section] ?? null;
    }
  } catch { /* ignore */ }
  return null;
}

function _writeToLocalStorage(section, value) {
  try {
    const saved = localStorage.getItem(LOCALSTORAGE_KEY);
    const data = saved ? JSON.parse(saved) : {};
    data[section] = value;
    localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

function _writeKeyToLocalStorage(section, key, value) {
  try {
    const saved = localStorage.getItem(LOCALSTORAGE_KEY);
    const data = saved ? JSON.parse(saved) : {};
    if (!data[section]) data[section] = {};
    data[section][key] = value;
    localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}
