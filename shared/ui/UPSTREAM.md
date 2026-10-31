# UI source provenance

Registry source: founded-labs/react-native-reusables, Uniwind variant,
commit `385834c2196f8a303cbc9057d1ac768f3bde0a3b`.

Source-owned adaptations use the existing MaterialCommunityIcons, semantic
product tokens, minimum targets, wrapping text, explicit reduced-motion
behavior, and workspace/modal portal contexts. The native slider and terminal
DOM controls retain their existing specialized interaction behavior.

Use the pinned CLI with explicit component names and `--styling-library uniwind`.
Review source/dependency diffs and reapply documented adaptations; do not use
blind overwrite or install every registry item. Decline CLI dependency-install
prompts and add required imports manually at compatible versions; its core
setup defaults still include Tailwind v3-era packages. No runtime Reusables package is
required: the components in this directory are production source code.

Web content frames use the same Radix dependencies as RN Primitives. Dialog
frames keep a layout-neutral DOM wrapper so RN flex sizing and animated style
arrays remain intact. Select frames style Radix's positioned element directly;
RN Primitives styles an inner view, leaving the outer popper behind full-screen
forms. Native frames continue to use RN Primitives. PortalScope restores a
captured workspace and keeps RN style arrays behind the child-cloning Radix
portal boundary; isolated previews work without domain providers. Keep these adaptations when
upgrading until the upstream wrappers support these layouts.

Full-screen forms use nested Radix dialogs on web and native Modal windows on
Android/iOS. Named native portal hosts route Back to the top open overlay.
Decorative icon glyphs are hidden from accessibility names. Skeletons are static;
app-specific rendering and measurements remain at their existing boundaries.
Native selects measure the trigger width, respect safe areas and scroll their
options within a capped viewport so descriptions and large text remain usable.

## Upstream license

MIT License

Copyright (c) 2025 Founded Labs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Feedback uses RN Primitives' background toast mode: announcements stay polite
and preserve input focus on all platforms. Native accessibility-focus APIs are
never invoked for a web toast. Storybook supplies only an inert updater context
fixture and the real safe-area/gesture/appearance roots.
