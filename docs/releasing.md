# Releasing

1. Update `package.json`, the root lockfile version, changelog, and release notes.
2. Run `npm ci`, `npm test`, and `npm run check:release`.
3. On Windows, run `npm run package`, `npm run verify:package`, and `npm run checksums`.
4. When the owner explicitly requests publication, push the matching version tag.
   GitHub Actions runs the checks and creates a draft with the executable and checksum.
5. Verify the draft's files and checksum, then publish when authorized.

Keep binaries and secrets out of Git. Keep the unsigned notice until signing is
implemented. Test real system changes only on an authorized disposable machine.
