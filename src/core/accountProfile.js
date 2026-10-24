// Dr. Vibe — keeps the stored account profile (username, display name,
// profile picture) in step with the site.
//
// The link response is stored once (Rust, `dr-vibe-data.json` "profile").
// Players change their Discord/GitHub picture or pick a different one on the
// site later, so every poll's `account` is compared with what was last
// stored and, when it differs, handed to the `update_profile` command, which
// saves it and emits `account-profile-updated` to every window.

const FIELDS = ['username', 'displayName', 'avatarUrl'];

const norm = (v) => (typeof v === 'string' && v ? v : null);

/**
 * The profile fields from a server account object, or null when unusable.
 * @param {{ username?: string, displayName?: string|null, avatarUrl?: string|null }|null|undefined} account
 */
export function profileFromAccount(account) {
  if (!account || typeof account !== 'object' || !norm(account.username)) return null;
  const avatar = norm(account.avatarUrl);
  return {
    username: norm(account.username),
    displayName: norm(account.displayName),
    // Only http(s) pictures ever reach an <img>.
    avatarUrl: avatar && /^https?:\/\//i.test(avatar) ? avatar : null,
  };
}

/** Whether `next` differs from `prev` in any stored field. */
export function profileChanged(prev, next) {
  if (!next) return false;
  if (!prev) return true;
  return FIELDS.some((k) => norm(prev[k]) !== norm(next[k]));
}

/**
 * Returns `(account) => Promise<boolean>` that calls `invoke('update_profile')`
 * only when the account differs from the last profile seen.
 * @param {(cmd: string, args?: object) => Promise<unknown>} invoke
 * @param {object|null} [initial] the stored profile, if already known
 */
export function createProfileRefresher(invoke, initial = null) {
  let last = initial ? profileFromAccount(initial) : null;
  return async function refresh(account) {
    const next = profileFromAccount(account);
    if (!profileChanged(last, next)) return false;
    try {
      await invoke('update_profile', next);
      last = next;
      return true;
    } catch (e) {
      console.warn('[account] could not refresh the stored profile:', e);
      return false;
    }
  };
}
