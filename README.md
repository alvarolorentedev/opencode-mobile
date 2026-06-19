# ANVIL-CLIENT

Mobile client for the ANVIL/Bellows LLM routing system, built with Expo and React Native.

Forked from [alvarolorentedev/opencode-mobile](https://github.com/alvarolorentedev/opencode-mobile) (Apache 2.0).

## What is this?

ANVIL-CLIENT is the mobile surface for ANVIL's Bellows gateway. It connects to a Bellows server instance and provides a chat interface for interacting with LLM-routed sessions, workspaces, and provider configurations from your phone or tablet.

## Requirements

- Node.js 20+
- npm
- A Bellows server you can connect to
- Android Studio / Xcode if you want local native builds

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the app:

   ```bash
   npm run start
   ```

3. For a development client build, use:

   ```bash
   npm run start:dev-client
   ```

## Common Commands

```bash
npm run lint
npm run typecheck
npm run test:e2e:web
npm run android
npm run ios
```

## Testing

- Flow validation is CI-first and always runs against the fake server in `tests/fake-opencode/server.mjs`.
- The end-to-end suite is implemented with Playwright in `tests/e2e/flows.spec.mjs`.
- The full repo testing strategy is documented in `TESTING.md`.

## Bellows Connection

Connection settings are configured inside the mobile app. By default the app expects a Bellows server at `http://127.0.0.1:4096`.

Local-only files such as `.env` and `config.json` are intentionally gitignored because they may contain secrets or tokens.

## Android Builds

Build a production Android release locally:

```bash
npm run build:android
```

Build an Android development client locally:

```bash
npm run build:development:android
```

Both local and GitHub Actions Android builds use the native `android/` project plus Gradle.

## Donor Attribution

This project is a fork of [opencode-mobile](https://github.com/alvarolorentedev/opencode-mobile) by alvarolorentedev, licensed under the Apache License 2.0. The original project provides the Expo/React Native scaffolding, navigation structure, and OpenCode SDK integration that ANVIL-CLIENT builds upon.
