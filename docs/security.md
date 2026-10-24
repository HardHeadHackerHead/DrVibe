# Security

How the Dr. Vibe desktop app protects your account, your files and the skins it loads.
For what data is collected, see [privacy.md](privacy.md).

## Reporting a problem

Please don't open a public issue for a security bug. Email **hello@drvibe.io** with the
steps to reproduce and your app version (tray → About). We'll reply as soon as we can.

## Trust boundary

The app has two halves: web views (`src/`, vanilla JavaScript) for everything you see,
and Rust (`src-tauri/src/`) for everything that touches the network, the file system or
your account. The web views can only call the Tauri commands registered in `main.rs`,
with the permissions in `src-tauri/capabilities/`. Per-toast windows get a smaller
capability set (`toast-item.json`).

- **No network from JavaScript.** Every server call is named in
  `src/core/api/endpoints.js` and made by Rust (`api.rs`). The content security policy
  in `tauri.conf.json` limits `connect-src` to the app itself and `drvibe.io`, and
  allows scripts only from the app (`script-src 'self'`).
- **Server address.** Release builds always talk to `https://drvibe.io`. Only debug
  builds can point elsewhere (`DR_VIBE_WEB_BASE_URL`, or Settings → Developer), and
  that switch is ignored in a release binary (`account.rs`).

## Your account

Linking uses a device flow with PKCE (`account.rs`):

1. The app makes a random verifier and opens `drvibe.io/connect` in your browser with
   its hash, an install ID and the device name.
2. After you sign in, the site sends a one-time code back through a
   `dr-vibe://auth/callback` link.
3. The app exchanges the code and the verifier for a `dvd_` device token. A code
   intercepted on its own is useless.

The token:

- lives in the OS credential store (Windows Credential Manager, macOS Keychain, Linux
  Secret Service), never in a file, `localStorage` or a web view. JavaScript only learns
  whether you're linked.
- goes with every request as `Authorization: Bearer dvd_…`.
- signs every request that changes something (sync, events, ack, visits, equip,
  privacy, recap) with `drvibe_protocol::signing::sign_request`:
  `X-DrVibe-Timestamp` (±300 s), a fresh `X-DrVibe-Nonce`, and
  `X-DrVibe-Signature`, an HMAC-SHA256 keyed by the token over the method, path,
  timestamp, nonce and the body's SHA-256. The server rejects reused nonces, so a
  captured request can't be replayed.

There's no shared secret compiled into the app. If the server answers
`401 invalid_device_token` (for example after you revoke the device on the website),
the app forgets the token and offers to link again.

## Sync integrity

JavaScript supplies only what's happening right now (coding or not, current momentum,
this session's numbers). Rust reads the stored history itself and builds the sync
payload (`sync.rs`), and every payload is a `drvibe-protocol` type, so a malformed body
fails in Rust instead of reaching the server. The server re-checks plausibility (hours,
streak and commit deltas) and never awards Vibe Points from a sync; points come only
from individual activity events.

## Skins and sprites

Skins are player-made files, so they're treated as untrusted:

- **Names and slugs** are rejected if they contain `/`, `\` or `..` before any file is
  read or written (`skins.rs`, `generator.rs`).
- **Bundled skins can't be overwritten.** The Lab Originals are read from the app's
  resources; every write goes to a separate folder in the app data
  (`%APPDATA%\com.drvibe.companion\skins\`).
- **Imports** must be real PNGs (signature check) and are validated against the sprite
  format before use (`src/features/make/spriteSpec.js`: size, row count, 2 MB limit).
- **Visiting Dr. Vibes** are downloaded by Rust with a 2 MB cap on the sheet (PNG
  signature checked) and 256 KB on animation data, and cached locally (`visitors.rs`).
- **Sprite data in a sync** passes `validate_sprite_base64`: at most 4 MB, plain base64
  or a `data:image/png;base64,` URI, and never a `javascript:` or `data:text/html` URI.
- **Animation data** baked into a PNG (the `DRVB` block in the pixel LSBs) is parsed as
  JSON and only read for animation settings.

## Claude Code hooks

The hook script (`tools/claude-code-hook.sh`) appends to a log in `~/.dr-vibe/` and
nothing else: no network, no `jq`, and it always exits 0. Installing it rewrites only
Dr. Vibe's own entries in `~/.claude/settings.json` (matched by the script's file name),
and only when a `~/.claude` folder already exists. Settings → Tracking → *Follow Claude
Code* removes them. See [claude-code.md](claude-code.md).

## Personal details

The app never sends your computer's name or your login name. A linked device is named
"Dr. Vibe on Windows" (`account.rs`). Generated designs don't record who made them, and
`generation.generatedBy` written by older builds is stripped whenever animation data is
read, baked, synced or submitted (`scrub_anim_json` and `scrub_png` in `skins.rs`).

## Updates

The updater downloads from `drvibe.io/api/v1/downloads/latest.json` and installs only
bundles signed with the Dr. Vibe update key (minisign; the public key is in
`tauri.conf.json` and `keys/`). A bundle with a missing or wrong signature is refused.
The installer, the app and its helper DLLs are also Authenticode-signed with an RFC 3161
timestamp, and the release checks the installer's signature before uploading. A brand-new
release can still get a SmartScreen warning until it builds reputation; each release
publishes `SHA256SUMS`.

## Crash reports

Crash reports go only to drvibe.io (no third-party service). Home-folder paths are
replaced with `~` before a report is queued, and the server scrubs again. They can be
switched off in Settings → Privacy (`error_reports.rs`).
