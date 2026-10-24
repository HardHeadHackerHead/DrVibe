// Dr. Vibe - Eye Strain Prevention Messages (20-20-20 Rule)
// Varied, educational, encouraging

const REMINDER_MESSAGES = [
  { title: 'Eye Break Time!', body: 'Dr. Vibe says: Look at something 20 feet away for 20 seconds. Your eyes need a focus reset!' },
  { title: 'Rest Your Eyes', body: 'Dr. Vibe tip: Staring at screens reduces blinking by 60%. Look away and let your eyes recover.' },
  { title: '20-20-20 Check', body: 'Dr. Vibe says: Every 20 minutes, 20 feet away, 20 seconds. Simple rule, big difference!' },
  { title: 'Focus Shift', body: 'Dr. Vibe tip: Your ciliary muscles tense up during close screen work. Give them a stretch — look far away!' },
  { title: 'Eye Health Break', body: 'Dr. Vibe says: Digital eye strain affects 65% of people. A 20-second break can prevent it.' },
  { title: 'Look Away!', body: 'Dr. Vibe tip: Your eyes aren\'t designed for hours of close-up focus. A quick distance gaze helps reset them.' },
  { title: 'Vision Reset', body: 'Dr. Vibe says: Looking at distant objects relaxes your eye muscles and reduces fatigue. Try it now!' },
  { title: 'Blink Break', body: 'Dr. Vibe tip: We blink 66% less when using screens. Look away, blink naturally, and let your eyes rehydrate.' },
];

const COMPLETION_MESSAGES = [
  'Great job — your eyes thank you!',
  'Vision reset complete!',
  'Eyes refreshed and ready to code!',
  'Your future self appreciates that.',
  'Eye care is self care!',
];

const SNOOZE_MESSAGES = [
  'No worries, I\'ll remind you again soon.',
  'Okay, but don\'t forget your eyes!',
  'Snoozed — I\'ll check back in 20.',
];

function pickRandom(messages) {
  return messages[Math.floor(Math.random() * messages.length)];
}

export const EyeStrainMessages = {
  reminder: () => pickRandom(REMINDER_MESSAGES),
  completion: () => pickRandom(COMPLETION_MESSAGES),
  snooze: () => pickRandom(SNOOZE_MESSAGES),
};
