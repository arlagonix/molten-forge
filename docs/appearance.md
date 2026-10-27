# Appearance and background behavior

This document is the source of truth for theme and background behavior in Molten Forge Pi.

The visual reference is the old Electron Molten Forge implementation, specifically the light/dark palette and the background controls from the 1.16.10/1.16.11 background-glass work.

## Theme

The user can select one of three preferences:

- `System` — follow the operating-system color scheme and react to system changes while the app is open.
- `Light` — always use the Molten Forge light palette.
- `Dark` — always use the Molten Forge dark palette.

The selected preference is persisted in local storage. The resolved theme is applied to the root document and controls both semantic colors and the matching default/custom background.

Dark-theme styling should remain visually compatible with the existing Pi wrapper unless a change is explicitly requested. Light-theme colors should follow the old Molten Forge semantic palette instead of using a generic white theme.

## Application font

General settings expose three application-font choices:

- `Sans` — the normal Molten Forge UI stack.
- `Mono` — bundled `JetBrains Mono` (via `@fontsource/jetbrains-mono`) first, then `Cascadia Code`, `SFMono-Regular`, `Consolas`, and the platform monospace fallback.
- `Miracode` — vectorized Minecraft-inspired mono face (IdreesInc/Miracode v1.0), with a JetBrains Mono fallback. The previous `monocraft` and `computer-modern` choices migrate automatically to Miracode. `scripts/prepare-miracode.mjs` attempts to fetch the pinned official release, verifies its SHA-256, and never blocks compilation when the asset cannot be downloaded. To activate it offline, copy the official `Miracode.ttf` into `public/fonts/`.

The choice is persisted in local storage and applied to the root so chat text, settings, controls, and code surfaces switch together. JetBrains Mono remains the default code face for Sans and Mono. Miracode applies to both normal UI and code when selected. The compiled app can use a locally cached Miracode font without runtime network access.

## Settings workspace

Settings use the old Electron Molten Forge split workspace instead of a modal over chat. Opening Settings replaces the normal session sidebar with a settings-section sidebar and uses the rest of the window for the selected settings page. `Back to chat` is fixed at the bottom of that sidebar.

The section list is data-driven. v0.36.16 intentionally exposes only `General`; future Extensions, Skills, and other settings pages should be added as new sections without creating a new settings shell. The settings sidebar reuses the persisted normal sidebar width, and the General content column follows the persisted chat width.

## Backgrounds

Background images are enabled by default.

The settings screen contains:

- `Show background image` — master toggle that hides or restores the image without deleting custom choices.
- `Light background` — uses the bundled light Molten Forge image unless a custom light image is selected.
- `Dark background` — uses the bundled dark Molten Forge image unless a custom dark image is selected.
- `Choose…` — select a JPEG, PNG, WebP, or AVIF image for that theme.
- `Clear` — remove only the custom image for that theme and return to the bundled default.

Light and dark custom backgrounds are independent. Switching theme must never overwrite the other theme's custom background.

Custom image blobs are stored in IndexedDB rather than local storage so normal image sizes do not depend on the small local-storage quota. Local storage contains only lightweight appearance preferences.

If a stored custom image is missing or invalid, the app falls back to the bundled default for that theme rather than losing the rest of the appearance settings.

## Testing expectations

Appearance changes should cover as much deterministic behavior as practical with automated tests. At minimum, preserve coverage for:

- theme normalization and `System` resolution;
- persisted theme and background-visibility defaults/round-trips;
- supported and unsupported custom image formats;
- per-theme custom/default selection;
- master background disable behavior;
- validation of stored custom-background records;
- unavailable/corrupt storage fallbacks where they can be represented deterministically.

Keep storage/state selection logic in pure or narrowly scoped modules so it can be tested without rendering the whole application.

## Light-theme chrome parity

The old Electron Molten Forge light theme is still the reference for application chrome. In particular:

- the `Molten Forge` wordmark uses the normal foreground color in light theme; the molten gradient is dark-theme-only;
- ordinary session rows are transparent and borderless at rest, gain only a subtle hover fill, and use a subtle fill without an outline when selected;
- a grouped runtime block owns one shared surface. Nested Thinking/tool rows inside that group must remain transparent so the light theme never stacks mismatched card colors.

These are chrome/surface rules and are intentionally separate from Pi's semantic content colors below.

## Pi semantic content colors

Rendered chat content follows Pi's current built-in `dark` and `light` semantic theme tokens rather than using the same highlight colors in both themes. Molten Forge keeps its own glass/surface design, but the content language should feel like Pi:

- reasoning prose -> `thinkingText`;
- Markdown headings -> `mdHeading`;
- links -> `mdLink`;
- inline code -> `mdCode`;
- fenced-code base text -> `mdCodeBlock`;
- quotes/rules/list bullets -> their corresponding Pi Markdown tokens;
- CodeMirror syntax -> Pi's comment/keyword/function/variable/string/number/type/operator/punctuation tokens;
- tool title/output and diff added/removed/context -> Pi's corresponding semantic tokens.

Dark and light palettes are deliberately different. Do not introduce one fixed highlight color for both themes.


## Empty-session Pi startup header

