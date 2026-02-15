# Dr. Vibe

**Your AI-Powered Desktop Coding Companion**

Dr. Vibe is a pixel-art desktop companion that lives on your screen while you code. He watches your activity, celebrates your wins, reminds you to take breaks, tracks your skills, and reacts to everything you do — all through expressive animations and contextual commentary.

Built with **Tauri** (Rust backend) and vanilla **JavaScript** (frontend).

---

## Table of Contents

- [Overview](#overview)
- [The Character](#the-character)
  - [Animation States](#animation-states)
  - [Idle Micro-Motions](#idle-micro-motions)
  - [Transition Effects](#transition-effects)
  - [Skins](#skins)
  - [Skin Tones](#skin-tones)
- [Sound System](#sound-system)
  - [Voice Presets](#voice-presets)
- [Activity Monitoring](#activity-monitoring)
  - [Coding Detection](#coding-detection)
  - [Recognized Coding Apps](#recognized-coding-apps)
  - [Idle Detection](#idle-detection)
  - [Momentum Tracker](#momentum-tracker)
  - [Stuck Detector](#stuck-detector)
  - [Fatigue Detector](#fatigue-detector)
  - [Project Detection](#project-detection)
- [Claude Code Integration](#claude-code-integration)
  - [Hotspot Commentary](#hotspot-commentary)
  - [Refactor Radar](#refactor-radar)
  - [Bug Squash Detector](#bug-squash-detector)
  - [AI Pair Programming](#ai-pair-programming)
  - [Session Summary](#session-summary)
- [Timer & Breaks](#timer--breaks)
  - [Pomodoro Timer](#pomodoro-timer)
  - [Break Activities](#break-activities)
  - [Focus Mode](#focus-mode)
- [Wellness Reminders](#wellness-reminders)
  - [Hydration](#hydration)
  - [Eye Strain (20-20-20 Rule)](#eye-strain-20-20-20-rule)
  - [Posture](#posture)
  - [Work-Life Boundaries](#work-life-boundaries)
  - [Overwork Prevention](#overwork-prevention)
- [Tracking & Stats](#tracking--stats)
  - [Session Tracker](#session-tracker)
  - [Skill Tracker](#skill-tracker)
  - [Personal Bests](#personal-bests)
  - [Daily Streaks](#daily-streaks)
  - [Weekly Summary](#weekly-summary)
- [Achievement System](#achievement-system)
- [Encouragement & Celebration](#encouragement--celebration)
- [Learning Resources](#learning-resources)
- [Resume Suggestions](#resume-suggestions)
- [UI Panels & Windows](#ui-panels--windows)
- [Settings Reference](#settings-reference)
  - [Timer & Break Settings](#timer--break-settings)
  - [Wellness Settings](#wellness-settings)
  - [Character & Presentation](#character--presentation)
  - [Audio Settings](#audio-settings)
  - [Feature Toggles](#feature-toggles)
  - [Notification Controls](#notification-controls)
  - [Display Settings](#display-settings)
  - [Focus Mode Settings](#focus-mode-settings)
- [Desktop Integration](#desktop-integration)
  - [Window Behavior](#window-behavior)
  - [Click-Through Ghost Mode](#click-through-ghost-mode)
  - [Walking Behavior](#walking-behavior)
  - [Quit Flow](#quit-flow)
- [Architecture](#architecture)
  - [Project Structure](#project-structure)
  - [Event Bus](#event-bus)
  - [Event Reference](#event-reference)
- [Development](#development)

---

## Overview

Dr. Vibe is a 128x128 pixel character (32x32 sprites rendered at 4x scale) that sits on your desktop while you work. He's always on top, has no window decorations, and lives in a transparent window so he blends into your workspace.

What he does:

- **Watches what you're doing** — detects when you're coding, idle, or switching apps
- **Reacts expressively** — 16 animation states with squash/stretch physics, breathing, blinking, and random personality flourishes
- **Tracks your progress** — session time, files edited, languages used, momentum level, daily streaks
- **Celebrates your wins** — achievements, personal bests, milestones, and encouraging words
- **Keeps you healthy** — hydration reminders, eye strain breaks (20-20-20 rule), posture checks, overwork prevention
- **Integrates with Claude Code** — tracks pair programming sessions, comments on hotspot files, detects refactoring patterns
- **Speaks to you** — contextual speech bubbles with optional procedural voice synthesis
- **Is deeply customizable** — 50+ settings, 12 skins, 9 voice presets, per-feature toggles

---

## The Character

### Animation States

Dr. Vibe has **16 distinct animation states**, each with its own sprite row, frame count, and timing profile:

| State | Description | Frames | Trigger |
|-------|-------------|--------|---------|
| `idle` | Gentle breathing, relaxed stance | 3 | Default state when not coding |
| `coding` | Typing with moving arms | 4 | Active coding detected |
| `thinking` | Hand on chin, contemplative | 3 | Pauses during coding |
| `tired` | Droopy eyes, slouched | 3 | Final 5 minutes of work timer |
| `excited` | Bouncy, arms up | 4 | Good news, milestones approaching |
| `alert` | Urgent, wide-eyed | 3 | Warnings, important reminders |
| `libraryCard` | Holding up a book | 4 | Learning resource suggestion |
| `presenting` | Clipboard display | 3 | Showing stats or summaries |
| `concerned` | Worried expression | 3 | Stuck detection, fatigue warning |
| `focused` | Goggles pulled down | 2 | Focus mode active |
| `coverEyes` | Hands over eyes | 3 | Eye strain break countdown |
| `thumbsUp` | Approval gesture | 3 | Positive feedback moments |
| `celebrating` | Victory dance | 4 | Achievements, personal bests |
| `beaker` | Holding a beaker/experiment | 3 | Claude Code insights |
| `stretching` | Full body stretch | 4 | Break time, posture reminder |
| `walkRight` / `walkLeft` | Walking gait | 4 | Random idle walking behavior |

Many animations use **per-frame duration arrays** so individual frames can hold longer (e.g., holding a key pose) rather than playing at a uniform speed.

### Idle Micro-Motions

When Dr. Vibe is idle, he's never truly still. The following micro-motions run continuously:

- **Breathing** — Slow vertical oscillation with a 3-second period
- **Sway** — Gentle horizontal drift with a 5-second period
- **Blinking** — Random eye blinks every 2.5-6 seconds, each lasting 120ms
- **Flourishes** — Random personality actions at irregular intervals:
  - Looking around
  - Adjusting goggles
  - Tapping foot
  - Waving

### Transition Effects

When Dr. Vibe switches between states, a **squash-and-stretch transition** plays over 180ms:

1. **Squash** — Character compresses down
2. **Stretch** — Character elongates up
3. **Settle** — Returns to normal proportions

This gives every reaction an organic, anticipatory feel. Reaction states like `excited` and `celebrating` also queue with a 120ms anticipation pause before entering.

Each animation state has its own **squash/stretch oscillation profile** that runs continuously — breathing-like scale oscillations with unique amplitude and speed per state.

### Skins

12 character skins are available, each a full replacement spritesheet:

| Skin | Description |
|------|-------------|
| `dr-vibe-default` | Standard scientist — lab coat and goggles |
| `dr-vibe-classic` | Retro variant |
| `dr-vibe-alien` | Green alien scientist |
| `dr-vibe-arctic` | Cold-climate explorer |
| `dr-vibe-bridgemind` | Futuristic/digital variant |
| `dr-vibe-cyberpunk` | Neon-themed hacker |
| `dr-vibe-firefighter` | Emergency responder outfit |
| `dr-vibe-madscientist` | Chaotic researcher |
| `dr-vibe-pirate` | Swashbuckling scientist |
| `dr-vibe-retro80s` | 1980s vintage style |
| `dr-vibe-tuxedo` | Formal black-tie attire |
| `dr-vibe-wizard` | Magical robes and hat |

Skins are stored as PNG spritesheets in `src/assets/sprites/skins/`.

### Skin Tones

Each skin supports **palette-swapped skin tones** applied in real-time via pixel-level `getImageData()` manipulation. Available tones vary by skin but include options like:

- Default
- Dark
- Light
- Medium-Light

The system maps a base RGB palette to each tone's replacement colors, swapping pixel-by-pixel on the canvas.

---

## Sound System

Dr. Vibe features a **procedural audio engine** built on the Web Audio API. No sound files — everything is synthesized in real-time.

Two audio features (both disabled by default):

1. **State Reaction Sounds** — Short audio cues when the character changes state (silent for idle, coding, focused, and walking to avoid annoyance)
2. **Talk Sounds** — Syllable-based "chattering" when speech bubbles appear, giving Dr. Vibe a voice

### Voice Presets

9 synthesized voice styles, each with unique parameters for pitch, waveform, timing, and effects:

| Voice | Description | Base Frequency |
|-------|-------------|----------------|
| `mumble` | Warm, conversational | 350 Hz |
| `squeaky` | High-pitched, excited | 800 Hz |
| `gruff` | Deep, authoritative | 140 Hz |
| `alien` | Otherworldly, heavily modulated | 500 Hz |
| `robot` | Mechanical, precise (square waves) | 200 Hz |
| `mystic` | Mysterious with echo | 400 Hz |
| `hyper` | Fast, energetic, rapid syllables | 550 Hz |
| `retro` | 8-bit chiptune style (square waves) | 440 Hz |

Each preset controls: pitch center & range, syllable duration & gap, waveform mix (sine/triangle/square/sawtooth), lowpass filter characteristics, formant frequencies for vowel-like quality, and vibrato rate & depth.

A minimum 400ms interval between sounds prevents overlapping audio.

---

## Activity Monitoring

### Coding Detection

Dr. Vibe polls the active window via the Tauri backend to determine what you're doing. When a recognized coding application is in focus, Dr. Vibe switches to the `coding` animation state and begins tracking your session.

### Recognized Coding Apps

The following applications are detected as coding activity:

**IDEs:** VS Code, Visual Studio, Cursor, Zed, Sublime Text, IntelliJ IDEA, WebStorm, PyCharm, GoLand, Rider, CLion, DataGrip, RustRover

**Editors:** vim, nvim, neovim, Emacs

**Terminals:** Windows Terminal, Terminal, iTerm, Alacritty, Kitty, Warp, Hyper, PowerShell, cmd

This list is configurable in settings under `codingApps`.

### Idle Detection

If no activity or window changes are detected for a configurable threshold (default: 5 minutes), Dr. Vibe emits an idle event and adjusts his behavior accordingly.

### Momentum Tracker

Tracks file change frequency in real-time and maps it to a momentum level:

| Level | Threshold | Description |
|-------|-----------|-------------|
| `cold` | 0% | No recent activity |
| `warming` | 30% | Just getting started |
| `flowing` | 50% | Steady coding pace |
| `hot` | 75% | Productive surge |
| `fire` | 100% | Peak momentum |

The momentum level is displayed in the main window and used by the encouragement system.

### Stuck Detector

Heuristic detection of "spinning your wheels" patterns:

- Same file being edited repeatedly without progress
- Oscillating between files (edit A, edit B, edit A, edit B...)
- High error rate indicators

When detected, Dr. Vibe shows the `concerned` state and offers supportive messages — suggestions to step back, rubber-duck the problem, or take a break.

### Fatigue Detector

Monitors for signs of coding fatigue over long sessions:

- Declining edit frequency over time
- Extended session duration
- Increased error-like patterns

Triggers gentle break suggestions when fatigue patterns are detected.

### Project Detection

Scans the filesystem for project markers to identify what you're working on:

- `.git` directories
- `package.json` (Node.js)
- `Cargo.toml` (Rust)
- `pyproject.toml` / `setup.py` (Python)
- And other common project files

The detected project name is displayed in the main window.

---

## Claude Code Integration

Dr. Vibe has deep integration with **Claude Code** (Anthropic's CLI coding assistant). When Claude Code is active, Dr. Vibe monitors its activity through a hook-based event log system.

### How It Works

1. On app start, `install_claude_code_hooks()` sets up event log monitoring
2. A JSONL event log is written to the application data directory
3. Dr. Vibe polls for new events every 3 seconds via `readClaudeCodeEvents()`
4. On app quit, `uninstall_claude_code_hooks()` cleans up

### Hotspot Commentary

When Claude Code edits the same file repeatedly, Dr. Vibe notices and comments:

| Edits | Response |
|-------|----------|
| 3+ | Notices the file is getting attention |
| 6+ | Comments on the deep dive |
| 10+ | Jokes about the file becoming a favorite |
| 15+ | Expresses concern/amazement |
| 25+ | Peak commentary |

### Refactor Radar

Analyzes Claude Code's editing patterns and classifies the session style:

- **Research** — More reads than writes, exploring the codebase
- **Rampage** — Many files being changed rapidly
- **Surgical** — Precise, targeted edits to specific locations

### Bug Squash Detector

Recognizes fix-test-fix cycles (editing code, running tests, editing again) and counts iterations. Celebrates when the cycle resolves.

### AI Pair Programming

Detects overlapping activity between you and Claude Code — both actively working at the same time. Celebrates collaboration milestones:

| Duration | Response |
|----------|----------|
| 5 min | Notes the pairing has started |
| 15 min | Acknowledges sustained collaboration |
| 30 min | Celebrates the productive session |
| 1 hour | Major milestone celebration |
| 2 hours | Epic pairing achievement |

### Session Summary

When a Claude Code session ends, Dr. Vibe generates a natural-language wrap-up with stats about what was accomplished — files changed, patterns detected, and collaboration highlights.

---

## Timer & Breaks

### Pomodoro Timer

A configurable work/break cycle timer:

- **Work interval:** 25 minutes (configurable 1-120 min)
- **Break interval:** 5 minutes (configurable 1-60 min)
- **Long break:** Every 4 cycles (configurable 2-10), lasting 15 minutes (configurable 5-60 min)
- **Break modes:**
  - `pomodoro` — Strict timer-based intervals
  - `smart` — Adjusts based on activity patterns and idle detection
  - `manual` — User-triggered breaks only

Dr. Vibe shows the `tired` animation during the final 5 minutes of a work interval and gets `excited` when break time arrives.

### Break Activities

During breaks, Dr. Vibe suggests mindful activities:

- Stretching exercises
- Standing up and walking around
- Drinking water
- Resting your eyes
- Checking your posture
- Taking a mental break

The `stretching` animation plays during break periods.

### Focus Mode

A dedicated distraction-free work session:

- **Default duration:** 25 minutes (configurable 5-120 min)
- On-screen countdown timer
- Character shows the `focused` animation (goggles down)
- "End Focus" button to exit early
- Celebrations when a focus session completes
- Persists across app restarts

---

## Wellness Reminders

### Hydration

- **Default frequency:** Every 45 minutes (configurable 10-180 min)
- Daily water intake counter with midnight reset
- Manual logging of water intake
- Speech bubble reminders with varied messages
- Can be toggled on/off

### Eye Strain (20-20-20 Rule)

Implements the ophthalmologist-recommended 20-20-20 rule:

> Every 20 minutes, look at something 20 feet away for 20 seconds.

- **Default frequency:** Every 20 minutes
- Interactive 20-second countdown overlay
- Dr. Vibe shows the `coverEyes` animation
- Snooze button available
- Can be toggled on/off

### Posture

- **Default frequency:** Every 30 minutes (configurable 5-120 min)
- 15-second interactive countdown
- Includes rotating posture improvement tips
- Dr. Vibe shows the `stretching` animation
- Snooze button available
- Can be toggled on/off

### Work-Life Boundaries

- Monitors total daily coding hours
- Sends gentle reminders when approaching configurable work-end time
- Encourages logging off at a reasonable hour
- Can be toggled on/off

### Overwork Prevention

- Tracks continuous session length
- Warns when sessions exceed healthy durations
- Suggests mandatory breaks for extended coding marathons
- Can be toggled on/off

---

## Tracking & Stats

### Session Tracker

Real-time statistics for your current session:

- Total session time
- Active coding time
- Files created
- Files modified
- Number of edits
- Current momentum level
- Active project name
- Current daily streak

### Skill Tracker

Tracks cumulative time spent coding in each programming language (detected by file extension):

**Tracked languages:** JavaScript, TypeScript, Python, Rust, Go, Java, C++, C#, Ruby, PHP, Swift, Kotlin, and more.

**Milestones per language:**

| Hours | Achievement |
|-------|-------------|
| 1h | Getting started |
| 5h | Building familiarity |
| 10h | Growing competence |
| 25h | Solid experience |
| 50h | Deep expertise |
| 100h | Mastery level |

### Personal Bests

Tracks your all-time records:

- **Longest coding session** — Continuous time in a single session
- **Most files edited** — Files modified in one session
- **Highest momentum** — Peak momentum level sustained
- **Most productive day** — Total coding time in a calendar day

Dr. Vibe celebrates when you approach or break a personal best with the `celebrating` animation and toast notifications.

### Daily Streaks

Tracks consecutive days with coding activity:

- Automatic daily detection
- **Milestones:** 7-day, 30-day, 100-day, 365-day
- Reminders on off-days to keep the streak alive
- Recovery system for missed days
- Streak broken/recovered notifications

### Weekly Summary

Aggregated stats generated at the end of each week:

- Total hours coded
- Number of active days
- Languages worked in
- Top files by edit count
- Achievements unlocked that week
- Streak status
- Trends compared to previous week

---

## Achievement System

Dr. Vibe tracks progress toward unlockable achievements across multiple categories:

**Getting Started**
- First coding session
- First hour of coding

**Consistency**
- 7-day coding streak
- 30-day coding streak

**Productivity**
- Complete a 1-hour session
- Reach "fire" momentum level

**Languages**
- 5 hours in a single language
- 25 hours in a single language
- Polyglot — code in 3+ languages

**Focus**
- Complete a focus mode session
- Accumulate distraction-free focus hours

**Wellness**
- Log hydration daily
- Complete posture reminder countdowns

**Curiosity**
- View learning resources

**Mastery**
- Complete extended sessions
- Set personal bests

**Claude Code**
- Files created via Claude Code
- Major refactoring sessions
- Bug fix debugging cycles

Achievements show progress bars while in-progress and celebratory toasts when unlocked.

---

## Encouragement & Celebration

### Encouragement System

Dr. Vibe periodically offers words of encouragement, triggered by:

- Session milestones (15 min, 30 min, 1 hour, etc.)
- Reaching peak momentum
- Unlocking achievements
- Hitting streak milestones

**Minimum interval:** 60 minutes between encouragements (configurable 10-240 min) to avoid being annoying.

### Celebration System

Major wins trigger full celebrations:

- Character plays the `celebrating` animation
- Visual particle/confetti effects
- Screen shake
- Toast notifications
- Optional celebration sound effect

Celebrations fire for: achievements unlocked, personal bests broken, streak milestones reached, and focus sessions completed.

---

## Learning Resources

When Dr. Vibe detects you're working with a language or framework you haven't used much, he can suggest relevant learning resources:

- Tutorials and documentation links
- Reference materials
- Best practice guides

The `libraryCard` animation plays when suggesting a resource. Resources can be dismissed for the current session or permanently. This feature is **disabled by default** and can be enabled in settings.

---

## Resume Suggestions

When you return to Dr. Vibe after being away, the **Resume Suggester** can remind you what you were working on:

- Shows recently modified files from your last session
- Displays the active project context
- Helps you pick up where you left off

This feature is **enabled by default** and can be toggled in settings.

---

## UI Panels & Windows

Dr. Vibe uses multiple windows for different purposes:

### Main Window
- **Size:** 200x280px
- **Features:** Character canvas, momentum meter, project display, session context
- Transparent background, no decorations, always on top
- Draggable by clicking and dragging the character
- Skips the taskbar

### Speech Bubble
- **Size:** 200x100px
- Positioned above the character
- Shows contextual messages: encouragement, reminders, Claude Code commentary, break suggestions
- Optional procedural voice chattering

### Toast Notifications
- **Size:** 350x250px
- Position configurable (any corner or top/bottom center)
- Auto-stacking when multiple toasts queue
- Used for: achievements, personal bests, skill milestones, streak celebrations

### Settings Panel
- **Size:** 500x700px (resizable)
- **Tabs:** General, Wellness, Character, Audio, Coding, Focus, Privacy

### Session Panel
- **Size:** 380x580px (resizable)
- Current session time, coding time today, files modified, active project, momentum, streak, top language

### About Panel
- **Size:** 320x540px
- Character hero animation, tagline, version info, credits, technology stack

### Achievements Panel
- **Size:** 400x500px (resizable)
- Unlocked achievements with icons, progress bars for in-progress items

### Skills Panel
- **Size:** 400x480px (resizable)
- Time per language, milestone progress, polyglot count

### Personal Bests Panel
- **Size:** 400x500px (resizable)
- Records for longest session, most files, highest momentum, most productive day

### Weekly Summary Panel
- **Size:** 420x560px (resizable)
- Weekly hours, active days, languages, achievements, trends vs. last week

### Today's Wins (Quit Flow)
- **Size:** 360x400px
- Shows today's accomplishments when you try to quit
- Encouragement message, option to continue or confirm quit

### Dashboard
- Live dashboard view of all stats and activity

---

## Settings Reference

### Timer & Break Settings

| Setting | Range | Default | Description |
|---------|-------|---------|-------------|
| `workInterval` | 1-120 min | 25 | Work session duration |
| `breakInterval` | 1-60 min | 5 | Short break duration |
| `longBreakInterval` | 2-10 cycles | 4 | Cycles before long break |
| `longBreakMinutes` | 5-60 min | 15 | Long break duration |
| `breakMode` | pomodoro / smart / manual | pomodoro | Break scheduling strategy |
| `idleThresholdMinutes` | 1-60 min | 5 | Minutes before idle detection |

### Wellness Settings

| Setting | Range | Default | Description |
|---------|-------|---------|-------------|
| `hydrationEnabled` | on/off | on | Enable hydration reminders |
| `hydrationFrequency` | 10-180 min | 45 | Minutes between reminders |
| `eyeStrainEnabled` | on/off | on | Enable 20-20-20 eye break reminders |
| `postureReminderEnabled` | on/off | on | Enable posture check reminders |
| `postureFrequency` | 5-120 min | 30 | Minutes between posture checks |
| `boundaryAwarenessEnabled` | on/off | on | Enable work-life balance reminders |

### Character & Presentation

| Setting | Options | Default | Description |
|---------|---------|---------|-------------|
| `selectedSkin` | 12 skins | dr-vibe-default | Character skin |
| `selectedSkinTone` | varies by skin | medium-light | Skin tone palette |
| `clickThroughGhostEnabled` | on/off | on | Enable click-through transparency |
| `walkingEnabled` | on/off | on | Allow idle walking behavior |
| `walkingBoundLeftPercent` | 0-45% | 0 | Left walking boundary |
| `walkingBoundRightPercent` | 0-45% | 0 | Right walking boundary |

### Audio Settings

| Setting | Range | Default | Description |
|---------|-------|---------|-------------|
| `soundReactionsEnabled` | on/off | off | Play sounds on state changes |
| `soundTalkEnabled` | on/off | off | Play voice chattering on speech |
| `soundVolume` | 0-100 | 50 | Global volume level |
| `soundTalkVoice` | 9 presets | mumble | Voice synthesis preset |

### Feature Toggles

| Setting | Default | Description |
|---------|---------|-------------|
| `notificationsEnabled` | on | System notifications |
| `encouragementEnabled` | on | Periodic encouragement messages |
| `encouragementFrequency` | 60 min | Minimum minutes between encouragements |
| `fatigueDetectionEnabled` | on | Detect coding fatigue |
| `stuckDetectionEnabled` | on | Detect "stuck" patterns |
| `overworkPreventionEnabled` | on | Warn on excessive sessions |
| `learningResourcesEnabled` | off | Suggest learning resources |
| `resumeSuggestionsEnabled` | on | Show resume context on return |

### Notification Controls

Per-category notification toggles (all default to on):

| Setting | Controls |
|---------|----------|
| `notifyBreaks` | Break time notifications |
| `notifyHydration` | Hydration reminders |
| `notifyPosture` | Posture check reminders |
| `notifyEyeStrain` | Eye strain break reminders |
| `notifyFatigue` | Fatigue detection alerts |
| `notifyStuck` | Stuck detection messages |
| `notifyOverwork` | Overwork warnings |
| `notifyAchievements` | Achievement unlocked toasts |
| `notifyBoundary` | Work-life boundary reminders |

### Display Settings

| Setting | Options | Default | Description |
|---------|---------|---------|-------------|
| `notificationPosition` | bottom-right, top-right, top-left, bottom-left, top-center, bottom-center | bottom-right | Toast notification position |
| `popupDuration` | 3-60 sec | 20 | How long popups stay visible |

### Focus Mode Settings

| Setting | Range | Default | Description |
|---------|-------|---------|-------------|
| `focusModeDuration` | 5-120 min | 25 | Focus session length |
| `focusModeEndTime` | timestamp | null | Persists focus across restarts |

---

## Desktop Integration

### Window Behavior

- **Always on top** — Dr. Vibe floats above all other windows
- **Transparent background** — Only the character and UI elements are visible
- **No decorations** — No title bar, borders, or window chrome
- **Skips taskbar** — Doesn't clutter your taskbar
- **Draggable** — Click and drag the character to reposition
- **Position persistence** — Remembers where you placed him between sessions

### Click-Through Ghost Mode

When enabled (default), clicking on transparent areas of Dr. Vibe's window passes the click through to whatever is underneath. Only the character sprite and UI elements capture clicks. This lets Dr. Vibe sit on top of your code without blocking interaction.

### Walking Behavior

When idle, Dr. Vibe can randomly walk left and right across a portion of your screen using the `walkLeft` and `walkRight` animations. Walking boundaries can be configured as a percentage of screen width to keep him within a certain area. Walking is enabled by default.

### Quit Flow

When you close Dr. Vibe, instead of immediately exiting, a **Today's Wins** panel appears showing:

- Summary of today's accomplishments
- Time coded, files edited, achievements earned
- An encouraging sign-off message
- Options to continue working or confirm quit

This prevents accidental exits and ends each session on a positive note.

---

## Architecture

### Project Structure

```
dr-vibe/
├── src/
│   ├── core/                         # Core systems
│   │   ├── EventBus.js               # Pub/sub event system
│   │   ├── TauriBridge.js            # Tauri API wrapper
│   │   ├── GameLoop.js               # RAF animation loop
│   │   └── Database.js               # Unified persistence
│   ├── features/                     # Feature modules
│   │   ├── character/                # Animation & reactions
│   │   │   ├── SpriteAnimator.js     # Sprite rendering engine
│   │   │   ├── Character.js          # State machine
│   │   │   ├── CharacterReactions.js # Activity-to-state mapping
│   │   │   └── WalkingBehavior.js    # Idle walking
│   │   ├── activity/                 # Activity monitoring
│   │   │   ├── ActivityMonitor.js    # Window polling
│   │   │   ├── ClaudeCodeTracker.js  # Claude Code integration
│   │   │   ├── AIPairTracker.js      # Pair programming detection
│   │   │   ├── ProjectDetector.js    # Project scanning
│   │   │   ├── MomentumTracker.js    # Productivity meter
│   │   │   ├── StuckDetector.js      # Stuck pattern detection
│   │   │   ├── SessionContext.js     # Active file tracking
│   │   │   └── FileSystemScanner.js  # File discovery
│   │   ├── timer/                    # Work/break timing
│   │   │   ├── Timer.js              # Pomodoro timer
│   │   │   ├── TimerUI.js            # Timer display
│   │   │   └── BreakScheduler.js     # Break coordination
│   │   ├── session/                  # Session tracking
│   │   │   ├── SessionTracker.js     # Real-time stats
│   │   │   ├── FatigueDetector.js    # Fatigue detection
│   │   │   ├── OverworkPrevention.js # Hour limits
│   │   │   └── WeeklySummary.js      # Weekly aggregation
│   │   ├── achievements/             # Achievement system
│   │   │   ├── AchievementSystem.js  # Tracking & unlocking
│   │   │   └── AchievementDefinitions.js
│   │   ├── skills/                   # Language tracking
│   │   │   └── SkillTracker.js
│   │   ├── personalBest/             # Record tracking
│   │   │   └── PersonalBestTracker.js
│   │   ├── streak/                   # Daily streaks
│   │   │   └── DailyStreakTracker.js
│   │   ├── sound/                    # Procedural audio
│   │   │   └── SoundManager.js
│   │   ├── hydration/                # Water reminders
│   │   ├── eyestrain/                # 20-20-20 breaks
│   │   ├── posture/                  # Posture checks
│   │   ├── encouragement/            # Celebrations
│   │   ├── learning/                 # Resource suggestions
│   │   ├── focus/                    # Focus mode
│   │   ├── clickthrough/             # Ghost mode
│   │   ├── boundaries/               # Work-life balance
│   │   ├── notifications/            # System notifications
│   │   ├── breaks/                   # Break activities
│   │   └── resume/                   # Resume suggestions
│   ├── ui/                           # UI panels & components
│   ├── config/                       # Configuration
│   │   ├── animations.js             # Animation definitions
│   │   ├── skinTones.js              # Skin tone palettes
│   │   └── learningResources.json    # Resource database
│   ├── app.js                        # Main orchestrator
│   └── *.html                        # Window HTML files
├── src-tauri/                        # Rust backend
│   ├── src/main.rs                   # Tauri commands
│   ├── tauri.conf.json               # App configuration
│   └── capabilities/                 # Security permissions
└── tools/
    └── generate-spritesheet.cjs      # Sprite generation tool
```

### Event Bus

All modules communicate through a centralized **EventBus** using a publish/subscribe pattern. No module directly calls another — they emit events and listen for events. This keeps the codebase modular and decoupled.

```
ActivityMonitor  --emits-->  ACTIVITY_CODING_START
    CharacterReactions  --listens-->  changes character to "coding" state
    SessionTracker      --listens-->  starts tracking time
    MomentumTracker     --listens-->  begins measuring edit frequency
```

### Event Reference

The event system defines **80+ named events** across these categories:

**App Lifecycle:** `APP_READY`, `APP_FOCUS`, `APP_BLUR`, `APP_QUIT_REQUESTED`

**Timer:** `TIMER_TICK`, `TIMER_PROGRESS`, `TIMER_WORK_COMPLETE`, `TIMER_BREAK_COMPLETE`, `TIMER_BREAK_START`, `TIMER_SPEECH`, `TIMER_PAUSED`, `TIMER_RESUMED`

**Activity:** `ACTIVITY_CHANGED`, `ACTIVITY_CODING_START`, `ACTIVITY_CODING_STOP`, `ACTIVITY_IDLE`, `ACTIVITY_WINDOW_SWITCH`

**Character:** `CHARACTER_STATE_CHANGED`, `CHARACTER_ANIMATION_START`, `CHARACTER_ANIMATION_COMPLETE`

**Project:** `PROJECT_CHANGED`, `PROJECT_DETECTED`, `PROJECT_LOST`

**Claude Code:** `CLAUDE_CODE_SESSION_START`, `CLAUDE_CODE_SESSION_END`, `CLAUDE_CODE_FILE_CHANGED`, `CLAUDE_CODE_HOTSPOT`, `CLAUDE_CODE_PATTERN`, `CLAUDE_CODE_FILE_CREATED`, `CLAUDE_CODE_FIX_CYCLE`, `CLAUDE_CODE_BUG_FIXED`, `CLAUDE_CODE_INSIGHT`, `CLAUDE_CODE_SUMMARY`, `AI_PAIR_MILESTONE`, `AI_PAIR_STARTED`, `AI_PAIR_ENDED`

**Wellness:** `HYDRATION_REMINDER`, `HYDRATION_LOGGED`, `HYDRATION_DAILY_RESET`, `EYE_STRAIN_REMINDER`, `EYE_STRAIN_COUNTDOWN`, `EYE_STRAIN_COMPLETE`, `EYE_STRAIN_SNOOZED`, `POSTURE_REMINDER`, `POSTURE_COUNTDOWN`, `POSTURE_COMPLETE`, `POSTURE_SNOOZED`, `BOUNDARY_REMINDER_SENT`

**Tracking:** `SESSION_STATS_UPDATED`, `SKILL_UPDATED`, `SKILL_MILESTONE`, `PERSONAL_BEST_SET`, `PERSONAL_BEST_APPROACHING`, `STREAK_UPDATED`, `STREAK_MILESTONE`, `STREAK_REMINDER`, `STREAK_BROKEN`, `STREAK_RECOVERED`, `WEEKLY_SUMMARY_AVAILABLE`

**Achievements:** `ACHIEVEMENT_UNLOCKED`, `ACHIEVEMENT_PROGRESS`

**Encouragement:** `ENCOURAGEMENT_TRIGGERED`, `CELEBRATION_TRIGGERED`

**Detection:** `STUCK_DETECTED`, `FATIGUE_DETECTED`, `OVERWORK_WARNING`

**Focus:** `FOCUS_MODE_STARTED`, `FOCUS_MODE_ENDED`, `FOCUS_MODE_TICK`

**UI:** `WINDOW_DRAG_START`, `WINDOW_DRAG_END`, `WALKING_STARTED`, `WALKING_STOPPED`, `SETTINGS_CHANGED`, `SETTINGS_LOADED`, plus `*_PANEL_TOGGLE`, `*_PANEL_OPENED`, `*_PANEL_CLOSED` for each panel

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) 1.70+
- [Tauri CLI](https://tauri.app/) 2.0+

### Setup

```bash
# Install dependencies
cd dr-vibe
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

### Spritesheet Generation

A tool is provided for generating spritesheets from individual frame images:

```bash
node tools/generate-spritesheet.cjs
```

### Tech Stack

- **Frontend:** Vanilla JavaScript (no framework), HTML5 Canvas, Web Audio API
- **Backend:** Tauri 2.0 (Rust) with native window management
- **Persistence:** Local unified database (no external database required)
- **Audio:** Entirely procedural — no sound files shipped
- **Graphics:** Pixel art spritesheets (32x32) with runtime palette swapping

---

## License

MIT
