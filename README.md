# OpenCode Mobile

<p align="center">
  <strong>Your OpenCode workflow, in your pocket.</strong>
</p>

<p align="center">
  Start tasks, check progress, review changes, use the terminal, speak follow-ups, and manage OpenCode workspaces from Android and iOS.
</p>

<p align="center">
  <a href="https://play.google.com/store/apps/details?id=app.getopencode">
    <img src="https://img.shields.io/badge/Get_it_on-Google_Play-4285F4?style=for-the-badge&logo=googleplay&logoColor=white" alt="Get it on Google Play">
  </a>
  <a href="https://testflight.apple.com/join/ddcE5Wzz">
    <img src="https://img.shields.io/badge/Join_iOS_Beta-TestFlight-0D96F6?style=for-the-badge&logo=apple&logoColor=white" alt="Join iOS TestFlight">
  </a>
  <a href="https://github.com/alvarolorentedev/opencode-mobile/releases/latest/download/opencode-mobile.apk">
    <img src="https://img.shields.io/badge/Download-APK-18A748?style=for-the-badge&logo=android&logoColor=white" alt="Download APK">
  </a>
</p>

<p align="center">
  <a href="https://getopencode.app/">Website</a> ·
  <a href="https://getopencode.app/docs/">Docs</a> ·
  <a href="https://getopencode.app/support/">Support</a>
</p>

---

## OpenCode, without being tied to your laptop

OpenCode Mobile is an independent, community-built mobile companion for [OpenCode](https://opencode.ai/).

It connects to the OpenCode server you already run and gives you a focused mobile control surface for the moments when you need to check, guide, approve, or continue agent work away from your desk.

It is not trying to put a desktop IDE on a smaller screen.

It is designed around the things that actually matter on mobile.

  <video
     controls
     playsinline
     preload="none"
     min-height="720"
     poster="https://github.com/user-attachments/assets/32c7526a-9b7f-4590-96eb-a0105003840d"
     src="https://github.com/user-attachments/assets/ea4a03dd-10b2-48f6-8fca-2e4cd76877e7"
   />

## What you can do

- **Start and continue coding sessions**  
  Pick an agent and model, send instructions, and keep working with the same OpenCode sessions from your phone.

- **Watch agent progress**  
  See what OpenCode is doing instead of waiting for a generic completion notification.

- **Review and approve actions**  
  Respond to permission requests and inspect the work before accepting changes.

- **Manage workspaces and sessions**  
  Switch between multiple OpenCode servers, projects, sessions, and models.

- **Use the terminal when needed**  
  Run focused commands without reopening your laptop.

- **Browse and patch files**  
  Inspect project files and make targeted changes from mobile.

- **Use voice input**  
  Dictate prompts or continue a conversation when typing is inconvenient.

- **Understand model usage**  
  Inspect context utilization, token activity, model usage, steps, and estimated cost.

- **Stay connected to multiple servers**  
  Save OpenCode connections with their own sessions and model selection.

## How it works

Your code stays on the machine running OpenCode.

OpenCode Mobile connects to that server remotely:

```text
Your phone
    │
    │ HTTPS / secure tunnel
    ▼
OpenCode server
    │
    ▼
Your workspace + models
```

A typical setup looks like this:

### 1. Start OpenCode

```bash
opencode serve --port 4096
```

### 2. Expose it securely

Keep the server protected with authentication and connect through a secure HTTPS tunnel, VPN, or reverse proxy.

For example:

```bash
cloudflared tunnel --url localhost:4096
```

Tailscale, Cloudflare Tunnel, and other secure networking options work well.

### 3. Connect from OpenCode Mobile

Enter the protected server URL in the app, authenticate, choose your workspace, and continue your sessions.

For the complete setup flow, see the [Getting Started guide](https://getopencode.app/docs/getting-started/).

### 4. Connect an AI provider

Open **Settings → AI & providers → Add provider**, choose your provider,
select **API key** if multiple login methods are offered, paste the key, and
save. For OpenCode Go, choose **OpenCode Go** and paste the key from your
OpenCode console. You can then enable its models and select one in Chat.
Tap an already configured provider to reopen login or replace its key.

Provider keys are saved on the connected OpenCode server. On OpenCode 2,
the server's integration catalog determines which providers support API-key
or OAuth login; environment-only providers must be configured on the server.

## Install

### Android

Recommended:

[**Download from Google Play →**](https://play.google.com/store/apps/details?id=app.getopencode)

Or install the latest APK directly:

[**Download latest APK →**](https://github.com/alvarolorentedev/opencode-mobile/releases/latest/download/opencode-mobile.apk)

### iOS

OpenCode Mobile is currently available through TestFlight:

[**Join the iOS beta →**](https://testflight.apple.com/join/ddcE5Wzz)

For installation details and requirements, visit:

[**getopencode.app/download →**](https://getopencode.app/download/)

## Privacy and control

OpenCode Mobile is designed around self-hosted OpenCode environments.

- Your source code remains on your OpenCode host.
- The app connects to infrastructure you control.
- Server credentials are stored using secure device storage where appropriate.
- You choose how your OpenCode instance is exposed.
- No hosted OpenCode server is required.

For remote access, prefer authenticated HTTPS, a VPN, or a secure tunnel rather than exposing an unauthenticated OpenCode port directly to the internet.

## Community-built

OpenCode Mobile is not an official OpenCode product.

It is an independent open-source project built for people who already use OpenCode and want to keep their agent workflows reachable when they step away from their desk.

OpenCode and its trademarks belong to their respective owners.

## Development

OpenCode Mobile is built with:

- React Native
- Expo
- TypeScript
- Expo Router
- OpenCode SDK/client

For local development, architecture, testing, and release instructions:

[**Read the development guide →**](docs/development.md)

## Contributing

Contributions are welcome.

You can help by:

- opening bug reports
- proposing features
- improving documentation
- testing Android and iOS builds
- submitting pull requests
- helping reproduce compatibility issues with new OpenCode releases

Browse the [issue tracker](https://github.com/alvarolorentedev/opencode-mobile/issues) or open a PR.

## ⭐ Star History

<a href="https://www.star-history.com/?repos=alvarolorentedev%2Fopencode-mobile&type=timeline&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=alvarolorentedev/opencode-mobile&type=timeline&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=alvarolorentedev/opencode-mobile&type=timeline&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=alvarolorentedev/opencode-mobile&type=timeline&legend=top-left" />
 </picture>
</a>

## ❤️ Support Us

OpenCode Mobile is free and open source.

If the project is useful to you, you can help support continued development, testing, releases, and infrastructure through:

- GitHub Sponsors
- Ko-fi
- PayPal
- Bitcoin
- Ethereum

[**Support Us →**](https://getopencode.app/support/)

<a href="https://github.com/alvarolorentedev/opencode-mobile/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=alvarolorentedev/opencode-mobile" />
</a>

Made with [contrib.rocks](https://contrib.rocks).

---

<p align="center">
  <strong>Take your next OpenCode session with you.</strong>
</p>

<p align="center">
  <a href="https://getopencode.app/">getopencode.app</a>
</p>
