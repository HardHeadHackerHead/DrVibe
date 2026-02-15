# Dr. Vibe - Character State Reference

This document describes every animation state Dr. Vibe can enter and exactly what triggers each one.

---

## State Machine Fundamentals

Dr. Vibe has a **contextual state** that tracks what the user is doing right now: either `coding` or `idle`. When temporary states (like `excited`) finish, the character reverts back to this contextual state automatically.

There are two ways a state change happens:

- **`setState`** — Checks transition restrictions before changing. If the current state is not in the `allowedFrom` list for the target state, the transition is rejected.
- **`forceState`** — Bypasses all restrictions. Always succeeds.

All state changes are suppressed during **Focus Mode**, except focus mode's own start/end transitions.

---

## Animation States (16 total)

### idle

| | |
|---|---|
| **Frames** | 3 at 300ms each |
| **Behavior** | Loop (plays forever) |
| **Visual** | Default resting pose |

**Triggered by:**

| Trigger | Source | Method |
|---|---|---|
| App startup | `Character.init()` | forceState |
| Break complete | `TIMER_BREAK_COMPLETE` | setState |
| Auto-revert from `thinking` | After 120s timeout | setState (to idle specifically) |
| Contextual revert when not coding | Auto-revert from any `autoRevert` state | setState |

---

### coding

| | |
|---|---|
| **Frames** | 4 at 200ms each |
| **Behavior** | Loop |
| **Visual** | Typing/working animation |

**Triggered by:**

| Trigger | Source | Method |
|---|---|---|
| IDE/coding app detected as active window | `ACTIVITY_CODING_START` | setState |
| Timer resumed while actively coding | `TIMER_RESUMED` (if `isCoding` is true) | setState |
| Contextual revert while coding | Auto-revert from any `autoRevert` state | setState |

---

### thinking

| | |
|---|---|
| **Frames** | 3 at 400ms each |
| **Behavior** | Timeout to idle after 120 seconds |
| **Visual** | Pondering/contemplating |
| **Restriction** | Can only be entered from: `idle`, `coding`, `excited`, `libraryCard`, `celebrating`, `tired` |

**Triggered by:**

| Trigger | Source | Method |
|---|---|---|
| User leaves coding app | `ACTIVITY_CODING_STOP` | setState |
| User inactive for 5+ minutes | `ACTIVITY_IDLE` (skipped during breaks) | setState |
| Timer has 5-10 min remaining and user is not coding | `TIMER_PROGRESS` | setState |
| Momentum drops to `cold` while coding | `MOMENTUM_LEVEL_CHANGED` (from non-cold to cold) | setState |

Because this uses `setState`, the transition restriction applies. If the character is currently in `stretching`, `alert`, `beaker`, `coverEyes`, `concerned`, `focused`, `presenting`, or `thumbsUp`, the transition to `thinking` will be rejected.

---

### tired

| | |
|---|---|
| **Frames** | 3 at 500ms each |
| **Behavior** | Loop |
| **Visual** | Fatigued appearance |

**Triggered by:**

| Trigger | Source | Method |
|---|---|---|
| Timer has 5 minutes or less remaining | `TIMER_PROGRESS` (remainingMin <= 5) | setState |
| Overwork warning at moderate level (6+ hours) | `OVERWORK_WARNING` with `characterState: 'tired'` | forceState |
| Overwork warning at strong level (8+ hours) | `OVERWORK_WARNING` with `characterState: 'tired'` | forceState |

---

### excited

| | |
|---|---|
| **Frames** | 4 at 150ms each |
| **Behavior** | Auto-revert to contextual state after 3 seconds |
| **Visual** | Happy/energetic reaction |

**Triggered by:**

