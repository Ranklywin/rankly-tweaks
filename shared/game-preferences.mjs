// Recovery-only support for per-game GPU changes saved by older versions.
export const GAME_GPU_ID = 'game-gpu-preference';
export const GAME_GPU_REGISTRY = 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences';

// The dynamic allowlist is limited to local desktop executable value names in
// one graphics key. It cannot address a registry key or an arbitrary setting.
export function isLocalGameExecutable(value) {
  if (typeof value !== 'string' || value.length > 16383 || !/^[a-z]:\\/i.test(value) || !/\.exe$/i.test(value)) return false;
  const parts = value.slice(3).split('\\');
  return parts.length > 0 && parts.every(part => part.length > 0 && !/[\x00-\x1f<>:"/|?*]/.test(part) && !/[ .]$/.test(part) && part !== '.' && part !== '..' && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

export const gamePreferenceRecovery = Object.freeze({ id: GAME_GPU_ID, name: 'Game GPU preference', gamePreference: true });

export function gamePreferenceDefinition(game) {
  if (!game || !isLocalGameExecutable(game.path)) throw new Error('The saved GPU preference must target a local .exe.');
  const name = typeof game.name === 'string' && game.name.trim() ? game.name.trim().slice(0, 160) : game.path.split('\\').at(-1);
  return {
    ...gamePreferenceRecovery,
    name: `${name} · High performance GPU`,
    gamePath: game.path,
    operations: [{ path: GAME_GPU_REGISTRY, name: game.path, kind: 'String', value: 'GpuPreference=2;', transform: 'semicolon' }],
  };
}

export function isGamePreferenceOperation(operation) {
  return operation.type === 'registry' && operation.path === GAME_GPU_REGISTRY && isLocalGameExecutable(operation.name);
}

export function gameRecoveryDefinitions(entry) {
  if (!Array.isArray(entry.ids) || !entry.ids.includes(GAME_GPU_ID)) return null;
  if (entry.format !== 2 || entry.ids.length !== 1 || !isLocalGameExecutable(entry.gamePath)) throw new Error('The game preference backup has an invalid target.');
  return [gamePreferenceDefinition({ path: entry.gamePath })];
}
