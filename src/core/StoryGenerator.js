// Dr. Vibe - Story Generator
// Curates a "Today's Story" — up to 6 highlight entries from the session event log.
// Called once at session end, passed to the Today's Wins window.

const MAX_ENTRIES = 6;

export class StoryGenerator {
  /**
   * @param {Array}  eventHistory - Full event log from EventHistory.getHistory()
   * @param {Object} sessionStats - Stats from SessionTracker.getStats()
   * @returns {{ entries: Array<{ icon: string, headline: string, detail: string }> }}
   */
  generate(eventHistory, sessionStats) {
    const events    = Array.isArray(eventHistory) ? eventHistory : [];
    const stats     = sessionStats || {};
    const candidates = [];

    // ── Achievements unlocked ──────────────────────────────────────────────
    const achievementEvents = events.filter(e =>
      e.category === 'achievement' && e.message.startsWith('Achievement unlocked:')
    );
    for (const ev of achievementEvents) {
      candidates.push({
        icon: '🏆', headline: ev.message, detail: ev.detail || '', priority: 100,
      });
    }

    // ── Personal bests ─────────────────────────────────────────────────────
    const pbEvents = events.filter(e =>
      e.category === 'achievement' && e.message.startsWith('New personal best:')
    );
    for (const ev of pbEvents) {
      candidates.push({
        icon: '🥇', headline: ev.message, detail: ev.detail || '', priority: 90,
      });
    }

    // ── Coding streak (7+ days is story-worthy) ────────────────────────────
    const streak = stats.streak || 0;
    if (streak >= 7) {
      const detail = streak >= 30 ? 'Absolutely legendary' :
                     streak >= 14 ? "You're unstoppable" :
                     'Keep the fire burning';
      candidates.push({ icon: '🔥', headline: `${streak}-day coding streak!`, detail, priority: 85 });
    }

    // ── Skill milestones ───────────────────────────────────────────────────
    const skillEvents = events.filter(e =>
      e.category === 'achievement' && e.icon === '⭐'
    );
    for (const ev of skillEvents) {
      candidates.push({
        icon: '⭐', headline: ev.message, detail: ev.detail || '', priority: 80,
      });
    }

    // ── Completed focus sessions ───────────────────────────────────────────
    const focusEnded = events.filter(e =>
      e.category === 'focus' && e.message === 'Focus mode ended'
    );
    if (focusEnded.length > 0) {
      const n = focusEnded.length;
      candidates.push({
        icon: '🎯',
        headline: n === 1 ? 'Completed a focus session' : `Completed ${n} focus sessions`,
        detail: 'Deep work, distraction-free',
        priority: 75,
      });
    }

    // ── Pomodoro completions ───────────────────────────────────────────────
    const timerDone = events.filter(e =>
      e.category === 'timer' && e.message === 'Work session complete — time for a break!'
    );
    if (timerDone.length > 0) {
      const n = timerDone.length;
      candidates.push({
        icon: '⏱️',
        headline: n === 1 ? 'Completed a Pomodoro session' : `Completed ${n} Pomodoro sessions`,
        detail: `${n} focused work block${n !== 1 ? 's' : ''} in the bag`,
        priority: 70,
      });
    }

    // ── AI pair programming ────────────────────────────────────────────────
    const aiPairEnded = events.filter(e =>
      e.category === 'claude' && e.message === 'AI pair programming session ended'
    );
    if (aiPairEnded.length > 0) {
      const n = aiPairEnded.length;
      candidates.push({
        icon: '👥',
        headline: 'Pair programmed with Claude',
        detail: `${n} session${n !== 1 ? 's' : ''}`,
        priority: 68,
      });
    }

    // ── Claude Code sessions ───────────────────────────────────────────────
    const claudeEnded = events.filter(e =>
      e.category === 'claude' && e.message === 'Claude Code session ended'
    );
    if (claudeEnded.length > 0) {
      let totalWritten = 0, totalRead = 0;
      for (const ev of claudeEnded) {
        const m = (ev.detail || '').match(/(\d+) written, (\d+) read/);
        if (m) { totalWritten += parseInt(m[1], 10); totalRead += parseInt(m[2], 10); }
      }
      const n = claudeEnded.length;
      const detail = (totalWritten + totalRead > 0)
        ? `${totalWritten} file${totalWritten !== 1 ? 's' : ''} written, ${totalRead} read`
        : `${n} session${n !== 1 ? 's' : ''}`;
      candidates.push({
        icon: '🤖',
        headline: n === 1 ? 'Claude Code session completed' : `${n} Claude Code sessions`,
        detail,
        priority: 65,
      });
    }

    // ── Bugs squashed ──────────────────────────────────────────────────────
    const bugFixed = events.filter(e => e.detail === 'Bug squashed!');
    if (bugFixed.length > 0) {
      const n = bugFixed.length;
      candidates.push({
        icon: '🐛',
        headline: n === 1 ? 'Squashed a bug' : `Squashed ${n} bugs`,
        detail: n >= 3 ? 'Debugging champion' : 'One less thing to worry about',
        priority: 60,
      });
    }

    // ── New files created ──────────────────────────────────────────────────
    const filesCreated = events.filter(e => e.detail === 'New file created');
    if (filesCreated.length > 0) {
      const n = filesCreated.length;
      candidates.push({
        icon: '📄',
        headline: n === 1 ? 'Created a new file' : `Created ${n} new files`,
        detail: 'Building something new',
        priority: 55,
      });
    }

    // ── Hydration ─────────────────────────────────────────────────────────
    const hydrationLogs = events.filter(e =>
      e.category === 'wellness' && e.message.startsWith('Water logged')
    );
    if (hydrationLogs.length >= 6) {
      candidates.push({
        icon: '💧',
        headline: 'Stayed hydrated all day',
        detail: `${hydrationLogs.length} glasses logged`,
        priority: 50,
      });
    } else if (hydrationLogs.length >= 3) {
      candidates.push({
        icon: '💧',
        headline: `${hydrationLogs.length} glasses of water`,
        detail: 'Keeping the brain sharp',
        priority: 45,
      });
    }

    // ── Wellness breaks ────────────────────────────────────────────────────
    const eyeBreaks  = events.filter(e => e.message === 'Eye break complete — 20-20-20 done!');
    const postureDone = events.filter(e => e.message === 'Posture check complete');
    if (eyeBreaks.length + postureDone.length >= 2) {
      const parts = [];
      if (eyeBreaks.length  > 0) parts.push(`${eyeBreaks.length} eye break${eyeBreaks.length   > 1 ? 's' : ''}`);
      if (postureDone.length > 0) parts.push(`${postureDone.length} posture check${postureDone.length > 1 ? 's' : ''}`);
      candidates.push({
        icon: '🧘',
        headline: 'Took care of your body',
        detail: parts.join(' · '),
        priority: 40,
      });
    }

    // ── Significant coding time ────────────────────────────────────────────
    const codingSeconds = stats.codingSeconds || 0;
    if (codingSeconds >= 3600) {
      candidates.push({
        icon: '💻',
        headline: `Coded for ${this._fmt(codingSeconds)}`,
        detail: codingSeconds >= 14400 ? 'Marathon session!' :
                codingSeconds >= 7200  ? 'Serious output today' :
                'Solid, focused work',
        priority: 30,
      });
    } else if (codingSeconds >= 600) {
      candidates.push({
        icon: '💻',
        headline: `${this._fmt(codingSeconds)} of coding`,
        detail: 'Every minute counts',
        priority: 20,
      });
    }

    // ── Project context ────────────────────────────────────────────────────
    if (stats.projectName) {
      candidates.push({
        icon: '📁',
        headline: `Worked on ${stats.projectName}`,
        detail: '',
        priority: 15,
      });
    }

    // ── Sort, dedupe on headline, take top MAX_ENTRIES ─────────────────────
    candidates.sort((a, b) => b.priority - a.priority);
    const seen    = new Set();
    const entries = [];
    for (const c of candidates) {
      if (!seen.has(c.headline)) {
        seen.add(c.headline);
        entries.push({ icon: c.icon, headline: c.headline, detail: c.detail });
        if (entries.length >= MAX_ENTRIES) break;
      }
    }

    return { entries };
  }

  _fmt(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
}

export const storyGenerator = new StoryGenerator();
