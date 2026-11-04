# Appearance and background behavior

This document is the source of truth for theme and background behavior in Molten Forge.

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

The wallpaper overlay slider and both theme-specific background pickers are
separated by the same subtle row dividers in dark and light themes.

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

**Full-height shell surfaces (Phase 4.2.2).** Chat and Settings now share
one solid workspace color (`--app-workspace-tint`, mirrored by
`--app-settings-tint`). As of Phase 4.4 dark mode uses the computed OpenCode
V2 `bg-base: #1d1e19`, while the sidebar and frame use V2 `bg-deep:
#191a15`. The chat title, telemetry and Settings section headings live in the
solid top strip above the inset pane (Phases 4.3–4.3.2), without a redundant
separator; the transcript starts at the top of the inset panel.

The selectable wallpaper is drawn *inside* chat and Settings panes (under a
workspace tint) when enabled without the overlay, not on `.app-shell`.
This prevents the old wallpaper/blue-gradient/shadow from showing in the 6px
outer frame. When the topmost image overlay is active, the pane wallpaper is
suppressed, so the image is drawn only once. Sidebars and gutters remain solid;
Skills interior tints can still be subtly translucent over the Settings pane.
This is specific to connected workspaces: the initial launcher/startup background
behavior is preserved. The settings UI now follows the same inset panel, border,
sidebar and header treatment as chat.

Translucent hover highlights and modal dimmers are intentional. The initial
startup background alone retains `filter: blur(18px)` as a bounded effect.
Run `python tests/background-visibility.browser.py` to verify *actual screenshot
pixel differences* for image enabled/disabled in both themes; computed CSS
alpha alone is not sufficient to detect an occluded wallpaper.

The live transcript may receive many Pi text/thinking deltas per second. Merge
adjacent deltas belonging to the same message, kind, and content index for up
to 50 ms; non-delta RPC events remain ordered synchronous barriers. Do not
change transcript virtualization or scroll ownership to implement batching.


## OpenCode-inspired workspace shell (Phase 4.2)

The normal chat workspace is intentionally inset from the window frame, like
OpenCode Desktop v2.2.2. Its panel begins below a 40px outer title strip,
with 6px right/bottom gutters, a 10px corner radius and a faint outer edge.
The project sidebar remains full-height, with no continuous dividing rail or
header/footer rules; session selection uses a fill rather than an outline.
When collapsed, the chat panel also gains a 6px left gutter. The fixed window
controls stay in the top strip. Sidebar resizing and persisted widths are not
modified.

Phase 4.2.2 correction: OpenCode Desktop's *computed* dark Monokai colors
were captured from DevTools. `--background-base` is `#161712`,
`--surface-raised-base` is `#1e1f1a`, `--surface-base` is `#252621`,
`--surface-weak` is `#2c2d28`, `--border-weaker-base` is `#373732`,
and `--text-base` is `#f8f8f2`. The earlier `#272822` value belongs to
the original syntax palette and is not the dark application background.
Settings shares the inset chat panel styling. The warm light palette remains
as previously approved. Pi syntax/semantic colors and the historical user
bubble palette remain unchanged. Browser tests check that wallpaper is scoped
to workspaces, inactive gutters contain no wallpaper, and the separate header
strip is opaque and divided from the wallpaper pane with a 1px rule.

Do not add `overflow: hidden` to `.chat-pane`: the transcript must remain the
only scrolling ancestor for sticky CodeMirror toolbars. Browser regression
checks: `tests/monokai-shell.browser.py` and
`tests/background-visibility.browser.py`.

## OpenCode V2 Monokai surface relationships (Phase 4.4)

For the dark theme, use the **computed V2** color scale from OpenCode
v2.2.2 rather than the older syntax/theme `--surface-*` palette when
painting the window shell and composer:

- Shell / sidebar: `--mf-surface-shell` → `#191a15` (`--v2-grey-1100`).
- Chat / Settings workspace: `--mf-surface-workspace` → `#1d1e19` (`--v2-grey-1000`).
- Composer: `--mf-surface-composer` → `#282923` (`--v2-grey-800`), raised above the chat base.
- Composer outline: `--mf-surface-composer-border` → `#373732`, the subtle Monokai edge.

These are deliberately **opaque** surfaces, not independent semi-transparent
tints that should be multiplied on top of each other. The wallpaper overlay
uses the single rendering path described below (Phase 4.4.1); there is no
separate gradient-backed wallpaper mode at 0%. Keep the previous light-theme
palette and styling unchanged. Do not apply these values to Pi's semantic
syntax colors or to foreground cards (`--app-glass-medium`).

## Continuous wallpaper opacity and shared compositing (Phase 4.4.2)

The 0–25% wallpaper slider uses one rendering path at every value, including
0%. The connected application shell owns one non-interactive `::after` layer
with `opacity: var(--mf-wallpaper-overlay-opacity, 0)` above the entire UI,
including the solid shell, chat/Settings panels, titlebar and floating composer.
This matches OpenCode's wallpaper plugin effect: opaque neutral surfaces beneath
one subtle image tint. The slider **does not** change the alpha of any control.
At 0% no wallpaper is painted; 1% produces a small continuous change.

Keep this image overlay independent of transcript virtualization, sticky
headers, scrolling and model controls. `Show background image` hides the image
without resetting the slider or replacing theme wallpaper selections. The
composer remains a solid raised `#282923` Monokai surface beneath the image,
which prevents it from looking much darker than the reference. The light-theme
neutral surface colors remain unchanged. Test with
`tests/wallpaper-opacity.browser.py` and `tests/background-visibility.browser.py`.

## Default wallpaper intensity (Phase 4.4.3)

New installations and users without a stored overlay preference start at 10%.
Previously stored settings, including explicit 0%, are never overwritten.
`readWallpaperOverlayPercent` in `src/core/appearance.ts` handles missing, malformed,
and unavailable browser storage; the Settings slider remains 0–25%.
