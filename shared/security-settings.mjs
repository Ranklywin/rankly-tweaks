// Memory Integrity support checks and restart-pending states live in the Rust
// backend (src-tauri/src/ops.rs). This path is shared with the catalog.
export const MEMORY_INTEGRITY_PATH = String.raw`HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity`;
