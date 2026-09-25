# Releasing Rankly

The public version starts at **1.0.0**. Historical numbers in research notes refer
to local development builds. `package.json` is the version source used by both
the renderer and Windows backend through `shared/version.mjs`.

1. Update the version in `package.json` and regenerate the lockfile with
   `npm install --package-lock-only --ignore-scripts`. Update CHANGELOG, README, and
   RELEASE_NOTES for the release. Keep versions as `major.minor.patch`.
2. Run `npm ci`, `npm test`, and `npm run check:release`. Native Windows tests use
   isolated keys/processes and stubbed setters, not live gaming tweaks.
3. On Windows x64, run `npm run package`, `npm run verify:package`, and
   `npm run checksums`. The verifier compares bundled source, checks license
   files, and reads both executable manifests without launching the program.
4. Review support claims and known limitations. Document real hardware and Windows
   builds tested; CI alone is not evidence of FPS improvement or Windows 11 driver
   compatibility. Test real apply/recovery only in a designated disposable VM or
   test machine, with its owner's authorization.
5. Commit source and push the release tag (for this release, `v1.0.0`). The tag must
   match `package.json`. CI produces the executable and checksum; the release job
   creates a draft containing those exact artifacts.
6. Check the Actions run and draft assets, then publish the draft. GitHub source
   archives do not contain a packaged app. Keep binary releases out of Git.

The initial public repository is https://github.com/ranklywin/rankly-tweaks.
Enable private vulnerability reporting in the repository Security settings.
GitHub Actions has read-only permissions except for the draft-release job on a
version tag. Pull requests cannot publish releases.

Code signing is not configured. Preserve the unsigned notice until signing is
actually implemented and verified. Do not commit certificates or tokens.
