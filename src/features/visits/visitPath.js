// Dr. Vibe — where a visitor walks: in from a screen edge along the
// taskbar, to a spot beside this player's Dr. Vibe, then off the other side.
// Pure geometry in physical pixels, shared by the controller and tests.

/** Physical pixels per second; matches WalkingBehavior (~2 px/frame at 30 fps). */
export const VISITOR_WALK_SPEED = 60;
/** Gap between the two Dr. Vibes while they wave. */
const STAND_GAP = 4;

/**
 * @param {Object} g
 * @param {number} g.mainX  main window outer x
 * @param {number} g.mainY  main window outer y
 * @param {number} g.width  window width (visitor uses the same size)
 * @param {number} g.workX  work area left of the monitor Dr. Vibe is on
 * @param {number} g.workWidth
 * @returns {{ y: number, startX: number, standX: number, exitX: number, side: 'left'|'right' }}
 */
export function planVisitWalk({ mainX, mainY, width, workX, workWidth }) {
  const workRight = workX + workWidth;
  const roomLeft = mainX - workX;
  const roomRight = workRight - (mainX + width);
  // Stand on the side with more room; enter from that edge, leave by the other.
  const side = roomLeft >= roomRight ? 'left' : 'right';
  if (side === 'left') {
    return {
      y: mainY,
      side,
      startX: workX - width,
      standX: Math.max(workX, mainX - width - STAND_GAP),
      exitX: workRight,
    };
  }
  return {
    y: mainY,
    side,
    startX: workRight,
    standX: Math.min(workRight - width, mainX + width + STAND_GAP),
    exitX: workX - width,
  };
}

/** Move `x` toward `target` by at most `speed * dtMs`. */
export function stepTowards(x, target, dtMs, speed = VISITOR_WALK_SPEED) {
  const max = (speed * dtMs) / 1000;
  if (Math.abs(target - x) <= max) return target;
  return x + Math.sign(target - x) * max;
}
