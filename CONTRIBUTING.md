# Contributing to Dr. Vibe

Thanks for helping out! Dr. Vibe is a Tauri 2 app: a vanilla JavaScript
frontend in `src/` and a Rust backend in `src-tauri/`. This guide gets you
from a fresh clone to a pull request.

## Getting set up

### Prerequisites

- [Node.js](https://nodejs.org/) 22
- [Rust](https://rustup.rs/) (stable, with `clippy`)
- The [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) for your OS

### Install and run

```bash
npm ci
npm run dev:prod          # tauri dev against https://drvibe.io
npm run dev               # tauri dev against a local server on http://localhost:8080
npm run build             # release build (NSIS installer)
```

The Dr. Vibe server isn't part of this repository. Everything that works offline
(the character, tracking, wellness, achievements, the dashboard, skins and the
sprite editor) works without it; with `npm run dev` and no local server, community
features just show as offline. Use `npm run dev:prod` to try linking and visits
against drvibe.io. Debug builds can switch server in Settings → Developer (tick *Admin Mode* in the
settings title bar to show that tab).

**Your data.** The `npm run dev*` scripts pass `src-tauri/tauri.dev.conf.json`, which
sets the identifier to `com.drvibe.companion.dev`. Dev builds therefore keep their own
settings, stats, skins and keyring token, apart from an installed Dr. Vibe, and both
can run at once. Debug Rust builds use the same dev identifier for the keyring and
notifications (`APP_ID` in `src-tauri/src/account.rs`), so keep the two in step if you
change it. `~/.dr-vibe` and the Claude Code hooks are shared.

### The protocol crate

The app shares its API types with the server through the `drvibe-protocol`
crate in `crates/drvibe-protocol/`, which `src-tauri/Cargo.toml` takes by path
(`../crates/drvibe-protocol`). This repo is its canonical home, so a plain
clone builds. The server keeps a byte-identical copy, so a change to the crate
is a change to the API: say so in your pull request.

## Tests

Run these before you open a pull request. There is no CI, so this is the
gate; `npm run check` runs all of them and lists every failure:

```bash
npm run check                               # everything below
npm test                                    # vitest (tests/unit, tests/e2e)
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings   # warnings are errors
cargo test
cd ../crates/drvibe-protocol                # the protocol crate, on its own
cargo fmt --check
cargo clippy --all-targets --all-features --locked -- -D warnings
cargo test --all-features --locked
```

`tests/live/` is an end-to-end run against a real local website server. It is
skipped unless `DRVIBE_E2E_BRIDGE` is set; `scripts/e2e-live.sh` sets it up.

## How the code fits together

- **EventBus** (`src/core/EventBus.js`): modules talk by emitting and
  subscribing to events, never by calling each other. Event names live in
  `Events` in the same file.
- **Features** (`src/features/<name>/`): one folder per feature, wired up in
  `src/app.js`.
- **UI** (`src/ui/`) for panels, and one HTML file per window in `src/`.
- **Network:** JS never calls `fetch` against the server. Every endpoint is
  named in `src/core/api/endpoints.js`, and the Rust client in
  `src-tauri/src/api.rs` adds the device token, signs state-changing requests
  and checks bodies against `drvibe-protocol`. `src/core/PollClient.js` is the
  60-second poll.
- **Rust** is split by domain (`account.rs`, `api.rs`, `sync.rs`, `tray.rs`,
  `skins.rs`, `generator.rs`, `presence.rs`, `visitors.rs`, ...). Put a new
  Tauri command in the module it belongs to and register it in the
  `generate_handler!` list in `main.rs`.

### Adding a feature

1. Create `src/features/<name>/` and subscribe to the events you need.
2. Emit your own events for other modules to react to.
3. Register the feature in `src/app.js`.
4. Add a test under `tests/unit/`.

### Sprites

The sprite format is one spec shared with the website
([`src/features/make/spriteSpec.js`](src/features/make/spriteSpec.js)):
32 x 32 frames, 4 columns, 16 rows (128 x 512), plus an optional 17th
levitating row (128 x 544). Row order and timing are in
[`src/config/animations.js`](src/config/animations.js); the full format is in
[docs/skins.md](docs/skins.md). Don't recolour or re-encode the bundled sheets:
their animation data is baked into the pixels (`scripts/bake-skins.cjs`).

The 12 bundled Lab Originals are fixed. New Dr. Vibes come from players: make
one with **Make your own Dr. Vibe** in the app and submit it to the Incubator
on drvibe.io rather than adding it to this repo.

### Docs

- [docs/privacy.md](docs/privacy.md) lists everything the app collects and
  sends. If you change what's tracked or synced, update it together with
  `src/ui/WhatDrVibeSees.js` (the same list, shown in the app).
- [docs/claude-code.md](docs/claude-code.md) covers the Claude Code hooks,
  [docs/security.md](docs/security.md) the trust boundaries, and
  [STATE-REFERENCE.md](STATE-REFERENCE.md) what triggers each animation.

## Pull requests

1. Branch from `main`, keep it to one feature or fix, and keep it reasonably
   sized.
2. Match the style of the file you're editing, and don't add dependencies
   without a good reason.
3. Make sure the tests above pass.
4. Write a clear commit message and describe what you changed and how you
   tested it.

### Bugs and ideas

Open an issue. Security problems go to hello@drvibe.io instead (see
[docs/security.md](docs/security.md)). For bugs, include the steps to reproduce, what you expected,
your OS and your Dr. Vibe version (tray → About).

### Copy and voice

Anything Dr. Vibe says is short, warm and second person, like a friendly
hype-coach mad scientist ("Five files and counting!"). Never mention money,
buying, scarcity or pressure.

## Releases

Releases are cut locally by the maintainer with `npm run release -- vX.Y.Z`
(there is no CI). The process is in
[RELEASING.md](RELEASING.md).

## License

- By contributing code you agree that it is licensed under the
  [AGPL-3.0](LICENSE).
- The Dr. Vibe character, the Lab Originals and the brand art are under
  [CC BY-NC-SA 4.0](LICENSE-ART.md), not the AGPL.