A true empty session shows Pi's compact interactive startup copy instead of the old generic welcome card. Keep the wording aligned with Pi's current compact header. The runtime version comes from the installed `pi --version`. Skills, prompt templates, and extensions use the compact loaded-resource presentation and are derived from RPC `get_commands` metadata, including `sourceInfo` when Pi provides it.

RPC does not expose every resource shown by Pi's native TUI (for example an extension that registers no slash command). Settings explicitly separates filesystem discovery of conventional/explicitly configured resources from Pi-reported `get_commands` metadata; never label a discovered resource as loaded merely because a file exists. Tools browsing is based only on observed Pi events until RPC provides an authoritative registry.

## Settings tint and resources (v0.36.77)

The Settings main content surface uses a strong background tint (82% dark, 80% light), mirroring the old Electron strong-panel layering without blurring the entire workspace. Small Settings panels keep 16px backdrop blur. The Skills section uses the original Electron split workspace geometry (325px list pane and a separately scrolling detail pane) with read-only fields and an always-visible CodeMirror-backed SKILL.md viewer. It does not use the narrow General Settings card layout. Its header displays the skill name instead of Edit Skill, and the fixed bottom buttons support Reload and Open global folder. The Tools tab reports only agent tool calls observed in the current transcript, **not** Pi's full active tool registry (which RPC does not expose).

## Skills layout alignment (v0.36.78)

The read-only Skills list pane must use the same effective sidebar width as the first Settings sidebar, including responsive constraints. Its top search bar aligns with the 41px detail header, and its 48px bottom action row aligns with Settings’ Back to chat button. Footer actions are icon-only with tooltips and accessible names. The details form uses up to 800px of width. Both inline and portal `SKILL.md` CodeMirror viewers must wrap all lines and never show horizontal scrollbars; this behavior is **skills-only** and must not change chat code blocks. The expanded viewer uses a viewport-fixed portal and a compact borderless close button.

## Skills control polish (v0.36.79)

- Skills search explicitly suppresses the app-wide `input:focus` shadow and border transition, matching the original Electron picker’s uncluttered search style. The caret remains visible without an outline that overlaps the header.
- The two fixed footer buttons split the available row width evenly; icons remain centered and button text is exposed through accessible labels and hover tooltips.
- The Location folder action uses a single flat button with the same height as its readonly field, with the icon centered.
- Read-only skill description receives ~1.5 times the previous vertical allowance (112–158px vs 75–105px).
- The enlarged skill viewer uses the full viewport height less 16px on each side (`height: calc(100dvh - 32px)`), retaining fixed dialog header and internally scrolling CodeMirror.
- No Pi runtime changes and no changes to general chat code viewers.

## Idle and generation animation budget (v0.36.87)

The dark molten wordmark and in-chat `Composing` text retain their gradient colors but **never animate `background-position`**. The eight spinner leaves also retain a static gradient. Only the parent Radix spinner rotates (stepped `transform`). This avoids forcing the WebView2 renderer to continuously repaint gradient-clipped text and tiny leaf backgrounds. The initial startup/loading splash remains separately animated while starting.

A browser regression fixture exercises real production CSS in light/dark themes: `python tests/generation-animations.browser.py`. If adding an always-visible CSS animation later, first measure its impact on idle WebView2 GPU-process CPU usage on Windows.

## Content surface paint budget and streaming (v0.36.88–v0.36.89)

For both dark and light themes, **foreground** surfaces (agent bubbles,
Thinking/tool blocks, model/command popovers, settings cards, headers, and the
composer) use opaque theme tokens without `backdrop-filter`.
User-message bubbles are an intentional color/alpha exception: their historical
dark `rgba(52,55,59,.64)` and light primary-color 90%-opacity fills are
retained through `--app-glass-user-message`, without expensive backdrop blur.

**Full-height pane tints are different from foreground surfaces.** The app's
wallpaper (bundled or custom) is painted by `.app-shell` behind the content.
The chat, session sidebar, Settings and Skills workspace panes must keep
translucent theme-specific backgrounds so that wallpaper remains visible.
Chat and Settings main share the **same tint**: `--app-workspace-tint` aliases
`--app-settings-tint`, so changing the Settings tint changes chat identically
in dark and light themes. The sidebar uses `--app-sidebar-tint`, while Skills
subpanes use `--app-skills-tint` as only a subtle extra
tint inside the already-tinted Settings pane. Do not make them opaque and do not restore
costly `backdrop-filter`. The `.app-shell` image/vignette/overlay stays
translucent, and `Show background image` hides only the actual wallpaper.

Translucent hover highlights and modal dimmers are intentional. The initial
startup background alone retains `filter: blur(18px)` as a bounded effect.
Run `python tests/background-visibility.browser.py` to verify *actual screenshot
pixel differences* for image enabled/disabled in both themes; computed CSS
alpha alone is not sufficient to detect an occluded wallpaper.

The live transcript may receive many Pi text/thinking deltas per second. Merge
adjacent deltas belonging to the same message, kind, and content index for up
to 50 ms; non-delta RPC events remain ordered synchronous barriers. Do not
change transcript virtualization or scroll ownership to implement batching.
