# Contributing to Dr. Vibe

Thanks for your interest in contributing to Dr. Vibe! This guide will help you get started.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) 1.70+
- [Tauri CLI](https://tauri.app/) 2.0+

### Development Setup

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/dr-vibe.git
cd dr-vibe

# Install dependencies
npm install

# Run in development mode
npm run dev
```

This will launch the Tauri development build with hot reload for the frontend.

## How to Contribute

### Reporting Bugs

1. Check [existing issues](https://github.com/YOUR_USERNAME/dr-vibe/issues) to avoid duplicates
2. Open a new issue using the **Bug Report** template
3. Include steps to reproduce, expected behavior, and screenshots if applicable
4. Mention your OS and Dr. Vibe version

### Suggesting Features

1. Check existing issues and discussions for similar ideas
2. Open a new issue using the **Feature Request** template
3. Describe the use case and why it would be valuable

### Submitting Pull Requests

1. **Fork** the repository
2. **Create a branch** from `main` for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** following the code style guidelines below
4. **Test your changes** by running the app locally with `npm run dev`
5. **Commit** with a clear, descriptive message
6. **Push** your branch and open a **Pull Request** using the PR template
7. Respond to review feedback promptly

## Code Style

### JavaScript

- **Vanilla JavaScript** — no frameworks
- ES modules (`import`/`export`)
- Use the **EventBus pattern** for module communication — emit events rather than calling other modules directly
- Keep modules decoupled and self-contained
- Follow the existing file organization under `src/features/`

### Rust

- Follow standard Rust formatting (`cargo fmt`)
- Tauri commands go in `src-tauri/src/main.rs`
- Use `serde` for serialization

### General

- Keep changes focused — one feature or fix per PR
- Don't add unnecessary dependencies
- Match the existing code style in the file you're editing
- Test on your platform before submitting

## Project Architecture

Dr. Vibe is a **Tauri 2.0** application with a **Rust backend** and a **vanilla JavaScript frontend**. It uses an **event-driven architecture**:

- **EventBus** (`src/core/EventBus.js`) — Central pub/sub system. All modules communicate through events.
- **Features** (`src/features/`) — Self-contained modules that listen to and emit events.
- **UI** (`src/ui/`) — Presentation components.
- **Core** (`src/core/`) — Shared infrastructure (EventBus, TauriBridge, GameLoop, Database).

### Adding a New Feature

1. Create a new directory under `src/features/`
2. Subscribe to relevant events from the EventBus
3. Emit your own events for other modules to react to
4. Register your feature in `src/app.js`

### Adding a New Skin

1. Create a 32x32 pixel spritesheet with all 16 animation rows
2. Save it as `src/assets/sprites/skins/dr-vibe-yourskin.png`
3. Add it to the skin list in the settings system
4. Test all animation states with the new skin

## Pull Request Guidelines

- Fill out the PR template completely
- Keep PRs reasonably sized — large changes are harder to review
- Squash commits if requested

## License

By contributing to Dr. Vibe, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).

## Questions?

If you have questions about contributing, feel free to open a discussion or issue. We're happy to help!
