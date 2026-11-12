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
// The Rust crate and Tauri bundle must ship the same version as package.json.
const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8');
assert.equal(/^version = "([^"]+)"/m.exec(cargo)?.[1], APP_VERSION, 'src-tauri/Cargo.toml version must match package.json.');
const tauriConfig = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
assert.equal(tauriConfig.version, '../package.json', 'tauri.conf.json must read its version from package.json.');
assert.match(tauriConfig.plugins.updater.pubkey, /^[A-Za-z0-9+/=]{100,}$/, 'Set the updater public key in tauri.conf.json.');
assert.ok(readFileSync('src-tauri/Cargo.lock', 'utf8').includes('name = "tauri"'), 'Commit src-tauri/Cargo.lock.');
const integrityByURL = new Map();
for (const entry of Object.values(lock.packages)) {
  if (!entry.resolved || !entry.integrity) continue;
  const prior = integrityByURL.get(entry.resolved);
  if (prior) assert.equal(entry.integrity, prior, `Conflicting checksums for ${entry.resolved}`);
  integrityByURL.set(entry.resolved, entry.integrity);
}
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
