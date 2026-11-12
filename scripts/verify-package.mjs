// Checks the packaged build: installer, update signature, and that the app
// executable requests administrator access (read from its manifest resource).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { APP_VERSION } from '../shared/version.mjs';

const installer = `release/Rankly-Tweaks-${APP_VERSION}-setup.exe`;
assert.ok(existsSync(installer) && statSync(installer).size > 0, `${installer} is missing.`);
if (!process.argv.includes('--allow-unsigned-updates')) assert.ok(existsSync(`${installer}.sig`), 'The installer has no updater signature. Build with the signing key.');
const exe = 'src-tauri/target/release/rankly-tweaks.exe';
assert.ok(existsSync(exe), `${exe} is missing.`);
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/verify-manifest.ps1', exe], { stdio: 'inherit' });
console.log(`Package verified: ${installer}`);