| Trigger | Source | Method |
|---|---|---|
| Break starts (2 second delay after work-complete) | `TIMER_BREAK_START` | forceState |
| Project switch detected | `PROJECT_CHANGED` (only if there was a previous project) | forceState |
| Momentum reaches `hot` or `fire` while coding | `MOMENTUM_LEVEL_CHANGED` | forceState |
| Water intake logged | `HYDRATION_LOGGED` | forceState |
| Eye strain countdown completed | `EYE_STRAIN_COMPLETE` | forceState |
| Posture countdown completed | `POSTURE_COMPLETE` | forceState |
| New personal best set | `PERSONAL_BEST_SET` | forceState |
| Streak recovered after break | `STREAK_RECOVERED` | forceState |

---

### alert

| | |
|---|---|
| **Frames** | 3 at 250ms each |
| **Behavior** | Loop |
| **Visual** | Warning/attention-getting pose |

**Triggered by:**

| Trigger | Source | Method |
|---|---|---|
| Work session timer completes | `TIMER_WORK_COMPLETE` | setState |
| Break suggested | `BREAK_SUGGESTED` | setState |
| Personal best approaching (>90% of record) | `PERSONAL_BEST_APPROACHING` (skipped if already `excited`) | forceState |
| Streak reminder (9 PM, no coding yet today) | `STREAK_REMINDER` (reverts to contextual after 3s) | forceState |

Note: `TIMER_PROGRESS` explicitly skips its state changes if the current state is `alert`, so alert won't be overridden by the tired/thinking timer thresholds.

---

### focused

| | |
|---|---|
| **Frames** | 2 at 600ms each |
| **Behavior** | Loop |
| **Visual** | Goggles down, deep concentration |

**Triggered by:**

| Trigger | Source | Method |
|---|---|---|
| User activates Focus Mode | `FOCUS_MODE_STARTED` | forceState |

Focus Mode also sets `suppressed = true`, which blocks all other state changes until focus mode ends.

---

### stretching

| | |
|---|---|
| **Frames** | 4 at 300ms each |
| **Behavior** | Loop |
| **Visual** | Stretching/exercise pose |

**Triggered by:**

| Trigger | Source | Method |
|---|---|---|
| Posture reminder fires | `POSTURE_REMINDER` (every 30 min by default) | forceState |
| Physical break activity suggested | `BREAK_ACTIVITY_SUGGESTED` (if `activity.physical` is true) | forceState |

---

### beaker

| | |
|---|---|
| **Frames** | 3 at 350ms each |
| **Behavior** | Auto-revert to contextual state after 5 seconds |
| **Visual** | Holding a water beaker |

**Triggered by:**

| Trigger | Source | Method |
|---|---|---|
| Hydration reminder fires | `HYDRATION_REMINDER` (every 45 min by default) | forceState |

---

### coverEyes

| | |
|---|---|
| **Frames** | 3 at 400ms each |
| **Behavior** | Loop |
| **Visual** | Eyes covered for rest |

**Triggered by:**

| Trigger | Source | Method |
|---|---|---|
| Eye strain reminder fires (20-20-20 rule) | `EYE_STRAIN_REMINDER` (every 20 min by default) | forceState |

Loops during the entire 20-second countdown. When countdown completes, `EYE_STRAIN_COMPLETE` triggers `excited`.

---

### thumbsUp

| | |
|---|---|
| **Frames** | 3 at 300ms each |
| **Behavior** | Auto-revert to contextual state after 5 seconds |
| **Visual** | Thumbs up gesture |

**Triggered by:**

| Trigger | Source | Method |
|---|---|---|
| User opens Today's Wins panel | `TODAY_WINS_SHOW` | forceState |

---

### celebrating

| | |
|---|---|
| **Frames** | 4 at 150ms each |
| **Behavior** | Auto-revert to contextual state after 2 seconds |
| **Visual** | Full jumping celebration |

**Triggered by:**

| Trigger | Source | Method |
|---|---|---|
| Streak milestone reached (7, 14, 21, 30, 50, 100, 200, 365 days) | `STREAK_MILESTONE` | forceState |
| Session milestone (1st file, 5th file, 10th file, 50th file, 1hr coding) | `CELEBRATION_TRIGGERED` | forceState |

---

### presenting

| | |
|---|---|
| **Frames** | 3 at 350ms each |
| **Behavior** | One-shot (plays once, then stops on last frame) |
| **Visual** | Holding a clipboard |

