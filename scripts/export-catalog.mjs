// Writes src-tauri/catalog.json from the shared JavaScript catalog, which stays
// the single source of truth for both the interface and the Rust backend.
// Run `npm run catalog` after editing shared/*.mjs; `--check` fails if stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { tweaks, guides, recoveryTweaks } from '../shared/catalog.mjs';
import { socials } from '../shared/socials.mjs';
import { powerControls, networkControls } from '../shared/power-settings.mjs';
import { wifiControls } from '../shared/wifi-settings.mjs';
import { keyboardShortcuts } from '../shared/keyboard-settings.mjs';
import { leanServices, backgroundApps } from '../shared/aggressive.mjs';
import { retiredTweakIds } from '../shared/retired-settings.mjs';
import { MEMORY_INTEGRITY_PATH } from '../shared/security-settings.mjs';
import { GAME_GPU_REGISTRY } from '../shared/game-preferences.mjs';
import { APP_VERSION } from '../shared/version.mjs';

const file = new URL('../src-tauri/catalog.json', import.meta.url);
// Only fields the backend uses; interface copy stays in JavaScript.
const definition = ({ id, name, admin, minBuild, proOnly, hardware, operations, power, requireAllPowerSettings, powerSettings, networkSettings, services, keyboardShortcuts, wifiSetting, nvidiaSettings }) =>
  ({ id, name, admin, minBuild, proOnly, hardware, operations, power, requireAllPowerSettings, powerSettings, networkSettings, services, keyboardShortcuts, wifiSetting, nvidiaSettings });
const catalog = {
  version: APP_VERSION,
  tweaks: tweaks.map(definition),
  recoveryTweaks: recoveryTweaks.map(definition),
  guides: guides.map(({ id, uri }) => ({ id, uri })),
  links: [...tweaks, ...guides, ...socials].filter(item => item.source).map(({ id, source }) => ({ id, source })),
  powerControls, networkControls, wifiControls, keyboardShortcuts, leanServices, backgroundApps, retiredTweakIds,
  memoryIntegrityPath: MEMORY_INTEGRITY_PATH, gameGpuRegistry: GAME_GPU_REGISTRY,
};
const text = JSON.stringify(catalog, null, 2) + '\n';
if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(file, 'utf8').replaceAll('\r\n', '\n'); } catch { /* reported below */ }
  if (current !== text) { console.error('src-tauri/catalog.json is stale. Run `npm run catalog`.'); process.exit(1); }
  console.log('Catalog export is current.');
} else {
  writeFileSync(file, text);
  console.log(`Wrote catalog.json: ${catalog.tweaks.length} tweaks, ${catalog.recoveryTweaks.length} recovery definitions.`);
}
