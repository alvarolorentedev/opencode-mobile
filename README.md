# OpenCode Mobile

[![Get it on Google Play](https://img.shields.io/badge/Get_it_on-Google_Play-4285F4?style=for-the-badge&logo=googleplay&logoColor=white)](https://play.google.com/apps/testing/app.getopencode)
[![Download APK](https://img.shields.io/badge/Download-APK-18A748?style=for-the-badge&logo=android&logoColor=white)](https://github.com/alvarolorentedev/opencode-mobile/releases/latest/download/opencode-mobile.apk)


**Your OpenCode server, in your pocket.**

OpenCode Mobile brings the full power of your self-hosted OpenCode AI assistant to your Android device. Chat with your models, manage conversations, and stay productive anywhere.

## Why OpenCode Mobile?

- **Stay Connected**: Access your OpenCode server from anywhere on your mobile device
- **Seamless Conversations**: Pick up where you left off with synchronized chat history
- **Full Control**: Connect to your own OpenCode server — your data, your rules
- **Privacy-First**: Keep your conversations private on your self-hosted infrastructure
- **Fast & Native**: Built with React Native for smooth, responsive performance

## Quick Start

### For Users

1. **Download the app**:
   - [Google Play (Beta)](https://play.google.com/apps/testing/app.getopencode)
   - [Direct APK Download](https://github.com/alvarolorentedev/opencode-mobile/releases/latest/download/opencode-mobile.apk)

2. **Connect to your server**: Open the app and enter your OpenCode server URL (default: `http://ip:4096`)

3. **Start chatting**: Begin conversations with your AI models instantly

### For Developers

Want to build from source or contribute? See the [Development](#development) section below.

## Features

- Real-time chat with your OpenCode models
- Conversation history and management
- Multi-model support
- Custom server configuration
- Streamed responses for natural conversations
- Clean, intuitive mobile interface

## Screenshots

Check out screenshots and more details on the [official website](https://getopencode.app/).

---

## Development

OpenCode Mobile is built with Expo and React Native.

### Requirements

- Node.js 20+
- npm
- Android Studio / Xcode for native builds

### Getting Started

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/alvarolorentedev/opencode-mobile.git
   cd opencode-mobile
   npm install
   ```

2. Start the development server:
   ```bash
   npm run start
   ```

3. For a development client build:
   ```bash
   npm run start:dev-client
   ```

### Common Commands

```bash
npm run lint           # Run linter
npm run typecheck      # Type checking
npm run test:e2e:web   # End-to-end tests
npm run android        # Build Android app
npm run ios            # Build iOS app
```

### Android Builds

Build a production Android release:
```bash
npm run build:android
```

Build a development client:
```bash
npm run build:development:android
```

**Release Automation**:
- Push to `main` to trigger Android release build and artifact upload
- Push a version tag (e.g., `v1.2.3`) to trigger production Play Store upload
- Use `workflow_dispatch` for manual internal-track uploads

### Testing

- Flow validation runs against the fake OpenCode server in `tests/fake-opencode/server.mjs`
- End-to-end suite uses Playwright (`tests/e2e/flows.spec.mjs`)
- Full testing strategy documented in `TESTING.md`

### Configuration

Connection settings are configured inside the app. By default, the app expects an OpenCode server at `http://127.0.0.1:4096`.

Local configuration files (`.env`, `config.json`) are gitignored for security.
