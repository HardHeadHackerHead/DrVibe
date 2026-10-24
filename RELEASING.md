# Releasing Dr. Vibe

Dr. Vibe ships only from a clean, tagged commit, built locally on Windows by the maintainer. There is no CI: one command runs the checks, builds the Windows installer, signs the auto-update bundle, writes `latest.json` and `SHA256SUMS`, tags the commit and uploads everything to GitHub Releases as a draft. Publishing the draft is a separate, deliberate step. The website's Downloads page and the in-app updater both read the published release automatically.

Steps marked **(maintainer)** need an account, a secret or a decision that only the maintainer has. Everything else is mechanical.

## How it fits together

```
npm run release -- v2.0.0   (scripts/release.mjs)
    preflight   clean tree; tauri.conf.json = Cargo.toml = package.json = tag;
                TAURI_SIGNING_PRIVATE_KEY set; gh logged in
    checks      npm run check (vitest, cargo fmt --check, clippy -D warnings, cargo test)
    build       tauri build --bundles nsis (per-user install, no admin prompt)
                optional Authenticode signing (+ RFC 3161 timestamp)
                updater bundle signed with TAURI_SIGNING_PRIVATE_KEY
    manifest    release/v2.0.0/: installer, .nsis.zip + .sig, latest.json, SHA256SUMS
    publish     git tag + push the tag; gh release create --draft in GITHUB_RELEASES_REPO
you             gh release edit v2.0.0 --draft=false --latest

drvibe.io/downloads              ─► GET /api/v1/downloads/latest   (reads the latest release, SHA-256 from SHA256SUMS)
app updater (tauri.conf.json)    ─► GET /api/v1/downloads/latest.json
                                     302 ─► github.com/{GITHUB_RELEASES_REPO}/releases/latest/download/latest.json
```

The updater endpoint lives on drvibe.io, so moving the releases repo is a server env change (`GITHUB_RELEASES_REPO` on the website), never an app update. The updater still verifies every bundle against the minisign public key compiled into the app, so the redirect can't be used to push an unsigned update.

## Commands

| Command | What it does |
|---|---|
| `npm run check` | vitest, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (in `src-tauri`). Reports every failure; `-- --fail-fast` stops at the first. |
| `npm run release -- v2.0.0` | The whole release, ending in a draft on GitHub. |
| `npm run release -- v2.0.0 --dry-run` | Everything except tag, push and upload: the files land in `release/v2.0.0/` (git-ignored) for inspection. Still needs the signing key, because the build signs the updater bundle. |
| `npm run release -- v2.0.0 --skip-checks` | Skip `npm run check` (for re-running after a failed upload; the checks already passed on this commit). |
| `npm run release -- v2.0.0 --notes "..."` | Release notes (default `Dr. Vibe 2.0.0`). You can also edit them on GitHub before publishing. |

The release refuses to start when the tree has uncommitted changes, when the three version fields don't all equal the tag, when `TAURI_SIGNING_PRIVATE_KEY` is missing, when the tag already exists on a different commit, or when the releases repo already has a **published** release with that tag. A draft with that tag is reused (files are replaced), so a failed upload can simply be re-run.

## One-time setup (maintainer)

### Tools

- Node 22, the Rust toolchain (stable, with `clippy` and `rustfmt`), and the Tauri prerequisites for Windows (Visual Studio Build Tools; NSIS is downloaded by Tauri).
- `npm ci --ignore-scripts` once (the release runs it again before building).
- The GitHub CLI, logged in: `gh auth login`. The account needs write access to the app repo (to push tags) and to the releases repo.

### Where releases go

Release files go to this repo's GitHub Releases (`HardHeadHackerHead/DrVibe` by default), which is where the website and the updater look for them (`GITHUB_RELEASES_REPO` on the server). The tag is pushed here too, so each release sits on the commit it was built from.

### Env vars

Set these in the shell you release from, reading the key and password from a file outside the repo or from a password manager. Never commit them.