**Triggered by:**

| Trigger | Source | Method |
|---|---|---|
| Weekly summary generated (Sunday) | `WEEKLY_SUMMARY_AVAILABLE` | forceState |

When the user closes the summary panel, `WEEKLY_SUMMARY_PANEL_CLOSED` reverts to contextual state.

---

### concerned

| | |
|---|---|
| **Frames** | 3 at 400ms each |
| **Behavior** | Loop |
| **Visual** | Empathetic worry expression |

**Triggered by:**

| Trigger | Source | Method |
|---|---|---|
| Fatigue detected (2+ of 4 indicators) | `FATIGUE_DETECTED` | forceState |
| Stuck detected (2+ of 4 indicators) | `STUCK_DETECTED` | forceState |
| Overwork warning at gentle level (4+ hours) | `OVERWORK_WARNING` with `characterState: 'concerned'` | forceState |

---

### libraryCard

| | |
|---|---|
| **Frames** | 4 at 250ms each |
| **Behavior** | Auto-revert to contextual state after 5 seconds |
| **Visual** | Reading a gold book |

**Triggered by:**

No direct trigger found in `CharacterReactions`. This state exists in the animation config and can be triggered manually via `triggerState('libraryCard')` from UI code or other modules (e.g., learning resource suggestions).

---

## Auto-Revert Behavior Summary

| State | Duration | Reverts To |
|---|---|---|
| `excited` | 3 seconds | contextual (`coding` or `idle`) |
| `beaker` | 5 seconds | contextual |
| `thumbsUp` | 5 seconds | contextual |
| `libraryCard` | 5 seconds | contextual |
| `celebrating` | 2 seconds | contextual |
| `thinking` | 120 seconds | `idle` (always idle, not contextual) |

---

## Suppression (Focus Mode)

When Focus Mode is active:

1. `suppressed` is set to `true`
2. Character is forced into `focused` state
3. Every event handler in `CharacterReactions` checks `if (this.suppressed) return` before acting
4. No other state changes can occur until `FOCUS_MODE_ENDED`
5. On end, `suppressed` is set to `false` and character reverts to contextual state

---

## Detection Systems That Trigger States

### Fatigue Detection (triggers `concerned`)
Requires 2 or more of:
1. Momentum declining (first-half average 30%+ higher than second-half)
2. Context switching (6+ window switches in 10 minutes)
3. Idle frequency (2+ idle events in 10 minutes)
4. Momentum floor (sustained low momentum after a peak)

Cooldown: 30 minutes. Minimum session: 30 minutes.

### Stuck Detection (triggers `concerned`)
Requires 2 or more of:
1. Repetitive edits (30+ edits to same file in 60 minutes)
2. Sustained low momentum (30+ minutes in cold/warming)
3. No new files (60+ minutes without creating files)
4. Search switching (8+ browser/docs switches in 10 minutes)

Cooldown: 30 minutes. Minimum session: 20 minutes. Thresholds adapt based on user dismissal rate.

### Overwork Prevention (triggers `concerned` or `tired`)
| Daily Coding Hours | Level | State |
|---|---|---|
| 4+ hours | gentle | `concerned` |
| 6+ hours | moderate | `tired` |
| 8+ hours | strong | `tired` |

Checks every 60 seconds. 30-minute cooldown per level. Resets at midnight.

### Momentum Tracking (triggers `excited` or `thinking`)
| Level | Threshold | State |
|---|---|---|
| `fire` or `hot` | >80% momentum | `excited` |
| `cold` (drop from higher) | <20% momentum | `thinking` |

Only triggers while actively coding. Won't override `alert` or `tired`.

---

## Event Flow Diagram

```
[Feature Module] --emits event--> [EventBus] --delivers--> [CharacterReactions]
                                                                    |
                                                           setState / forceState
                                                                    |
                                                              [Character]
                                                                    |
                                                         transition check
                                                                    |
                                                           [SpriteAnimator]
                                                                    |
                                                              [GameLoop]
                                                                    |
                                                          render to canvas
```
