// Dr. Vibe - Achievement Definitions
// Registry of all available achievements with metadata and unlock conditions.

export const ACHIEVEMENTS = {
  welcome_dr_vibe: {
    id: 'welcome_dr_vibe',
    title: 'Welcome to Dr. Vibe',
    description: 'Launch Dr. Vibe for the first time',
    icon: '&#x1F44B;',
    category: 'milestone',
    maxProgress: 1,
  },

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

  // Ready Now pack

  flow_state: {
    id: 'flow_state',
    title: 'Flow State',
    description: 'Hit Fire momentum for the first time',
    icon: '&#x1F30A;',
    category: 'momentum',
    maxProgress: 1,
  },

  inferno_loop: {
    id: 'inferno_loop',
    title: 'Inferno Loop',
    description: 'Reach Fire momentum 25 times',
    icon: '&#x1F525;',
    category: 'momentum',
    maxProgress: 25,
  },

  deep_work: {
    id: 'deep_work',
    title: 'Deep Work',
    description: 'Code for 2+ hours in a single session',
    icon: '&#x1F9E0;',
    category: 'session',
    maxProgress: 1,
  },

  file_sculptor: {
    id: 'file_sculptor',
    title: 'File Sculptor',
    description: 'Create or modify 25 files in one session',
    icon: '&#x1F5C2;',
    category: 'session',
    maxProgress: 25,
  },

  pomodoro_pilot: {
    id: 'pomodoro_pilot',
    title: 'Pomodoro Pilot',
    description: 'Complete 10 work timers',
    icon: '&#x23F1;',
    category: 'timer',
    maxProgress: 10,
  },

  break_balancer: {
    id: 'break_balancer',
    title: 'Break Balancer',
    description: 'Complete 10 break timers',
    icon: '&#x2615;',
    category: 'timer',
    maxProgress: 10,
  },

  focus_initiate: {
    id: 'focus_initiate',
    title: 'Focus Initiate',
    description: 'Complete your first Focus Mode session',
    icon: '&#x1F3AF;',
    category: 'focus',
    maxProgress: 1,
  },

  zen_master: {
    id: 'zen_master',
    title: 'Zen Master',
    description: 'Complete 10 Focus Mode sessions',
    icon: '&#x1F9D8;',
    category: 'focus',
    maxProgress: 10,
  },

  eye_care_hero: {
    id: 'eye_care_hero',
    title: 'Eye Care Hero',
    description: 'Complete 10 eye strain breaks',
    icon: '&#x1F441;',
    category: 'wellness',
    maxProgress: 10,
  },

  posture_guardian: {
    id: 'posture_guardian',
    title: 'Posture Guardian',
    description: 'Complete 10 posture resets',
    icon: '&#x1F9CD;',
    category: 'wellness',
    maxProgress: 10,
  },

  boundary_sentinel: {
    id: 'boundary_sentinel',
    title: 'Boundary Sentinel',
    description: 'Get 10 healthy work-boundary reminders',
    icon: '&#x1F6E1;',
    category: 'wellness',
    maxProgress: 10,
  },

  streak_spark: {
    id: 'streak_spark',
    title: 'Streak Spark',
    description: 'Reach a 3-day coding streak',
    icon: '&#x2728;',
    category: 'streak',
    maxProgress: 3,
  },

  streak_legend: {
    id: 'streak_legend',
    title: 'Streak Legend',
    description: 'Reach a 30-day coding streak',
    icon: '&#x1F3C6;',
    category: 'streak',
    maxProgress: 30,
  },

  skill_collector: {
    id: 'skill_collector',
    title: 'Skill Collector',
    description: 'Track coding time in 5 different languages',
    icon: '&#x1F9F0;',
    category: 'skills',
    maxProgress: 5,
  },

  milestone_hunter: {
    id: 'milestone_hunter',
    title: 'Milestone Hunter',
    description: 'Hit 10 skill milestones',
    icon: '&#x1F3F9;',
    category: 'skills',
    maxProgress: 10,
  },

  mastery_path: {
    id: 'mastery_path',
    title: 'Mastery Path',
    description: 'Reach 25 hours in one language',
    icon: '&#x1F393;',
    category: 'skills',
    maxProgress: 1,
  },

  record_breaker: {
    id: 'record_breaker',
    title: 'Record Breaker',
    description: 'Set 5 personal bests',
    icon: '&#x1F4C8;',
    category: 'personal_best',
    maxProgress: 5,
  },

  // Community engagement pack

  community_connected: {
    id: 'community_connected',
    title: 'Connected',
    description: 'Join the Dr. Vibe community',
    icon: '&#x1F517;',
    category: 'community',
    maxProgress: 1,
  },

  gallery_debut: {
    id: 'gallery_debut',
    title: 'Gallery Debut',
    description: 'Submit your first skin to the community gallery',
    icon: '&#x1F5BC;',
    category: 'community',
    maxProgress: 1,
  },

  gallery_regular: {
    id: 'gallery_regular',
    title: 'Gallery Regular',
    description: 'Submit 5 skins to the community gallery',
    icon: '&#x1F4F8;',
    category: 'community',
    maxProgress: 5,
  },

  skin_collector: {
    id: 'skin_collector',
    title: 'Skin Collector',
    description: 'Install 5 community skins',
    icon: '&#x1F9E5;',
    category: 'community',
    maxProgress: 5,
  },

  community_catalyst: {
    id: 'community_catalyst',
    title: 'Community Catalyst',
    description: 'Connect, submit, and install at least once each',
    icon: '&#x1F91D;',
    category: 'community',
    maxProgress: 3,
  },

  // Git achievements

  first_push: {
    id: 'first_push',
    title: 'First Push',
    description: 'Make your first commit while Dr. Vibe is watching',
    icon: '&#x1F680;',
    category: 'git',
    maxProgress: 1,
  },

  rapid_fire: {
    id: 'rapid_fire',
    title: 'Rapid Fire',
    description: 'Make 5 commits in a single session',
    icon: '&#x26A1;',
    category: 'git',
    maxProgress: 5,
  },

  commit_machine: {
    id: 'commit_machine',
    title: 'Commit Machine',
    description: 'Make 50 commits (lifetime)',
    icon: '&#x2699;',
    category: 'git',
    maxProgress: 50,
  },

  version_veteran: {
    id: 'version_veteran',
    title: 'Version Veteran',
    description: 'Make 500 commits (lifetime)',
    icon: '&#x1F3C6;',
    category: 'git',
    maxProgress: 500,
  },

  daily_pusher: {
    id: 'daily_pusher',
    title: 'Daily Pusher',
    description: 'Commit at least once every day for 3 days in a row',
    icon: '&#x1F4C5;',
    category: 'git',
    maxProgress: 3,
  },

  commit_consistent: {
    id: 'commit_consistent',
    title: 'Commit Consistent',
    description: 'Commit at least once every day for 7 days in a row',
    icon: '&#x1F331;',
    category: 'git',
    maxProgress: 7,
  },

  branch_explorer: {
    id: 'branch_explorer',
    title: 'Branch Explorer',
    description: 'Switch branches 20 times',
    icon: '&#x1F333;',
    category: 'git',
    maxProgress: 20,
  },

  multi_repo: {
    id: 'multi_repo',
    title: 'Multi-Repo Dev',
    description: 'Make commits in 3 different repositories',
    icon: '&#x1F4E6;',
    category: 'git',
    maxProgress: 3,
  },

  quick_draw: {
    id: 'quick_draw',
    title: 'Quick Draw',
    description: 'Commit within 5 minutes of Dr. Vibe\'s reminder',
    icon: '&#x1F3AF;',
    category: 'git',
    maxProgress: 1,
  },

  self_disciplined: {
    id: 'self_disciplined',
    title: 'Self-Disciplined',
    description: 'Make 3+ commits in a session without Dr. Vibe ever nagging you',
    icon: '&#x1F9D8;',
    category: 'git',
    maxProgress: 1,
  },
};

