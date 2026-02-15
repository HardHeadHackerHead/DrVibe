// Dr. Vibe - Database Reader
// Lightweight accessor for secondary windows (dashboard, settings page, etc.)
// Reads/writes to the same unified dr-vibe-data.json store.
// Primary access is via localStorage (mirrored by the main window's Database).
// Falls back to Tauri Store plugin if localStorage is empty.

const DB_FILENAME = 'dr-vibe-data.json';
const LOCALSTORAGE_KEY = 'dr-vibe-database';

// Cache the store module so we only try the import once
let _storeModuleCache = undefined; // undefined = not tried, null = failed, object = success

async function _getStoreModule() {
  if (_storeModuleCache !== undefined) return _storeModuleCache;

  try {
    // The bare specifier import fails without a bundler, but try it with a timeout
    // in case the environment supports it (e.g. import maps or bundled builds)
    const result = await Promise.race([
      import('@tauri-apps/plugin-store'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('store import timeout')), 1000)),
    ]);
    _storeModuleCache = result;
    return result;
  } catch (e) {
    _storeModuleCache = null;
    return null;
  }
}

export async function readSection(section) {
  // Try localStorage first (fastest, mirrored by main window)
  const localValue = _readFromLocalStorage(section);
  if (localValue !== null) return localValue;

  // If localStorage is empty, try Tauri Store as fallback
  try {
    const mod = await _getStoreModule();
    if (mod) {
      const store = await mod.Store.load(DB_FILENAME);
      return await store.get(section);
    }
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
    const mod = await _getStoreModule();
    if (mod) {
      const store = await mod.Store.load(DB_FILENAME);
      for (const s of sections) {
        result[s] = await store.get(s);
      }
      return result;
    }
  } catch (e) {
    console.log('DatabaseReader: Store fallback failed:', e);
  }

  return result;
}

export async function writeSection(section, value) {
  // Always write to localStorage (immediate cross-window visibility)
  _writeToLocalStorage(section, value);

  // Also try writing to Tauri Store for persistence
  try {
    const mod = await _getStoreModule();
    if (mod) {
      const store = await mod.Store.load(DB_FILENAME);
      await store.set(section, value);
      await store.save();
    }
  } catch (e) {
    console.log('DatabaseReader: Store write failed (localStorage used):', e);
  }
}

export async function writeKey(section, key, value) {
  // Always write to localStorage first
  _writeKeyToLocalStorage(section, key, value);

  // Also try writing to Tauri Store for persistence
  try {
    const mod = await _getStoreModule();
    if (mod) {
      const store = await mod.Store.load(DB_FILENAME);
      const current = (await store.get(section)) || {};
      current[key] = value;
      await store.set(section, current);
      await store.save();
    }
  } catch (e) {
    console.log('DatabaseReader: Store writeKey failed (localStorage used):', e);
  }
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
