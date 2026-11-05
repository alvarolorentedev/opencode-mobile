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
     src="https://github.com/user-attachments/assets/6da73ca0-d491-45c6-8aee-1f7e494cf602"
   />

## What you can do

- **Start and continue coding sessions**  
  Pick a project, worktree, agent, and model, send instructions, and keep working with the same OpenCode sessions from your phone. Fork a reply or revert an earlier prompt to take another path.

- **Watch progress as it happens**  
  Follow reasoning, tool calls, shell output, patches, and todos in a live timeline. Choose how much detail you see, jump back to the latest message, and get notified when a task finishes or needs your input.

- **Review and approve actions**  
  Answer permission requests, questions, and server forms, or enable auto-approve when you trust the run.

- **Review changes before you accept them**  
  Inspect diffs for the current turn, uncommitted work, or the branch, with expandable file patches and line totals.

- **Browse and edit project files**  
  Search paths, preview text, images, audio, and video, download files, and rename, copy, cut, and paste from mobile.

- **Use the terminal when needed**  
  Open multiple terminal sessions with Esc, Tab, modifiers, arrows, and paste at hand, copy output, and reconnect when you return.

- **Use voice and conversation mode**  
  Dictate prompts, read replies aloud, or go hands-free with wake-word conversation mode and optional on-device speech models.

- **Shape your OpenCode setup**  
  Add AI providers with API keys or OAuth, enable models, and configure MCP servers, agents, skills, commands, and plugins.

- **Use Comands, plugins with a mobile UI**  
  Use OpenCode commands, Agents, MCP even Plugins including their visualizations (ex. [Flowgraph](https://github.com/alvarolorentedev/opencode-flowgraph)) from any chat.

- **Let auto-routing pick the model**  
  Classify each prompt as simple, standard, or complex and send it to the right enabled model, with the routed model shown on each reply.

- **Manage projects, worktrees, and sessions**  
  Switch between projects and worktrees, add projects from a server folder browser, archive projects on the device or view server-archived ones, and favorite, rename, or delete sessions.

- **Share into the app**  
  On Android, send text, links, images, or PDFs from another app into a reviewable chat draft.

- **Stay connected to multiple servers**  
  Save OpenCode connections with their own sessions and model selection, pair by QR code or Cloud Link, and connect through custom headers or trusted certificates.

- **Keep up from the launcher**  
  Get completion and needs-input notifications, Android home widgets, and quick actions for recent tasks without opening the app.

- **Personalize the app**  
  Choose themes, languages (including right-to-left), text size, transcript detail, speech settings, and update preferences.

- **Understand model usage**  
  Inspect context utilization, token activity, model usage, steps, and estimated cost.

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

OpenCode Mobile is not an official OpenCode product. It is not built by the
OpenCode team, is not endorsed by them, and is not affiliated with them in any
way.

It is an independent open-source project built for people who already use OpenCode and want to keep their agent workflows reachable when they step away from their desk.

OpenCode and its trademarks belong to their respective owners.

## Development

OpenCode Mobile is built with:

- React Native
- Expo
- TypeScript
- Expo Router
- `@opencode/client` for native OpenCode 2; `@opencode-ai/sdk` isolated to OpenCode 1 compatibility

For local development, architecture, testing, and release instructions:

[**Read the development guide →**](docs/engineering/development.md)

For the full documentation map, architecture, product behavior, design system,
and decisions:

[**Browse the documentation hub →**](docs/README.md)

Reusable UI primitives and shared controls are catalogued in Storybook:

```bash
npm run storybook
```

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
