// Builds the signed-update NSIS installer and copies it to release/.
// The updater private key never lives in this repository: CI passes it as a
// secret, and local builds read %USERPROFILE%\.tauri\rankly-tweaks.key.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_VERSION } from '../shared/version.mjs';

const env = { ...process.env };
const localKey = path.join(os.homedir(), '.tauri', 'rankly-tweaks.key');
if (!env.TAURI_SIGNING_PRIVATE_KEY && existsSync(localKey)) {
  env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(localKey, 'utf8').trim();
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= '';
}
// Run the Tauri CLI directly so arguments are passed without shell quoting.
const cli = createRequire(import.meta.url).resolve('@tauri-apps/cli/tauri.js');
const args = [cli, 'build', '--bundles', 'nsis'];
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  console.warn('No updater signing key found: building without update signatures. Installed copies cannot auto-update from this build.');
  args.push('--config', JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
}
const result = spawnSync(process.execPath, args, { stdio: 'inherit', env });
if (result.status !== 0) process.exit(result.status ?? 1);

const bundle = 'src-tauri/target/release/bundle/nsis';
const installer = readdirSync(bundle).find(file => file.endsWith(`_${APP_VERSION}_x64-setup.exe`));
if (!installer) throw new Error(`No installer for ${APP_VERSION} in ${bundle}.`);
mkdirSync('release', { recursive: true });
const name = `Rankly-Tweaks-${APP_VERSION}-setup.exe`;
copyFileSync(path.join(bundle, installer), path.join('release', name));
if (existsSync(path.join(bundle, `${installer}.sig`))) copyFileSync(path.join(bundle, `${installer}.sig`), path.join('release', `${name}.sig`));
console.log(`Packaged release/${name}`);
