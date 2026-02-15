// Dr. Vibe - Achievement Definitions
// Registry of all available achievements with metadata and unlock conditions

export const ACHIEVEMENTS = {
  hello_world: {
    id: 'hello_world',
    title: 'Hello World',
    description: 'Complete your first coding session',
    icon: '&#x1F44B;',
    category: 'milestone',
    maxProgress: 1,
  },

  night_owl: {
    id: 'night_owl',
    title: 'Night Owl',
    description: 'Code after midnight',
    icon: '&#x1F989;',
    category: 'time',
    maxProgress: 1,
  },

  early_bird: {
    id: 'early_bird',
    title: 'Early Bird',
    description: 'Code before 7am',
    icon: '&#x1F426;',
    category: 'time',
    maxProgress: 1,
  },

  marathon: {
    id: 'marathon',
    title: 'Marathon',
    description: 'Code for 4+ hours in a single session',
    icon: '&#x1F3C3;',
    category: 'endurance',
    maxProgress: 1,
  },

  dedicated: {
    id: 'dedicated',
    title: 'Dedicated',
    description: 'Maintain a 7-day coding streak',
    icon: '&#x1F525;',
    category: 'streak',
    maxProgress: 7,
  },

  polyglot: {
    id: 'polyglot',
    title: 'Polyglot',
    description: 'Use 3 or more different coding apps',
    icon: '&#x1F310;',
    category: 'variety',
    maxProgress: 3,
  },

  century: {
    id: 'century',
    title: 'Century',
    description: 'Complete 100 work sessions',
    icon: '&#x1F4AF;',
    category: 'milestone',
    maxProgress: 100,
  },

  persistent: {
    id: 'persistent',
    title: 'Persistent',
    description: 'Return to coding after 30+ minutes away',
    icon: '&#x1F4AA;',
    category: 'resilience',
    maxProgress: 1,
  },
};

export const ACHIEVEMENT_LIST = Object.values(ACHIEVEMENTS);
