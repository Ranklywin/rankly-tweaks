import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../shared/version.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
assert.equal(lock.version, APP_VERSION);
assert.equal(lock.packages[''].version, APP_VERSION);
assert.equal(pkg.license, 'MIT');
assert.equal(lock.packages[''].license, pkg.license);
assert.equal(pkg.repository.url, 'https://github.com/ranklywin/rankly-tweaks.git');
for (const [name, version] of Object.entries(pkg.devDependencies)) {
  assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, `Pin ${name} to an exact version.`);
  assert.equal(lock.packages[''].devDependencies[name], version);
  assert.equal(lock.packages[`node_modules/${name}`].version, version);
}
if (process.env.GITHUB_REF?.startsWith('refs/tags/')) {
  assert.equal(process.env.GITHUB_REF, `refs/tags/v${APP_VERSION}`, 'Release tag must match package.json.');
}
for (const file of ['LICENSE', 'README.md', 'CHANGELOG.md', 'RELEASE_NOTES.md', 'SECURITY.md', 'CONTRIBUTING.md']) {
  assert.ok(readFileSync(file, 'utf8').trim(), `Missing ${file}`);
}
assert.ok(readFileSync('CHANGELOG.md', 'utf8').includes(`## ${APP_VERSION}`));
assert.ok(readFileSync('RELEASE_NOTES.md', 'utf8').includes(`v${APP_VERSION}`));
console.log(`Release metadata verified: v${APP_VERSION}.`);
