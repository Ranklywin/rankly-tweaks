// Writes release/latest.json, the file installed copies check for updates.
// It points at this version's installer on its GitHub release and carries the
// installer's signature, which the app verifies with its built-in public key.
import { readFileSync, writeFileSync } from 'node:fs';
import { APP_VERSION } from '../shared/version.mjs';

const installer = `Rankly-Tweaks-${APP_VERSION}-setup.exe`;
const signature = readFileSync(`release/${installer}.sig`, 'utf8').trim();
if (!signature) throw new Error('The installer signature is empty. Build with the updater signing key.');
const notes = readFileSync('RELEASE_NOTES.md', 'utf8').replaceAll('\r\n', '\n').trim();
const platform = { signature, url: `https://github.com/Ranklywin/rankly-tweaks/releases/download/v${APP_VERSION}/${installer}` };
const manifest = { version: APP_VERSION, notes, pub_date: new Date().toISOString(), platforms: { 'windows-x86_64-nsis': platform, 'windows-x86_64': platform } };
writeFileSync('release/latest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote release/latest.json for v${APP_VERSION}.`);
