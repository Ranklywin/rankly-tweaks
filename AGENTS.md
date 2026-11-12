# Project instructions

## Writing

- Keep the README, release notes, and user-facing explanations short and simple.

## Backend

- The Windows backend is Rust in `src-tauri/`. `shared/*.mjs` stays the source of
  the catalog; run `npm run catalog` after changing it.
- Behavior changes to resolution, backups, or generated PowerShell must update the
  Rust tests deliberately; the parity fixtures record the original behavior.

## UI iteration

- Always launch or reuse a visible browser preview when iterating on the UI.
- Use the simulated Windows fixture at `/tests/ui/tweaks.html` for UI work so
  preview interactions do not apply tweaks to the user's PC.
- Leave the preview open for the user to review. Launch the desktop app only
  when the user explicitly requests it.

## GitHub publishing

- Do not push commits or tags, upload files, or publish anything to GitHub unless
  the user explicitly tells you to do so for that update.
- Permission to edit, build, test, or prepare a release does not authorize a
  GitHub upload. Keep changes local until publication is explicitly requested.
- Do not reuse approval for a previous release as permission to publish later
  updates.
