# Releasing

## One-time setup

Installed copies only accept updates signed with Rankly's updater key.

1. Keep the private key from `%USERPROFILE%\.tauri\rankly-tweaks.key` in a password
   manager. If it is lost, installed copies can no longer be updated in-app.
2. Add it to GitHub → Settings → Secrets and variables → Actions as
   `TAURI_SIGNING_PRIVATE_KEY`, and its password (empty if none) as
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. The matching public key is in `src-tauri/tauri.conf.json`. Replace both only
   before the first Tauri release; afterwards a new key strands existing installs.

## Each release

1. Update the version in `package.json`, the root lockfile, and
   `src-tauri/Cargo.toml` (then `cargo update -p rankly-tweaks --manifest-path src-tauri/Cargo.toml`),
   plus the changelog and release notes.
2. Run `npm ci`, `npm test`, `npm run test:rust`, and `npm run check:release`.
3. On Windows, run `npm run package`, `npm run verify:package`, and `npm run checksums`.
4. When the owner explicitly requests publication, push the matching version tag.
   GitHub Actions runs the checks and creates a draft with the installer, its
   update signature, `latest.json`, and the checksum.
5. Verify the draft's files and checksum, then publish when authorized.
   Installed copies see the update only after publishing: the updater reads
   `latest.json` from the latest published release, which skips drafts and
   prereleases.

Keep binaries and secrets out of Git. The installer is not Authenticode-signed
yet, so keep the unsigned notice. Test real system changes only on an authorized
disposable machine.
