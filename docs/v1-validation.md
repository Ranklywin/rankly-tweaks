# v1.0.0 validation

Local release preparation on 2026-09-25, Windows 10 build 19045, x64:

- `npm test`: 92 passed, 0 failed, 0 skipped. Windows setters were exercised only
  through isolated registry fixtures, stubbed commands, or disposable processes.
  No gaming tweaks were applied to the host.
- `npm run check:release`: package/lockfile versions, dependency pins, required
  documents, and bundled library license copies passed.
- `npm run package`: TypeScript, Vite, and portable Electron packaging passed.
- `npm run verify:package`: 40 bundled source/build files matched the workspace;
  license copies and runtime notices were present; both launcher and application
  executable requested administrator access.
- `npm run checksums`: generated SHA256SUMS.txt for the completed executable.
- npm dependency audit reported no known vulnerabilities during preparation.
- Custom dropdowns were checked in the browser for mouse selection, arrow keys,
  typeahead, Escape, Tab, click-outside dismissal, and dark/light themes.

The basic pre-publication scan checks common credential patterns and personal
paths. It is not a comprehensive independent security audit.

GitHub's Linux/Windows CI results are recorded on the repository's Actions page
after push; the checks above describe local results. Real gaming benchmarks and
broader Windows 11 / driver / hardware validation have not been performed here.
The executable is unsigned. These limitations are disclosed in README and the
release notes.
