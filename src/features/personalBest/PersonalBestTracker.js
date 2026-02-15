// Dr. Vibe - Personal Best Tracker
// Tracks and celebrates personal records across coding metrics.
// Competes only with yourself — encouraging, not pressuring.

import { eventBus, Events } from '../../core/EventBus.js';
import { db } from '../../core/Database.js';

const METRICS = {
  longestSession: {
    label: 'Longest Session',
    unit: 'seconds',
    format: (v) => {
      const h = Math.floor(v / 3600);
      const m = Math.floor((v % 3600) / 60);
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    },
  },
  mostFiles: {
    label: 'Most Files',
    unit: 'files',
    format: (v) => `${v} files`,
  },
  longestStreak: {
    label: 'Longest Streak',
    unit: 'days',
    format: (v) => `${v} day${v !== 1 ? 's' : ''}`,
  },
  bestMomentum: {
    label: 'Peak Momentum',
    unit: 'percent',
    format: (v) => `${v}%`,
  },
};

export { METRICS };

export class PersonalBestTracker {
  constructor() {
    this.bests = this._getDefaultBests();
    this.history = []; // Array of { date, metric, value }
    this._unsubscribers = [];
    this._peakMomentum = 0; // Track peak momentum within a session
  }

  _getDefaultBests() {
    return {
      longestSession: { value: 0, date: null },
      mostFiles: { value: 0, date: null },
      longestStreak: { value: 0, date: null },
      bestMomentum: { value: 0, date: null },
    };
  }

  async init() {
    this._loadStore();
    this._setupEventListeners();
    console.log('PersonalBestTracker initialized');
  }

  _loadStore() {
    const saved = db.getSection('personalBest');
    if (saved) {
      if (saved.bests) this.bests = { ...this._getDefaultBests(), ...saved.bests };
      if (saved.history) this.history = saved.history;
    }
  }

  _save() {
    db.setSection('personalBest', {
      bests: this.bests,
      history: this.history,
    });
  }

  _setupEventListeners() {
    // Check bests on every stats update (every 30s)
    this._unsubscribers.push(
      eventBus.on(Events.SESSION_STATS_UPDATED, (stats) => {
        this._checkSessionBests(stats);
      })
    );

    // Track peak momentum
    this._unsubscribers.push(
      eventBus.on(Events.MOMENTUM_CHANGED, ({ momentum }) => {
        if (momentum > this._peakMomentum) {
          this._peakMomentum = momentum;
          this._checkBest('bestMomentum', momentum);
        }
      })
    );
  }

  _checkSessionBests(stats) {
    const totalFiles = stats.filesCreated + stats.filesModified;

    this._checkBest('longestSession', stats.codingSeconds);
    this._checkBest('mostFiles', totalFiles);
    this._checkBest('longestStreak', stats.streak);
  }

  _checkBest(metric, currentValue) {
    const best = this.bests[metric];
    if (currentValue <= 0) return;

    // Approaching record (within 90%)
    if (best.value > 0 && currentValue > best.value * 0.9 && currentValue < best.value) {
      eventBus.emit(Events.PERSONAL_BEST_APPROACHING, {
        metric,
        label: METRICS[metric].label,
        currentValue,
        bestValue: best.value,
        formatted: {
          current: METRICS[metric].format(currentValue),
          best: METRICS[metric].format(best.value),
        },
      });
    }

    // New record
    if (currentValue > best.value) {
      const previousBest = best.value;
      const today = new Date().toISOString().slice(0, 10);

      best.value = currentValue;
      best.date = today;

      // Add to history (keep last 30 records per metric)
      this.history.push({ date: today, metric, value: currentValue });
      const metricHistory = this.history.filter(h => h.metric === metric);
      if (metricHistory.length > 30) {
        // Remove oldest entries for this metric
        const toRemove = metricHistory.length - 30;
        let removed = 0;
        this.history = this.history.filter(h => {
          if (h.metric === metric && removed < toRemove) {
            removed++;
            return false;
          }
          return true;
        });
      }

      this._save();

      // Only announce if beating a real previous record, not the first time
      if (previousBest > 0) {
        eventBus.emit(Events.PERSONAL_BEST_SET, {
          metric,
          label: METRICS[metric].label,
          previousBest,
          newBest: currentValue,
          formatted: {
            previous: METRICS[metric].format(previousBest),
            new: METRICS[metric].format(currentValue),
          },
        });
      }
    }
  }

  getBests() {
    return { ...this.bests };
  }

  getFormattedBests() {
    const result = {};
    for (const [key, def] of Object.entries(METRICS)) {
      const best = this.bests[key];
      result[key] = {
        label: def.label,
        value: best.value,
        formatted: best.value > 0 ? def.format(best.value) : '--',
        date: best.date,
      };
    }
    return result;
  }

  getHistory(metric) {
    return this.history
      .filter(h => h.metric === metric)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  getAllHistory() {
    return [...this.history].sort((a, b) => a.date.localeCompare(b.date));
  }

  getCurrentValues(stats) {
    const totalFiles = stats.filesCreated + stats.filesModified;
    return {
      longestSession: { value: stats.codingSeconds, formatted: METRICS.longestSession.format(stats.codingSeconds) },
      mostFiles: { value: totalFiles, formatted: METRICS.mostFiles.format(totalFiles) },
      longestStreak: { value: stats.streak, formatted: METRICS.longestStreak.format(stats.streak) },
      bestMomentum: { value: this._peakMomentum, formatted: METRICS.bestMomentum.format(this._peakMomentum) },
    };
  }

  destroy() {
    this._save();
    for (const unsub of this._unsubscribers) unsub();
  }
}
