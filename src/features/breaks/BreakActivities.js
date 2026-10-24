// Dr. Vibe - Mindful Break Activities
// Suggests rotating activities when breaks start, shown as speech bubble

import { eventBus, Events } from '../../core/EventBus.js';

const ACTIVITIES = [
  { text: "Try some stretches!", tip: "Stretching reduces muscle tension from sitting.", physical: true },
  { text: "Walk around for a few minutes", tip: "Even a short walk boosts creativity.", physical: true },
  { text: "Do some deep breathing", tip: "Deep breaths lower stress and sharpen focus." },
  { text: "Get some fresh air", tip: "Fresh air improves alertness and mood." },
  { text: "Make some tea or coffee", tip: "A warm drink is a nice mental reset." },
  { text: "Rest your eyes — look far away", tip: "The 20-20-20 rule helps prevent eye strain." },
  { text: "Roll your shoulders and neck", tip: "Desk posture builds up tension — release it!", physical: true },
  { text: "Grab a glass of water", tip: "Staying hydrated keeps your brain sharp." },
  { text: "Stand up and shake it out", tip: "Movement gets blood flowing back to your brain.", physical: true },
  { text: "Do a quick wrist stretch", tip: "Wrist and finger stretches prevent RSI.", physical: true },
  { text: "Step outside for a moment", tip: "Sunlight helps regulate your energy levels.", physical: true },
  { text: "Close your eyes and relax", tip: "A micro-rest recharges your attention span." },
];

export class BreakActivities {
  constructor() {
    this.recentIndices = [];
    this.recencyWindow = Math.floor(ACTIVITIES.length / 2);
    this.dismissTimer = null;
  }

  init() {
    eventBus.on(Events.BREAK_SUGGESTED, () => {
      const activity = this.pickActivity();
      eventBus.emit(Events.BREAK_ACTIVITY_SUGGESTED, activity);
    });
  }

  pickActivity() {
    const available = [];
    for (let i = 0; i < ACTIVITIES.length; i++) {
      if (!this.recentIndices.includes(i)) {
        available.push(i);
      }
    }

    const pool = available.length > 0 ? available : ACTIVITIES.map((_, i) => i);
    const chosen = pool[Math.floor(Math.random() * pool.length)];

    this.recentIndices.push(chosen);
    if (this.recentIndices.length > this.recencyWindow) {
      this.recentIndices.shift();
    }

    return { ...ACTIVITIES[chosen] };
  }
}
