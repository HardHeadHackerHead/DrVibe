# scripts/

| Script | What it does |
|---|---|
| `check.mjs` | `npm run check`: vitest, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`. Run it before every pull request and release. |
| `release.mjs` | `npm run release -- v2.0.0`: builds, signs and uploads a release as a draft on GitHub. See [RELEASING.md](../RELEASING.md). |
| `release-manifest.mjs` | Helpers `release.mjs` uses: version check, collecting the installer and updater bundle, `latest.json` and `SHA256SUMS`. |
| `e2e-live.sh` | Live end-to-end run against a local website server (`tests/live/`). |
| `generate-nsis-images.cjs` | Installer header and sidebar images (`npm run generate-nsis-images`, which installs the native `canvas` package first, without saving it). The output is committed in `src-tauri/nsis/`, so you only need this to change the images. |
| `bake-skins.cjs`, `mark-community-skins.cjs` | Embed animation data in skin PNGs. |

Releases are built locally on Windows; there is no CI. The older
`build-release.ps1` / `release.bat` (Windows) and the interactive
`release-macos.sh` were replaced by `release.mjs`. macOS builds are not part of
the launch; `release-manifest.mjs collect --platform macos` already handles a
universal `.app.tar.gz` + `.dmg` if one is added later.
