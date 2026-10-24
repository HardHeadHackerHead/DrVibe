// Dr. Vibe — Balance Manager
// Single-currency Vibe Points (VP) mirror. Source of truth is the website.
// VP exists only for linked players: while unlinked the tray shows no
// balance and nothing is fetched.
// - Reads the cached lastKnownBalance from Database.js on link for instant
//   offline tray display.
// - Fetches the authoritative balance through desktopApi.balance().
// - Listens for Events.ECONOMY_EARNED / ECONOMY_BALANCE_PUSH (EconomyClient)
//   and updates the tray.

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';
import { db } from '../../core/Database.js';
import { desktopApi } from '../../core/api/client.js';
import { accountState } from '../../core/AccountState.js';

const DB_SECTION = 'economy';
const DB_KEY_LAST_KNOWN = 'lastKnownBalance';

class BalanceManager {
  constructor() {
    this._balance = null;
    this._totalEarned = null;
    this._totalSpent = null;
    this._online = false;
    this._rank = null;
    this._friendsCoding = null;
  }

  /** Rank and friends coding now, from the sync response, for the tray tooltip. */
  setCommunitySummary(rank, friendsCoding) {
    this._rank = Number.isFinite(Number(rank)) && rank !== null ? Number(rank) : null;
    this._friendsCoding = Number.isFinite(Number(friendsCoding)) && friendsCoding !== null ? Number(friendsCoding) : null;
    this._updateTray();
  }

  async init() {
    this._setupListeners();
    if (accountState.linked) await this._onLinked();
    else this._updateTray();
  }

  /**
   * Force a fresh balance fetch. Used by app.js after the OAuth callback
   * so the tray picks up the authoritative balance immediately.
   */
  async refresh() {
    await this._fetchBalance();
  }

  _setupListeners() {
    eventBus.on(Events.ACCOUNT_LINKED, () => { this._onLinked().catch(() => {}); });
    eventBus.on(Events.ACCOUNT_UNLINKED, () => {
      this._balance = null;
      this._totalEarned = null;
      this._totalSpent = null;
      this._online = false;
      this._rank = null;
      this._friendsCoding = null;
      this._updateTray();
      eventBus.emit(Events.BALANCE_UPDATED, { balance: null });
    });

    // Unified economy credit (throttled toast flush from EconomyClient, or a
    // quest claim). Server is authoritative: newBalance wins.
    eventBus.on(Events.ECONOMY_EARNED, ({ newBalance }) => {
      if (newBalance !== null && newBalance !== undefined) {
        this._setBalance(Number(newBalance));
      }
    });

    // Silent balance push — immediate per-POST update from EconomyClient.
    eventBus.on(Events.ECONOMY_BALANCE_PUSH, ({ newBalance }) => {
      if (newBalance !== null && newBalance !== undefined) {
        this._setBalance(Number(newBalance));
      }
    });
  }

  async _onLinked() {
    // Instant offline tray: show the last known balance before the fetch.
    try {
      const cached = db.get(DB_SECTION, DB_KEY_LAST_KNOWN);
      if (cached !== null && cached !== undefined && !Number.isNaN(Number(cached))) {
        this._balance = Number(cached);
        this._updateTray();
      }
    } catch (e) {
      console.warn('[balance] failed to read cached balance:', e);
    }
    await this._fetchBalance();
  }

  async _fetchBalance() {
    if (!accountState.linked) return;
    const r = await desktopApi.balance();
    this._online = r.ok;
    if (!r.ok) {
      if (r.status === 401) accountState.markTokenRejected();
      this._updateTray();
      return;
    }
    const data = r.data || {};
    // Server returns { vibePoints, totalEarned, totalSpent, ... }.
    const next = data.vibePoints ?? data.balance ?? 0;
    this._totalEarned = Number(data.totalEarned ?? 0);
    this._totalSpent = Number(data.totalSpent ?? 0);
    this._setBalance(Number(next));
  }

  getLifetimeStats() {
    if (!accountState.linked) return null;
    return {
      balance: this._balance,
      totalEarned: this._totalEarned,
      totalSpent: this._totalSpent,
    };
  }

  _setBalance(next) {
    if (!accountState.linked) return;
    this._balance = next;
    try {
      db.set(DB_SECTION, DB_KEY_LAST_KNOWN, next);
    } catch (e) {
      console.warn('[balance] failed to persist balance:', e);
    }
    this._updateTray();
    eventBus.emit(Events.BALANCE_UPDATED, { balance: this._balance });
  }

  _updateTray() {
    if (!accountState.linked) {
      tauri.setTrayTooltip('Dr. Vibe');
      return;
    }
    const balancePart = (this._balance !== null)
      ? ` | ${Number(this._balance).toLocaleString('en-US')} VP`
      : '';
    const status = this._online ? '' : ' (offline)';
    const rankPart = this._rank ? ` | #${this._rank}` : '';
    const friendsPart = this._friendsCoding
      ? ` | ${this._friendsCoding} friend${this._friendsCoding === 1 ? '' : 's'} coding`
      : '';
    tauri.setTrayTooltip(`Dr. Vibe${status}${balancePart}${rankPart}${friendsPart}`);
  }

  // --- Public API (kept for external callers) ---

  getBalance() {
    return accountState.linked ? this._balance : null;
  }

  get vibePoints() {
    return this.getBalance();
  }
}

export const balanceManager = new BalanceManager();
