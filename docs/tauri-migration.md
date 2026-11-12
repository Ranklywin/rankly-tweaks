# Tauri migration

Rankly Tweaks moved from Electron to Tauri 2 with a Rust backend. The React
interface is unchanged apart from update installation and the title bar.

## Layout

| Area | Location |
| --- | --- |
| Interface | `src/` (React). `src/bridge.ts` maps the existing `window.rankly` API to Tauri commands. |
| Catalog and interface data | `shared/*.mjs`, still the single source of truth. `npm run catalog` exports the backend's copy to `src-tauri/catalog.json`; `check:release` and the tests fail if it is stale. |
| Backend | `src-tauri/src/`: `ops.rs` (resolution, allowlists, backup validation), `engine.rs` (journal, apply, rollback, restore), `scripts.rs` (PowerShell generation), `system.rs` (Windows reads), `apps.rs` (background apps), `lib.rs` (commands). |
| PowerShell | `src-tauri/scripts/*.ps1` templates. Rust fills in quoted catalog data only. |

Commands accept tweak IDs, backup IDs, app tokens, settings IDs, and fixed test
targets, never scripts, paths, or URLs. The interface has no shell, file system,
or HTTP permission.

## Behavior kept identical

Before the JavaScript backend was removed, it was used to record golden fixtures
(`src-tauri/tests/fixtures/parity.json.gz`, about 5,700 cases): tweak resolution
across 36 hardware and Windows contexts, availability reasons, snapshot
materialization, equality, the allowlist, backup validation including tampered
backups, security states, journal parsing, background-app scans, and the exact
generated PowerShell for every operation type. `cargo test` requires the Rust
port to match all of them, including error messages and script text byte for byte.

The recovery journal stays at `%APPDATA%\rankly-tweaks\recovery.json` in the same
format. `electron-journal.json` is a journal written by the Electron engine; a
test restores it through the Rust engine and checks the exact original state.

Engine behavior from the old JavaScript suite (durable backup before writes,
rollback of partial batches, failed-rollback blocking, verification, reverse
restore order, interrupted transactions, legacy backups, concurrent changes) is
covered by `src-tauri/tests/engine.rs`. `src-tauri/tests/windows.rs` runs the real
generated PowerShell against a disposable registry key and, with `--ignored`,
performs a read-only scan of the machine.

## Distribution and updates

Rankly now ships as an NSIS installer instead of a portable executable. Release
builds request administrator access, as before. The updater reads `latest.json`
from the latest published GitHub release and installs only after verifying the
installer's signature with the public key built into the app. See
[releasing.md](releasing.md) for key handling.

Interface preferences (theme, update checks) were stored by Electron's browser
engine and start at their defaults once after upgrading. Recovery backups are
unaffected.
