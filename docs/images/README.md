# README images

The screenshots and GIFs here are captured from the real app pages in `src/`, not
mockups. They were made like this, with demo data only (the project "pixel-forge", the
visitor "@pixel_pal"), never a real profile:

1. Serve `src/` over a local HTTP server and open each page in Chromium (Playwright),
   with a small stand-in for `window.__TAURI__` that answers `invoke`, the store plugin
   and events from fixed demo data. Window sizes match `src-tauri/src/panels.rs` and
   `tray.rs` (for example Settings 640 × 640, Dashboard 520 × 680, Make 980 × 680).
2. PNG screenshots at device scale 2, quantised to 256 colours.
3. `desktop.gif` and `visit.gif`: a page that frames `index.html`, `speech.html` and
   `visitor.html` above a mock editor and taskbar, driven through the app's own
   `EventBus` (`CLAUDE_CODE_HOTSPOT`, `GIT_COMMIT_MADE`, `VISIT_RECEIVED`), recorded at
   8 to 10 frames a second.
4. `hero.gif`: frames cut straight from the Lab Original sheets in
   `src/assets/sprites/skins/`, using the row timings in `src/config/animations.js`.

Keep GIFs under about 2 MB and PNGs optimised. Playwright isn't a dependency of this
repo; install it in a scratch folder when you refresh these.

The images are Dr. Vibe art, licensed under CC BY-NC-SA 4.0 ([LICENSE-ART.md](../../LICENSE-ART.md)).
