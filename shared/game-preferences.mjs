// Per-game GPU preferences saved by older versions remain restorable. The
// executable-path validation and recovery rules live in src-tauri/src/ops.rs.
export const GAME_GPU_REGISTRY = String.raw`HKCU:\Software\Microsoft\DirectX\UserGpuPreferences`;
