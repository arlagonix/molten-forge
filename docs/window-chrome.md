# Window chrome and startup loading

This document is the source of truth for the frameless desktop chrome and initial loading screen in Molten Forge Pi.

The visual reference is the old Electron Molten Forge implementation. The wrapper should not add a second dedicated title-bar row above the application. Instead, the existing top rows are the title bar:

- the normal chat/sidebar header even before Pi is connected;
- the sidebar title row while the sidebar is visible;
- the chat header for the main content column.

The Tauri window uses `decorations: false`. A compact three-button control cluster is fixed at the top-right and provides minimize, maximize/restore, and close. Interactive controls inside draggable title rows must remain non-draggable.

The visual title-bar height is 41 px. Window controls are 32 px tall and sit 4 px from the top, matching the old Molten Forge proportions.

## Startup loading screen

Initial application hydration uses the old Molten Forge loading treatment instead of briefly showing partially initialized UI.

- Resolve the persisted System/Light/Dark theme before the first visible application frame when possible.
- Load the theme-specific custom background from IndexedDB, falling back to the bundled Molten Forge background.
- Respect `Show background image`; when disabled, the loading screen uses the theme background color only.
- Preload the selected image and fade it in only after the image has settled.
- Render the background blurred and slightly oversized so blur never exposes the image edges.
- Apply a dark/light theme-specific scrim over the image.
- Center the old Molten Forge `Loading...` label. In dark mode it uses the larger semibold molten orange animated gradient; in light mode it uses a subdued foreground-color opacity pulse.
- Respect `prefers-reduced-motion` by disabling the text/fade animations while keeping a readable static state.
- Keep the custom window controls and a draggable top region available while loading.

The startup screen ends only after the Tauri/Pi bridge initialization, Pi availability check, and custom-background hydration have all settled. Runtime chat/session loading uses the existing in-app loading treatment rather than remounting the full startup screen.

## No-project empty state

The separate launcher was removed in v0.36.75. The standard sidebar and chat
layout are always available after startup hydration. On first launch (without a
saved folder), the chat area shows a minimal **No project open** state with an
Open Folder action. The Settings button remains accessible. Clicking a project
starts Pi in that directory and restores its last selected conversation.

On later launches, the saved working directory is restored once after Pi bridge
initialization. Missing/renamed folders leave the interface open and surface a
path-specific error without entering a launcher loop. The regular blurred
startup loading screen remains unchanged; it is not a project picker.
