# Contributing

Use Node.js 24 and `npm ci`. Before opening a pull request, run:

```sh
npm test
npm run check:release
npm run build
```

New tweaks need evidence, support checks, backup/recovery, and meaningful tests.
Keep the existing UI style. Test with mocks or a disposable VM, not your daily PC.

For bugs, include the app version, Windows version, and steps to reproduce.
Keep secrets and personal reports out of commits and issues.
Dependency changes must include the lockfile and updated notices
(`npm run notices:update`). Contributions use the MIT license.
