// Dr. Vibe - Gentle Break Messages
// Varied, educational, never forceful

const MICRO_BREAK_MESSAGES = [
  { title: 'Quick Stretch!', body: 'Dr. Vibe suggests: Look away from the screen for 20 seconds. Your eyes will thank you!' },
  { title: 'Micro Break', body: 'Dr. Vibe says: Roll your shoulders back — tension builds up faster than you think.' },
  { title: 'Tiny Reset', body: 'Dr. Vibe tip: Blink 10 times slowly. Screen work reduces blinking by 60%!' },
  { title: 'Posture Check', body: 'Dr. Vibe reminds you: Sit up straight and unclench your jaw. Feel the difference?' },
  { title: 'Deep Breath', body: 'Dr. Vibe says: Take 3 deep breaths. Oxygen boosts focus and creativity.' },
];

const SHORT_BREAK_MESSAGES = [
  { title: 'Break Time!', body: "Dr. Vibe says: Take 5 and stretch. Short breaks boost productivity by up to 13%!" },
  { title: 'Recharge', body: 'Dr. Vibe says: Step away for a bit. Your subconscious keeps solving problems while you rest.' },
  { title: 'Break Time!', body: 'Dr. Vibe tip: Grab some water! Hydration improves concentration and reduces fatigue.' },
  { title: 'Rest Your Mind', body: "Dr. Vibe says: You've been focused — take a 5 minute walk. Movement sparks new ideas." },
  { title: 'Pause & Reset', body: 'Dr. Vibe says: Look out a window at something far away. It reduces eye strain significantly.' },
  { title: 'You Earned It', body: "Dr. Vibe says: Great session! Regular breaks prevent burnout and keep you sharp." },
];

const LONG_BREAK_MESSAGES = [
  { title: 'Long Break!', body: "Dr. Vibe says: You've done 4 solid rounds! Take 15 minutes — go for a walk or grab a snack." },
  { title: 'Extended Recharge', body: 'Dr. Vibe says: Time for a real break. Studies show 15-min breaks after deep work restore full focus.' },
  { title: 'Well Deserved Rest', body: "Dr. Vibe says: 4 cycles complete! Your brain consolidates learning during longer breaks." },
];

const IDLE_BREAK_MESSAGES = [
  { title: 'Natural Pause', body: "Dr. Vibe noticed you paused — perfect time for a quick stretch before diving back in." },
  { title: 'Good Timing', body: "Dr. Vibe says: You've naturally slowed down. That's your brain asking for a breather." },
  { title: 'Pause Detected', body: "Dr. Vibe says: Looks like a natural stopping point. How about a short break?" },
];

const WINDOW_SWITCH_MESSAGES = [
  { title: 'Taking a Break?', body: "Dr. Vibe noticed you stepped away from code. If you're taking a break, enjoy it fully!" },
  { title: 'Context Switch', body: "Dr. Vibe tip: If you're switching tasks, take 30 seconds to clear your mind first." },
];

const RETURN_MESSAGES = [
  { title: 'Welcome Back!', body: "Dr. Vibe says: Ready to roll! Let's pick up where you left off." },
  { title: 'Back in Action!', body: "Dr. Vibe says: Refreshed and ready! Break's over — let's build something great." },
  { title: 'Recharged!', body: "Dr. Vibe says: Great break! Your focus should be restored. Let's go!" },
];

function pickRandom(messages) {
  return messages[Math.floor(Math.random() * messages.length)];
}

export const BreakMessages = {
  micro: () => pickRandom(MICRO_BREAK_MESSAGES),
  short: () => pickRandom(SHORT_BREAK_MESSAGES),
  long: () => pickRandom(LONG_BREAK_MESSAGES),
  idle: () => pickRandom(IDLE_BREAK_MESSAGES),
  windowSwitch: () => pickRandom(WINDOW_SWITCH_MESSAGES),
  returnToWork: () => pickRandom(RETURN_MESSAGES),
};
