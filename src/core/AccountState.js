// Dr. Vibe — is this install linked to a community account?
//
// Everything online (VP earning, polling, visits, community data) runs only
// while linked. The app is a complete companion without an account, so the
// default is "unlinked" and every online feature waits for ACCOUNT_LINKED.
//
// Linking arrives as the Rust `account-linked` event (after the
// dr-vibe://auth/callback code exchange); unlinking as `account-unlinked`
// (Sign out, or Rust dropping a token the server answered 401
// `invalid_device_token` to).

import { eventBus, Events } from './EventBus.js';
import { getProfile } from './api/client.js';

class AccountState {
  constructor() {
    this._linked = false;
    this._username = null;
    this._initialized = false;
  }

  get linked() { return this._linked; }
  get username() { return this._username; }

  async init() {
    if (this._initialized) return;
    this._initialized = true;
    await this.refresh();
    const listen = window.__TAURI__?.event?.listen;
    if (listen) {
      await listen('account-linked', () => { this.refresh().catch(() => {}); });
      await listen('account-unlinked', () => this._set(false, null));
    }
  }

  /** Re-read the keyring/profile and emit a change if the state moved. */
  async refresh() {
    const profile = await getProfile();
    this._set(!!profile?.linked, profile?.username || null);
  }

  /**
   * Called by API users on a 401. Rust already forgot a revoked token
   * (`invalid_device_token`) and emits account-unlinked; other 401s
   * (clock skew, a bad signature) are re-checked against the keyring.
   */
  markTokenRejected() {
    if (!this._linked) return;
    this.refresh().catch(() => {});
  }

  _set(linked, username) {
    const changed = linked !== this._linked;
    this._linked = linked;
    this._username = username;
    if (changed) {
      eventBus.emit(linked ? Events.ACCOUNT_LINKED : Events.ACCOUNT_UNLINKED, { username });
    }
  }
}

export const accountState = new AccountState();
