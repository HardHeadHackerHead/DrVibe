// Dr. Vibe - Posture Reminder Messages
// Gentle, educational, never preachy

const REMINDER_MESSAGES = [
  { title: 'Posture Check!', body: 'Dr. Vibe says: Sit up tall, shoulders back. A quick adjustment goes a long way!' },
  { title: 'Straighten Up!', body: 'Dr. Vibe tip: Good posture reduces back pain by up to 40%. Roll those shoulders back!' },
  { title: 'Spine Check', body: 'Dr. Vibe says: Imagine a string pulling the top of your head toward the ceiling. Feel the difference?' },
  { title: 'Posture Reset', body: 'Dr. Vibe tip: Slouching compresses your lungs by 30%. Sit up and breathe deeper!' },
  { title: 'Body Scan', body: 'Dr. Vibe says: Unclench your jaw, drop your shoulders, straighten your back. Tension sneaks up!' },
  { title: 'Sit Tall!', body: 'Dr. Vibe tip: Your head weighs about 11 lbs. When you lean forward, your neck feels 50 lbs. Sit back!' },
  { title: 'Ergonomic Moment', body: 'Dr. Vibe says: Feet flat, back supported, screen at eye level. Quick check!' },
  { title: 'Posture Matters', body: 'Dr. Vibe tip: Good posture boosts confidence and energy. Give yourself a quick alignment check.' },
];

const COMPLETION_MESSAGES = [
  'Great posture check — your back thanks you!',
  'Posture reset complete!',
  'Looking tall and feeling good!',
  'Your spine appreciates that.',
  'Good posture is a superpower!',
];

const SNOOZE_MESSAGES = [
  'No worries, I\'ll check back later.',
  'Okay, but remember your posture!',
  'Snoozed — I\'ll remind you again soon.',
];

const ERGONOMIC_TIPS = [
  'Keep your monitor at arm\'s length, top of screen at eye level.',
  'Your elbows should rest at 90 degrees when typing.',
  'Take micro-breaks every 30 minutes — even 10 seconds helps.',
  'A lumbar support pillow can reduce lower back strain by 50%.',
  'Keep your wrists neutral — not bent up or down — when typing.',
  'Your feet should be flat on the floor or on a footrest.',
  'Avoid crossing your legs — it twists your pelvis and spine.',
  'Position your keyboard so your forearms are parallel to the floor.',
];

function pickRandom(messages) {
  return messages[Math.floor(Math.random() * messages.length)];
}

export const PostureMessages = {
  reminder: () => pickRandom(REMINDER_MESSAGES),
  completion: () => pickRandom(COMPLETION_MESSAGES),
  snooze: () => pickRandom(SNOOZE_MESSAGES),
  tip: () => pickRandom(ERGONOMIC_TIPS),
};
