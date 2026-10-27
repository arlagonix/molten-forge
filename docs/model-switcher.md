# Model switcher

The composer model label is an interactive model picker. It is a thin UI over Pi's existing model RPCs; Molten Forge does not maintain a separate model registry or invent provider/model state.

## Opening the picker

- Clicking the current model opens a popover above the composer.
- Opening the popover silently requests `get_available_models` so the menu reflects Pi's current configured models.
- A compact searchbar stays pinned at the top of the popover and filters by provider, model id, or `provider/id`.
- The popover groups matching models by `provider`; provider groups and model rows are sorted for stable scanning.
- Exact duplicate `provider/id` rows are suppressed.
- Escape and pointer input outside the popover close it.
- Picker open/close state is local to the memoized `ModelSwitcher`, not root `App`, so merely browsing models does not rerender the transcript.

## Selecting a model

Selection sends Pi's normal RPC:

```json
{ "type": "set_model", "provider": "…", "modelId": "…" }
```

The request is sent with Molten Forge's `silent` request flag. This is important: clicking a model is application chrome, not conversation content. A successful switch must therefore not append a user message, system notice, or model tool block to the transcript.

Pi's `set_model` response remains the source of truth. On success the existing response handler:

- updates `currentModel`;
- stores the preferred provider/model locally;
- asks the Tauri bridge to persist the Pi default model;
- refreshes context/session statistics.

The ordinary typed `/model …` command continues to use the same `set_model` RPC shape, but typed commands retain their existing transcript behavior. The click picker bypasses `submitRaw()` specifically so it cannot create a user chat message.

## Rendering

- The current model id is the compact trigger shown beside the context ring.
- The popover opens upward so it stays attached to the composer footer.
- Each provider has a heading and its models beneath it.
- Each model row is intentionally one line and shows only the model id plus selection state; friendly-name descriptions are hidden to maximize list density.
- The selected model receives a check mark.
- Dark and light themes both have explicit popover/hover colors.

## Regression requirements

When changing this behavior, keep tests for:

- provider grouping and sorting;
- duplicate/incomplete records;
- full-key/id/display-name matching used by `/model`;
- exact `set_model` RPC construction;
- silent click-to-switch integration;
- local popover state rather than root-App state;
- search filtering by provider/id and search reset on close;
- compact one-line rows without friendly-name descriptions;
- provider headings;
- Escape/outside-click dismissal;
- ArrowUp/ArrowDown keeping the highlighted option visible without hover-triggered scrolling;
- no plain non-interactive model label replacing the picker.

## Keyboard behavior

- The search field has no focus ring; opening the picker should not add a second highlighted border around the search surface.
- One visible model is always treated as the keyboard-highlighted option while the picker is open.
- Typing a search query moves the highlight to the first matching model.
- `ArrowDown` and `ArrowUp` move the highlight through the filtered list and wrap at the ends.
- Keyboard highlight movement must keep the newly highlighted row visible inside the model-list scroll container using nearest-style list scrolling that accounts for the sticky provider heading. This prevents the highlight from moving off-screen in long provider/model lists without moving the outer page.
- Hovering a model moves the same highlight used by keyboard selection, but pointer hover must not auto-scroll the list.
- `Enter` selects the highlighted model through the same silent `set_model` path as a pointer click.
- `Escape` closes the picker without switching models.
