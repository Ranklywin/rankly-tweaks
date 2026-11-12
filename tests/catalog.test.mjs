import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tweaks, guides, recoveryTweaks } from '../shared/catalog.mjs';
import { socials } from '../shared/socials.mjs';

test('the Rust backend reads the current catalog export', () => {
  // Fails when shared/*.mjs changed without `npm run catalog`.
  execFileSync(process.execPath, ['scripts/export-catalog.mjs', '--check'], { stdio: 'pipe' });
  const exported = JSON.parse(readFileSync('src-tauri/catalog.json', 'utf8'));
  assert.deepEqual(exported.tweaks.map(t => t.id), tweaks.map(t => t.id));
  assert.equal(exported.recoveryTweaks.length, recoveryTweaks.length);
});

test('every tweak has unique IDs and the copy the interface shows', () => {
  assert.equal(new Set(tweaks.map(t => t.id)).size, tweaks.length);
  for (const t of tweaks) {
    for (const field of ['name', 'category', 'icon', 'tag', 'impact', 'description', 'detail', 'tradeoff', 'restart']) {
      assert.ok(typeof t[field] === 'string' && t[field].trim(), `${t.id} is missing ${field}`);
    }
    if (t.source) assert.match(t.source, /^https:\/\//, `${t.id} source must use https`);
  }
});

test('guides open Windows Settings pages and external links use https', () => {
  for (const g of guides) assert.match(g.uri, /^ms-settings:[a-z-]+$/, g.id);
  for (const s of socials) assert.match(s.source, /^https:\/\//, s.id);
});

test('the updater only trusts this repository and a configured key', () => {
  const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  assert.deepEqual(config.plugins.updater.endpoints, ['https://github.com/Ranklywin/rankly-tweaks/releases/latest/download/latest.json']);
  assert.match(config.plugins.updater.pubkey, /^[A-Za-z0-9+/=]{100,}$/);
  assert.equal(config.bundle.createUpdaterArtifacts, true);
  const capability = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8'));
  assert.ok(!capability.permissions.some(p => /^(shell|fs|http):/.test(typeof p === 'string' ? p : p.identifier)), 'The interface gets no shell, file system, or HTTP access.');
});
