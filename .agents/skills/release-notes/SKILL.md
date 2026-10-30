---
name: release-notes
description: Write and audit Molten Forge release notes in the established Features / Changes / Fixes style. Use when preparing a version release, GitHub Release body, changelog entry, or release summary.
---

# Molten Forge release notes

Produce readable, evidence-backed notes for a Molten Forge release. This is a **writing skill**, not permission to modify application behavior or publish a release.

## Source of truth

1. Read `AGENTS.md`, `docs/releasing.md`, the prior release note(s), `CHANGELOG.md`, and the source diff / tests / relevant feature documents.
2. Describe **changes that actually shipped** since the last release. Avoid treating a proposed design, test-only intent, stale document, or historical feature as newly implemented.
3. For major architectural releases, explain the migration and compatibility implications, separating newly added capabilities from inherited UI behavior.
4. Flag unknown behavior or unverified runtime/build claims; do not invent benchmarks, fixes, test counts, or migrations.

## Output format (strict)

- Start with `# Molten Forge X.Y.Z` and at most one short overview paragraph.
- Use these second-level headings, **in order**, when applicable: `## Features`, `## Changes`, `## Fixes`. Do not add empty sections.
- Within each heading, group bullets under concise `### Area` headings, such as `Backgrounds`, `Code Blocks`, `Interface`, `Settings`, `Chat Navigation`, or `Chat Performance`.
- Each bullet starts with `* **Past-tense, user-facing summary**. ` followed by exactly one inline code tag: `feature`, `change`, or `fix` matching the parent section.
- Continue on the next line with **two-space-indented prose**, typically 1–2 short sentences explaining what changed and the effect on users. A second indented line is allowed for meaningful specifics.
- Use precise descriptions, not marketing, congratulatory language, or unexplained technical jargon.
- Prefer behavioral impact over implementation details, but mention implementation when it explains an observable improvement (e.g., CodeMirror or Pi queue semantics).
- Keep related items grouped. Avoid repeating the same change under different headings.
- The heading and category alone distinguish meaning; the tag is still required on every bullet as shown.
- Include `## Upgrade Notes` only if a manual step, breaking change, installation migration, or important compatibility caveat exists. Don't label an untested upgrade as seamless.

## Example

```markdown
## Fixes

### Chat Navigation

* **Preserved conversation position when returning from Settings**. `fix`
  Opening Settings and returning to a chat now restores its previous reading position.
  Running conversations remain independent of the Settings view.
```

## Validation before publishing

- Verify every major claim against actual changed code, tests, or maintained documentation.
- Compare feature behavior to the previous released baseline, not an arbitrary earlier prototype.
- Preserve names/casing: **Molten Forge** for the app; **Pi** for its runtime; **Steer**, **Follow-up**, **CodeMirror** for named features.
- Verify `package.json`, both lockfiles, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` have coherent release versions. Do not alter unrelated Cargo dependency checksums.
- Write canonical notes at `docs/releases/vX.Y.Z.md`. Add only a short link in `CHANGELOG.md`; README points to both.
- State build/test limitations separately in the handoff summary; release notes must not falsely assert CI or Windows verification.
- Never tag, push, or publish without explicit authorization.
