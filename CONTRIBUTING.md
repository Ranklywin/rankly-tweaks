# Contributing

Use Node.js 24 and `npm ci`. Run `npm test`, `npm run check:release`, and
`npm run build` before sending a pull request. Windows packaging instructions are
in README. `tests/ui/tweaks.html` provides a mock UI without Windows changes.

For a new control, include:

- A specific user problem and primary-source documentation. Registry folklore and
  unmeasured FPS claims are insufficient.
- Checks for supported Windows builds, editions, hardware, drivers, and original
  values. Unknown support must fail closed.
- Exact backup and recovery behavior, including absent values and removed devices.
- A narrow allowlist, verification after writes, and meaningful failure/rollback
  tests. Use mocks or isolated fixtures rather than applying tweaks to a real PC.
- Clear tradeoffs and restart requirements using the existing UI.

Keep unrelated changes out of the pull request. Do not include reports, credentials,
personal paths, recovery journals, downloaded executables, or build artifacts.
When dependencies change, run `npm run notices:update` and commit the updated
licenses, notices, and lockfile. Contributions are under the project's MIT license.

Bug reports should include the app version, Windows build/edition, relevant hardware
and driver versions, expected/actual behavior, and a minimal reproduction. Review
logs before sharing and redact private paths or identifiers. Report security issues
according to SECURITY.md.
