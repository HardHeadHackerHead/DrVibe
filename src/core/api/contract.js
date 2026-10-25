// Dr. Vibe — payload shapes of the 2.0 API (server/API.md, drvibe-protocol).
//
// Server JSON is read ONLY here and turned into the app's own shapes. The
// Rust commands already check bodies against the protocol types, so these
// parsers mostly rename fields; they stay forgiving so a contract drift
// degrades to "nothing new" instead of a crash.

const str = (v, d = null) => (typeof v === 'string' && v ? v : d);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const arr = (v) => (Array.isArray(v) ? v : []);

/** Desktop skin slug for a Lab Original slug from the server (`pirate` → `dr-vibe-pirate`). */
export function localSkinSlug(slug) {
  const s = str(slug, 'dr-vibe-default');
  if (s === 'default') return 'dr-vibe-default';
  return s.startsWith('dr-vibe-') || s.startsWith('companion-') ? s : `dr-vibe-${s}`;
}

// ── Equipped Dr. Vibe (protocol EquippedDrVibe) ──────────────────────────

/**
 * The app's shape for a collected Dr. Vibe.
 * @typedef {Object} EquippedDrVibe
 * @property {string} id         companion id
 * @property {string} slug       edition slug (cache key: `companion-<slug>`)
 * @property {string} name
 * @property {string} pngUrl     sprite sheet URL
 * @property {Object|null} animJson
 * @property {string|null} skinTone
 * @property {string|null} rarity
 */

/** @returns {EquippedDrVibe|null} */
export function parseEquipped(e) {
  if (!e || typeof e !== 'object') return null;
  const id = str(e.companionId);
  const slug = str(e.editionSlug);
  const pngUrl = str(e.spriteSheetUrl);
  if (!id || !slug || !pngUrl) return null;
  return {
    id,
    slug,
    name: str(e.name, str(e.editionName, slug)),
    pngUrl,
    animJson: e.animJson && typeof e.animJson === 'object' ? e.animJson : null,
    skinTone: str(e.skinTone),
    rarity: str(e.rarity),
  };
}

// ── GET /desktop/poll (PollResponse) ─────────────────────────────────────
//
// { account: { userId, username, displayName, avatarUrl, vibePoints, supporter, freePulls },
//   equipped: EquippedDrVibe | null, notifications: DesktopNotification[≤20], unreadCount,
//   visits: IncomingVisit[≤5], privacy: PrivacySettings }
// Notifications stay until acked (POST /desktop/ack); visits too.

/**
 * @typedef {Object} ServerNotification
 * @property {string} id
 * @property {string} type       protocol `kind` (follow, donation_thanks, visit_missed, ...)
 * @property {string} title
 * @property {string} body
 * @property {string|null} url   absolute URL on the site, or null
 * @property {boolean} celebrate
 * @property {string|null} createdAt
 */

/**
 * A visitor's look: an edition sheet to download, or a local Lab Original.
 * @typedef {Object} PlayerSprite
 * @property {string} slug
 * @property {string|null} pngUrl     null = use `localSkin`
 * @property {Object|null} animJson
 * @property {string|null} localSkin
 * @property {string|null} skinTone
 */

/**
 * @typedef {Object} IncomingVisit
 * @property {string} id
 * @property {{ id: string, username: string, displayName: string|null, avatarUrl: string|null, sprite: PlayerSprite }} from
 * @property {string|null} preset
 * @property {boolean} isWaveBack
 * @property {string|null} createdAt
 */

/**
 * @typedef {Object} PollResult
 * @property {{ userId: string, username: string, displayName: string|null, avatarUrl: string|null, vibePoints: number, freePulls: number }|null} account
 * @property {EquippedDrVibe|null|undefined} equipped  undefined = field absent (no change)
 * @property {{ slug: string, chosenAt: string }|null} labOriginal  Lab Original last chosen on the site, or null
 * @property {{ held: number, coveredDays: string[] }|null} streakFreeze  null when the server doesn't send it
 * @property {ServerNotification[]} notifications
 * @property {IncomingVisit[]} visits
 * @property {Object|null} privacy    app-shaped privacy (see parsePrivacy)
 */