export const ACHIEVEMENT_LIST = Object.values(ACHIEVEMENTS);

export const MASTERY_TRACKS = {
  timer_mastery: {
    id: 'timer_mastery',
    title: 'Timer Mastery',
    description: 'Complete focused work sessions consistently',
    icon: '&#x23F1;',
    category: 'timer',
    unit: 'work sessions',
    levels: [5, 25, 75, 150, 300],
    majorLevels: [3, 5],
  },

  skills_mastery: {
    id: 'skills_mastery',
    title: 'Skills Mastery',
    description: 'Keep stacking language milestones',
    icon: '&#x1F393;',
    category: 'skills',
    unit: 'skill milestones',
    levels: [1, 5, 15, 30, 60],
    majorLevels: [3, 5],
  },

  git_mastery: {
    id: 'git_mastery',
    title: 'Version Control Mastery',
    description: 'Build a strong, steady commit history',
    icon: '&#x1F5C3;',
    category: 'git',
    unit: 'commits',
    levels: [5, 25, 100, 250, 500],
    majorLevels: [3, 5],
  },

  wellness_mastery: {
    id: 'wellness_mastery',
    title: 'Wellness Mastery',
    description: 'Maintain healthy coding habits over time',
    icon: '&#x1FA7A;',
    category: 'wellness',
    unit: 'wellness check-ins',
    levels: [5, 25, 75, 150, 300],
    majorLevels: [3, 5],
  },

  community_mastery: {
    id: 'community_mastery',
    title: 'Community Mastery',
    description: 'Contribute and engage with the community regularly',
    icon: '&#x1F91D;',
    category: 'community',
    unit: 'community actions',
    levels: [1, 3, 8, 15, 30],
    majorLevels: [3, 5],
  },
};

export const MASTERY_TRACK_LIST = Object.values(MASTERY_TRACKS);
