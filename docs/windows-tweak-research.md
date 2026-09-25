# Windows gaming tweak research

Reviewed September 25, 2026. Scope: Windows settings useful for gaming, with Fortnite as context. No game configuration edits or third-party scripts are included.

This document records the earlier 1.9.0 additions. See the [follow-up gap review](gaming-tweak-gap-review.md) for the subsequent catalog comparison, keyboard shortcut addition, and current focused validation.

## GitHub projects inspected

- [FR33THY Ultimate](https://github.com/FR33THYFR33THY/Ultimate): reviewed the power-plan, NVIDIA settings, and presentation-mode scripts. Its [power-plan script](https://github.com/FR33THYFR33THY/Ultimate/blob/main/6%20Windows/29%20Power%20Plan.ps1) includes active cooling. Existing Rankly controls already cover much of its CPU, PCIe, capture, and input functionality.
- [ArtReeX optimized power scheme](https://github.com/ArtReeX/optimized-power-scheme/blob/main/Optimize%20Power%20Scheme.cmd): inspected cooling, AHCI, and NVMe setting identifiers. Its NVMe entries are commented-out examples; Rankly's chosen values come from Microsoft's performance-scheme documentation, not those examples.
- [Chris Titus Tech WinUtil](https://github.com/ChrisTitusTech/winutil/blob/main/config/tweaks.json): compared the current catalog with general Windows background-activity, power, and capture controls.
- [Sophia Script](https://github.com/farag2/Sophia-Script-for-Windows): reviewed its feature scope; desktop customization and debloating are not themselves evidence of game performance gains.
- [OpenTweak's MMCSS guidance](https://github.com/SwisserDev/OpenTweak/blob/main/docs/tweaks/game-priority.md): checked its scheduling claims against Microsoft's documentation before rejecting the GPU/SFIO priority changes.

These projects are discovery references, not benchmark evidence. Rankly's implementation uses its existing native command generation, allowlists, and recovery engine. No downloaded script or executable was run or bundled.

## Added controls

| Control | Reason to try it | Boundaries and cost |
| --- | --- | --- |
| Active cooling preference | A passive cooling policy can reduce CPU performance; active cooling can use fans instead. | Requests the exposed AC power preference. Firmware may manage cooling independently. More fan noise/power; no benefit when already active. |
| NVMe low-latency power | Avoid selecting idle states with nonzero transition latency on Microsoft-managed NVMe drives. | Both tolerances set to 0 ms, matching High performance AC defaults. Driver and setting support required. More SSD power/heat; not a sequential-speed or guaranteed FPS gain. |
| SATA link readiness | Avoid AHCI link power-state exit delays. | Requires a working Microsoft StorAHCI controller. AC-only HIPM/DIPM mode 0 (Active). More power; no change to maximum drive throughput. |
| Ethernet idle-sleep fix | Troubleshoot connection issues following adapter idle sleep. | Only active physical Ethernet adapters advertising NDIS selective suspend and value 0. More power on AC and battery; requires restart. Not a general latency recommendation. |

Primary references: [Microsoft thermal management](https://learn.microsoft.com/en-us/windows-hardware/drivers/kernel/device-level-thermal-management), [Microsoft NVMe power management](https://learn.microsoft.com/en-us/windows-hardware/design/component-guidelines/power-management-for-storage-hardware-devices-nvme), [Microsoft AHCI link power](https://learn.microsoft.com/en-us/windows-hardware/customize/power-settings/disk-settings-link-power-management-mode---hipm-dipm), and [Microsoft NDIS selective-suspend keywords](https://learn.microsoft.com/en-us/windows-hardware/drivers/network/standardized-inf-keywords-for-ndis-selective-suspend).

The expected benefits above are conditional inferences from documented mechanisms. No FPS improvement was measured. All four controls are optional and selected individually. Stored values are not proof of driver behavior or game performance.

## Already covered or not selected

- Rankly already covers Game Mode, Windows capture, HAGS, windowed optimizations, CPU/PCIe power, core parking, Ethernet interrupt moderation/RSS/EEE, Wi-Fi power, and selected background work. GPU choice is available through its Graphics setup guide; older per-game GPU backups remain recoverable. Duplicate entries would not add functionality.
- **MMCSS GPU/SFIO priority and SystemResponsiveness=0:** Microsoft says the first two values are unused, and values below 10 for SystemResponsiveness are clamped to 20. These are not credible additions. [Microsoft MMCSS reference](https://learn.microsoft.com/en-us/windows/win32/procthread/multimedia-class-scheduler-service)
- **Global fullscreen optimization disabling:** Microsoft's performance data generally favors keeping the feature; its opt-out is troubleshooting for specific games. It is not suitable as a system-wide gaming adjustment. [Microsoft explanation](https://devblogs.microsoft.com/directx/demystifying-full-screen-optimizations/)
- **HPET/BCD timer packs, global process priority/affinity, forced MSI, and blanket offload changes:** the inspected material did not establish a repeatable benefit for the user's hardware and game. These changes were excluded.
- **Routine shader-cache deletion:** shader reuse avoids compilation stutter; cache eviction can create more compilation work. Repairing a broken cache is a separate task. [NVIDIA shader-cache documentation](https://www.nvidia.com/content/Control-Panel-Help/vLatest/en-gb/mergedProjects/nv3dENG/Manage_3D_Settings_%28reference%29.htm)
- **Recall policy disabling:** the documented policy deletes existing snapshots, making it unsuitable for an ordinary fully reversible tweak. [Microsoft WindowsAI policy](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-windowsai#disableaidataanalysis)

## Validation

- 68 tests pass, including support detection, complete NVMe backups, reverse recovery, partial-write rollback, native PowerShell parsing, and stubbed AC-only power / no-restart Ethernet writes.
- Read-only capability detection on Windows 10 build 19045 found supported NVMe and AHCI controllers and power values. Ethernet selective suspend was correctly unavailable on the tested connection.
- TypeScript/Vite production build passed. The isolated browser fixture completed selection, review, mock application, and restoration of all four controls without browser console errors.
- Existing game configuration and Windows settings were not changed during development. No game performance benchmark was run.
