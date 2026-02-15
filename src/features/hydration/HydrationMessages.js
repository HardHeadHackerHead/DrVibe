// Dr. Vibe - Gentle Hydration Reminder Messages
// Varied, encouraging, never guilt-tripping

const HYDRATION_REMINDERS = [
  { title: 'Time for Water!', body: 'Dr. Vibe says: Hydration boosts focus and energy. Grab a glass!' },
  { title: 'Water Break', body: 'Dr. Vibe tip: Even mild dehydration can reduce concentration by 25%. Drink up!' },
  { title: 'Stay Hydrated!', body: 'Dr. Vibe says: Your brain is 75% water. Keep it topped up for peak coding!' },
  { title: 'H2O Time', body: 'Dr. Vibe suggests: A glass of water now keeps the headaches away later.' },
  { title: 'Hydration Check', body: 'Dr. Vibe says: Water improves memory and mood. Take a sip!' },
  { title: 'Water Reminder', body: 'Dr. Vibe tip: Regular hydration helps prevent eye strain from screen time.' },
  { title: 'Drink Up!', body: 'Dr. Vibe says: Coding is thirsty work! Time for some water.' },
  { title: 'Quick Sip', body: 'Dr. Vibe says: Small, frequent sips beat chugging a whole bottle. Grab some water!' },
];

const LOGGED_RESPONSES = [
  'Nice! Keep it up!',
  'Great choice!',
  'Your brain thanks you!',
  'Hydration hero!',
  'Well done!',
];

function pickRandom(messages) {
  return messages[Math.floor(Math.random() * messages.length)];
}

export const HydrationMessages = {
  reminder: () => pickRandom(HYDRATION_REMINDERS),
  logged: () => pickRandom(LOGGED_RESPONSES),
};