| Name | Required | What it is |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | yes | The minisign private key: the contents of `keys/tauri-signing-key` (git-ignored) or a path to it. Its public half is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. Without it there is no `.sig`, and installed apps can't update, so the release refuses to run. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | if the key has one | The key's password. The build runs with `--ci`, so it never prompts. |
| `GITHUB_RELEASES_REPO` | no | `owner/name` to upload to. Default `HardHeadHackerHead/DrVibe`. Must match the website's `GITHUB_RELEASES_REPO`. |
| `WINDOWS_CERTIFICATE_THUMBPRINT` | no | Authenticode with a certificate in your Windows certificate store (`Cert:\CurrentUser\My`). |
| `WINDOWS_SIGN_COMMAND` | no | Authenticode with a signing tool instead, `%1` is the file. If the tool is a `.cmd` or `.bat` shim, put `cmd /c` in front, because Tauri can't start a shim directly. Set this or the thumbprint, not both. |

In PowerShell, for example:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "<path outside the repo>\tauri-signing-key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '...'
$env:WINDOWS_SIGN_COMMAND = 'cmd /c qwick sign --verify %1'   # QwickCert
```

### The protocol crate

The app depends on `drvibe-protocol` by path (`../crates/drvibe-protocol` from `src-tauri/`). This repo is the crate's canonical home, so the app builds from this repo alone. The server keeps a byte-identical copy of the crate. Before you release, make sure the live server has the same crate, so the app and server agree on the API types.

## Cutting a release

1. **Start from a clean, up-to-date `main`.** Run `npm run check`.
2. **Bump the version** in all three places (the release refuses a mismatch): `src-tauri/tauri.conf.json` → `version`, `src-tauri/Cargo.toml` → `[package] version`, `package.json` → `version`. Then `cd src-tauri && cargo check` so `Cargo.lock` picks it up. Check with `node scripts/release-manifest.mjs check-version --tag v2.0.0`.
3. **Commit** `release: 2.0.0` and push `main`.
4. **Optionally dry-run:** `npm run release -- v2.0.0 --dry-run` and look at `release/v2.0.0/`.
5. **Release:** `npm run release -- v2.0.0`. It prints every step and, at the end, the SHA-256 of every file and the publish command.
6. **Check the draft** on GitHub (five files: `DrVibe_2.0.0_x64-setup.exe`, `DrVibe_2.0.0_x64-setup.nsis.zip` and its `.sig`, `latest.json`, `SHA256SUMS`), then **publish** it:
   ```
   gh release edit v2.0.0 --repo HardHeadHackerHead/DrVibe --draft=false --latest
   ```
   Only then do the updater and drvibe.io/downloads see it.
7. **Smoke test:** download the installer from drvibe.io/downloads on a clean Windows user account, check the hash (below), install (no admin prompt), and confirm an older build updates itself (About → Check for updates).
8. **Submit the installer to Microsoft** (below). Do it for every release.
9. **Announce** in Discord.

Pre-release versions are tagged like `v2.1.0-beta.1`. The tag must equal the app version exactly (`2.1.0-beta.1`).

### Checksums

Every release has a `SHA256SUMS` file covering the installer, the update bundle, its `.sig` and `latest.json`; `npm run release` prints it at the end. The Downloads page shows the installer's hash from it. Before publishing, you can compare the uploaded files with your local ones:

```powershell
gh release download v2.0.0 --repo HardHeadHackerHead/DrVibe --pattern SHA256SUMS --output - | Compare-Object (Get-Content release\v2.0.0\SHA256SUMS)
```

Players can check a download:

```powershell
Get-FileHash .\DrVibe_2.0.0_x64-setup.exe -Algorithm SHA256
```

```sh
sha256sum -c SHA256SUMS --ignore-missing
```

## Microsoft false-positive submission (every release)

New, rarely downloaded installers trip Defender and SmartScreen heuristics. Submitting each release clears them faster.

1. **(maintainer)** Go to https://www.microsoft.com/en-us/wdsi/filesubmission and sign in with a Microsoft account (the same one each time, so history accumulates).
2. Choose **Software developer**, product **Microsoft Defender Antivirus (Windows 10/11)**.
3. Upload `DrVibe_<version>_x64-setup.exe` from the GitHub release or `release/<tag>/` (or a zip of it if it is over the size limit).
4. Detection: **Incorrectly detected as malware/malicious** (or "SmartScreen warning" when there is no detection). Give the release URL, say it is built from the tagged source, and paste the SHA-256 from `SHA256SUMS`.
5. Keep the submission ID in the release notes or a private log. Answers usually take 1–3 days; if a definition update is issued, nothing else is needed.

Also worth doing: upload the installer to https://www.virustotal.com once per release and, if a vendor flags it, use that vendor's false-positive form (linked from the VirusTotal result).

## Authenticode

The updater signature (minisign) protects auto-updates. Authenticode is what Windows checks on the installer the player downloads; without it, SmartScreen shows "Unknown publisher".

- **How it's applied:** with `WINDOWS_CERTIFICATE_THUMBPRINT` or `WINDOWS_SIGN_COMMAND` set, the release passes it to `tauri build --config`, so Tauri signs the app exe and the installer during the build, before it creates and signs the update bundle (the auto-update payload is Authenticode-signed too). The release then checks the installer with `Get-AuthenticodeSignature` and stops if the signature isn't valid. Without either, the installer is unsigned and the release says nothing about it.
- **Don't sign after the build:** signing the installer afterwards (as the old `build-release.ps1` did) leaves an unsigned copy inside the update bundle and changes the installer's hash after `SHA256SUMS` is written.
- **Timestamping:** `tauri.conf.json` sets `timestampUrl` (DigiCert) with `tsp: true`, so signatures are RFC 3161 timestamped and stay valid after a short-lived certificate expires.
- **QwickCert (what Dr. Vibe releases use):** [QwickCert](https://qwickcert.dev) signs through Azure Trusted Signing, so there's no certificate file or hardware token to manage. Install its CLI, log in once (`qwick auth login`, check with `qwick doctor`), and set `WINDOWS_SIGN_COMMAND=cmd /c qwick sign --verify %1` (`qwick` is a `.cmd` shim, hence `cmd /c`).
- **Another cloud signing service:** log in with its CLI once and set `WINDOWS_SIGN_COMMAND` to its sign command (with `cmd /c` in front if the CLI is a `.cmd` shim).
- **A `.pfx` (OV certificate):** import it into `Cert:\CurrentUser\My` (`Import-PfxCertificate`) and set `WINDOWS_CERTIFICATE_THUMBPRINT`.
- **Hardware-token / cloud HSM certificates** (all new OV/EV certificates since 2023): use the provider's signing tool through `WINDOWS_SIGN_COMMAND`.
- SmartScreen reputation builds with downloads of signed files; EV certificates no longer skip that warm-up. Expect warnings for the first days of a new certificate.

## macOS

macOS builds aren't released yet. `release.mjs` builds Windows only. `scripts/release-manifest.mjs collect --platform macos` already turns a universal `.app.tar.gz` + `.dmg` into release files and `latest.json` entries, so adding a Mac build later means running `tauri build --target universal-apple-darwin --bundles app,dmg` on a Mac with the Developer ID certificate and notarization credentials, collecting into the same release directory before `finalize`.

## Updater key rotation

Every installed app trusts exactly one minisign public key (`plugins.updater.pubkey`). Rotating it takes one bridge release:

1. **(maintainer)** Generate the new pair offline: `npx tauri signer generate -w keys/tauri-signing-key-<year>`. Store the private key and password in a password manager; never commit them.
2. Put the **new public key** in `tauri.conf.json` and release normally, still signed with the **old** private key. Installed apps accept this update because it's signed with the key they trust, and it teaches them the new key.
3. Switch `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to the new pair. Every later release is signed with it.
4. Keep the old private key until most players have taken the bridge release, then destroy it.

**If the private key leaks or is lost**, there is no bridge: anyone with a leaked key could sign updates, but only if they also control the release files or drvibe.io. Rotate at once (new key in the app, release signed with the new key), and tell players in Discord and on the site to reinstall from drvibe.io/downloads. Revoke any GitHub tokens with access to the releases repo and audit it.

## Rolling back a bad release

Installed apps never downgrade. To stop a bad release spreading: mark the previous release as latest (`gh release edit v2.0.0 --latest --repo <releases repo>`) or delete the bad one, then ship the fix as a new, higher version (`v2.0.2`). The website's Downloads page follows within 5 minutes (its cache).