function parseVisit(v) {
  if (!v || typeof v !== 'object' || !v.from) return null;
  const f = v.from;
  const username = str(f.username);
  if (!username) return null;
  const look = f.appearance || {};
  const eq = parseEquipped(look.equipped);
  const sprite = eq
    ? { slug: eq.slug, pngUrl: eq.pngUrl, animJson: eq.animJson, localSkin: null, skinTone: eq.skinTone ?? str(look.skinTone) }
    : { slug: localSkinSlug(look.fallbackSkinSlug), pngUrl: null, animJson: null, localSkin: localSkinSlug(look.fallbackSkinSlug), skinTone: str(look.skinTone) };
  return {
    id: str(v.id, `${username}-${v.createdAt}`),
    from: { id: str(f.userId, username), username, displayName: str(f.displayName), avatarUrl: str(f.avatarUrl), sprite },
    preset: str(v.preset),
    isWaveBack: !!v.isWaveBack,
    createdAt: str(v.createdAt),
  };
}

const LAB_ORIGINAL_SLUGS = new Set(['default', 'classic', 'tuxedo', 'cyberpunk', 'alien', 'pirate', 'firefighter', 'wizard', 'arctic', 'retro80s', 'bridgemind', 'madscientist']);

/** `{ slug, chosenAt }` for a bundled Lab Original; unknown slugs and missing dates are dropped. */
function parseLabOriginal(o) {
  if (!o || typeof o !== 'object') return null;
  const slug = str(o.slug);
  const chosenAt = str(o.chosenAt);
  if (!slug || !chosenAt || !LAB_ORIGINAL_SLUGS.has(slug)) return null;
  return { slug, chosenAt };
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** `{ held, coveredDays }`; absent means none held, nothing covered. */
function parseStreakFreeze(f) {
  const o = f && typeof f === 'object' ? f : {};
  return {
    held: Math.max(0, Math.floor(num(o.held))),
    coveredDays: arr(o.coveredDays).filter((d) => typeof d === 'string' && DAY_KEY.test(d)),
  };
}

/** @returns {PollResult} */
export function parsePollResponse(json, siteBase = '') {
  const j = json && typeof json === 'object' ? json : {};
  const absolute = (u) => {
    const s = str(u);
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    return s.startsWith('/') ? `${siteBase}${s}` : null;
  };
  const a = j.account && typeof j.account === 'object' ? j.account : null;
  return {
    account: a
      ? {
          userId: str(a.userId), username: str(a.username), displayName: str(a.displayName),
          avatarUrl: str(a.avatarUrl), vibePoints: num(a.vibePoints), freePulls: num(a.freePulls),
        }
      : null,
    equipped: 'equipped' in j ? parseEquipped(j.equipped) : undefined,
    labOriginal: parseLabOriginal(j.labOriginal),
    streakFreeze: a ? parseStreakFreeze(a.streakFreeze) : null,
    notifications: arr(j.notifications)
      .filter((n) => n && typeof n === 'object' && str(n.id) && str(n.message))
      .map((n) => ({
        id: n.id,
        type: str(n.kind, 'system'),
        title: NOTIFICATION_TITLES[n.kind] || 'Dr. Vibe',
        body: n.message,
        url: absolute(n.ctaUrl),
        celebrate: !!n.celebrate,
        createdAt: str(n.createdAt),
      })),
    visits: arr(j.visits).map(parseVisit).filter(Boolean),
    privacy: j.privacy ? parsePrivacy(j.privacy) : null,
  };
}

const NOTIFICATION_TITLES = {
  follow: 'New follower',
  trade_proposed: 'Trade proposal',
  trade_accepted: 'Trade accepted',
  donation_thanks: 'Thanks for supporting Dr. Vibe!',
  design_graduated: 'Your design graduated!',
  visit_missed: 'You had a visitor',
  streak_freeze: 'Streak freeze used',
  free_pull: 'Free pull waiting',
  achievement_granted: 'Achievement unlocked',
};

// ── Privacy: GET/PUT /privacy (PrivacySettings / PrivacySettingsPatch) ───

export const PRIVACY_DEFAULTS = Object.freeze({
  profileVisibility: 'public',
  showProjectNames: false,
  showOnVibeMap: false,
  appearInLeaderboards: true,
  visitsFrom: 'followers',
});

const VISIBILITY = ['public', 'followers', 'private'];
const VISITS_FROM = ['everyone', 'followers', 'nobody'];

/** Normalise any stored/partial privacy object to the app's full shape. */
export function buildPrivacyBody(p = {}) {
  return {
    profileVisibility: VISIBILITY.includes(p.profileVisibility) ? p.profileVisibility : PRIVACY_DEFAULTS.profileVisibility,
    showProjectNames: typeof p.showProjectNames === 'boolean' ? p.showProjectNames : PRIVACY_DEFAULTS.showProjectNames,
    showOnVibeMap: typeof p.showOnVibeMap === 'boolean' ? p.showOnVibeMap : PRIVACY_DEFAULTS.showOnVibeMap,
    appearInLeaderboards: typeof p.appearInLeaderboards === 'boolean' ? p.appearInLeaderboards : PRIVACY_DEFAULTS.appearInLeaderboards,
    visitsFrom: VISITS_FROM.includes(p.visitsFrom) ? p.visitsFrom : PRIVACY_DEFAULTS.visitsFrom,
  };
}

/** App privacy → `PrivacySettingsPatch` (the server calls it `whoCanVisit`). */
export function toPrivacyPatch(p) {
  const b = buildPrivacyBody(p);
  return {
    profileVisibility: b.profileVisibility,
    showProjectNames: b.showProjectNames,
    showOnVibeMap: b.showOnVibeMap,
    appearInLeaderboards: b.appearInLeaderboards,
    whoCanVisit: b.visitsFrom,
  };
}

/** Server `PrivacySettings` → app privacy plus `updatedAt`. */
export function parsePrivacy(s) {
  return {
    ...buildPrivacyBody({ ...s, visitsFrom: s?.whoCanVisit }),
    updatedAt: str(s?.updatedAt),
  };
}

// ── Community tab: from the last SyncResponse ────────────────────────────
//
// API.md has no separate community endpoint; POST /desktop/sync answers with
// { leaderboard: { rank, change }, friends: { activeFriends, codingNow[] } }.

/**
 * @typedef {Object} CommunitySnapshot
 * @property {number|null} rank        null when hidden from leaderboards (rank 0)
 * @property {number} rankChange       positive = moved up
 * @property {string|null} board
 * @property {number} activeFriends
 * @property {Array<{ id: string, username: string, displayName: string|null, avatarUrl: string|null,
 *   project: string|null, currentStreak: number }>} friendsCodingNow
 */

/** @returns {CommunitySnapshot} */
export function communityFromSync(sync) {
  const s = sync && typeof sync === 'object' ? sync : {};
  const rank = num(s.leaderboard?.rank, 0);
  return {
    rank: rank > 0 ? rank : null,
    rankChange: num(s.leaderboard?.change, 0),
    board: 'coding_hours',
    activeFriends: num(s.friends?.activeFriends, 0),
    friendsCodingNow: arr(s.friends?.codingNow)
      .filter((f) => f && str(f.username))
      .map((f) => ({
        id: f.username,
        username: f.username,
        displayName: str(f.displayName),
        avatarUrl: str(f.avatarUrl),
        project: str(f.currentProject),
        currentStreak: num(f.currentStreak, 0),
      })),
  };
}

// ── Builder streak: SyncResponse.streak and GET /me/streak ───────────────

/**
 * @typedef {Object} BuilderStreak
 * @property {number} current
 * @property {number} longest
 * @property {{ drvibeDays: number, githubDays: number }} sources
 * @property {boolean} includesGithub
 * @property {'server'|'desktop'} source  desktop: the server has no days yet and echoes ours
 */

/** `BuilderStreak` (drvibe_protocol::sync), or null when absent or malformed. */
export function parseBuilderStreak(s) {
  if (!s || typeof s !== 'object' || !Number.isFinite(Number(s.current))) return null;
  const current = Math.max(0, num(s.current, 0));
  return {
    current,
    longest: Math.max(current, num(s.longest, 0)),
    sources: { drvibeDays: num(s.sources?.drvibeDays, 0), githubDays: num(s.sources?.githubDays, 0) },
    includesGithub: !!s.includesGithub,
    source: s.source === 'server' ? 'server' : 'desktop',
  };
}

/** `GET /me/streak` → `{ streak: BuilderStreak|null, githubLinked: boolean|null }`. */
export function parseMeStreak(json) {
  const linked = json?.github?.linked;
  return {
    streak: parseBuilderStreak(json?.streak),
    githubLinked: typeof linked === 'boolean' ? linked : null,
  };
}

// ── Visits: POST /visits (SendVisitRequest) ──────────────────────────────

/** Preset lines only — no free text, so there is nothing to moderate. */
export const VISIT_PRESETS = Object.freeze({
  nice_streak: 'Nice streak!',
  keep_shipping: 'Keep shipping!',
  take_a_break: 'Take a break!',
});

export function buildVisitRequest(toUsername, preset = null, replyToVisitId = null) {
  const req = { toUsername: String(toUsername).replace(/^@/, '') };
  if (preset && VISIT_PRESETS[preset]) req.preset = preset;
  if (replyToVisitId) req.replyToVisitId = String(replyToVisitId);
  return req;
}

/**
 * `GET /me/visits` → the Community tab's "Recent visits".
 * @returns {{ id: string, username: string, displayName: string|null, preset: string|null,
 *   isWaveBack: boolean, createdAt: string|null, outcome: string|null }[]}
 */
export function parseVisitList(json) {
  return arr(json?.visits)
    .filter((v) => v && str(v.id) && str(v.from?.username))
    .map((v) => ({
      id: v.id,
      username: v.from.username,
      displayName: str(v.from.displayName),
      preset: VISIT_PRESETS[v.preset] ? v.preset : null,
      isWaveBack: !!v.isWaveBack,
      createdAt: str(v.createdAt),
      outcome: str(v.outcome),
    }));
}

/** Player-facing line for a failed visit (API.md §19 error codes). */
export function visitErrorMessage(r, username) {
  switch (r?.error) {
    case 'visit_cooldown': return `You already visited @${username} this hour.`;
    case 'visits_closed': return `@${username} isn't taking visits.`;
    case 'followers_only': return `@${username} only takes visits from their followers.`;
    case 'blocked': return `You can't visit @${username}.`;
    case 'already_waved_back': return 'You already waved back.';
    case 'self_visit': return "That's you!";
    default:
      if (r?.unlinked) return 'Join the community to send visits.';
      if (r?.status === 404) return `Couldn't find @${username}.`;
      return 'The visit did not go through. Try again in a bit.';
  }
}

/** Player-facing line for a failed design submission (API.md §13). */
export function designErrorMessage(r) {
  const d = r?.data?.details || {};
  switch (r?.error) {
    case 'account_too_new': return 'Your account needs to be linked for 7 days before you can submit.';
    case 'submission_cooldown': return `One submission per week. Next one${d.nextAt ? ` from ${new Date(d.nextAt).toLocaleDateString()}` : ' soon'}.`;
    case 'invalid_sprite': return `The sprite didn't pass: ${(d.problems || []).join(' ') || r?.data?.message || 'check the format.'}`;
    case 'near_duplicate': return `It looks too much like ${d.similarTo?.name || 'an existing Dr. Vibe'}.`;
    case 'safety_rejected': return `It can't be accepted: ${d.reason || r?.data?.message || 'content rules'}.`;
    case 'validation_failed': return Object.values(d.fields || {}).join(' ') || 'Check the name and description.';
    case 'rate_limited': return 'Too many submissions today. Try again tomorrow.';
    default:
      if (r?.unlinked || r?.status === 401) return 'Join the community first (Settings → Account and community).';
      if (r?.status === 0) return 'Could not reach drvibe.io. Your design is safe here; try again later.';
      return r?.data?.message || `The Incubator said no (${r?.status}).`;
  }
}
