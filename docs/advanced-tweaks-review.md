# Advanced tweaks review

Reviewed November 13, 2026. Rule for this pass: add only changes with a real,
documented effect that users cannot simply flip in Windows Settings.

## Added

| Control | What it changes | Evidence |
| --- | --- | --- |
| NVIDIA low latency | Global driver profile: Maximum pre-rendered frames (`0x007BA09E`) = 1, the same as Low Latency Mode "On". | [NvApiDriverSettings.h](https://github.com/NVIDIA/nvapi/blob/main/NvApiDriverSettings.h). Helps GPU-limited DX9/DX11/OpenGL games; DX12, Vulkan, and Reflex games manage their own queue. |
| NVIDIA maximum performance | Power management mode (`0x1057EB71`) = Prefer maximum performance. | Same header. Avoids clock drops in light scenes; costs power while 3D apps run. |
| G-SYNC low-latency setup | Vertical Sync (`0x00A879CF`) = Force on, Frame Rate Limiter (`0x10835002`) = a cap under refresh. Only offered when the driver reports G-SYNC on for the main display. | [Blur Busters G-SYNC 101](https://blurbusters.com/gsync/gsync101-input-lag-tests-and-settings/14/): driver V-Sync on, in-game V-Sync off, cap at least 3 FPS under refresh. Rankly uses `min(refresh − 3, refresh − refresh²/3600)` (224 at 240 Hz). |
| Multi-plane overlay off | `HKLM\SOFTWARE\Microsoft\Windows\Dwm\OverlayTestMode` = 5; restore deletes it. Troubleshooting only. | [NVIDIA article 5157](https://nvidia.custhelp.com/app/answers/detail/a_id/5157) and its `mpo_disable.reg`, read during this review. |
| Prefer performance cores | Hidden power setting SCHEDPOLICY (`93b8b6dc-…`) = 2, Prefer performant processors, plugged in only. Offered only when the CPU reports more than one efficiency class. | [Microsoft SchedulingPolicy](https://learn.microsoft.com/en-us/windows-hardware/customize/power-settings/configuration-for-hetero-power-scheduling-schedulingpolicy); GUID and values confirmed with `powercfg /qh`. |

NVIDIA settings are written to the current global profile through the driver's
own `nvapi64.dll`. Function IDs, setting IDs, and the `NVDRS_SETTING` layout come
from NVIDIA's public headers; a read-only probe on an RTX 4070 returned the
expected setting names. Backups record whether each setting had a user value;
restoring one that had none deletes it, returning the driver or NVIDIA default.

## Withdrawn

**Variable refresh for more games** left the library because Windows Settings
offers the same switch. Backups made with v1.1.0 still restore.

## Considered, not added

| Candidate | Reason |
| --- | --- |
| Low Latency Mode "Ultra" | Uses driver settings NVIDIA does not document; the driver returns no names for the commonly cited IDs. Not written blind. |
| Unlimited shader cache | NVIDIA's header lists a 16 GB default, so the gain is negligible. |
| Intel Wi-Fi roaming "Lowest" | Intel recommends the default unless a change helps; reports are mixed and the driver keyword could not be verified without hardware. |
| Disable CPU idle states | Can lower boost clocks on modern CPUs, which rely on idle cores. |
| Timer resolution, Win32PrioritySeparation, network throttling, forced MSI | Placebo or no better than Windows defaults (see earlier reviews). |
| Startup apps, power mode, per-game GPU choice | Already in Windows Settings. |

## Validation

`cargo test`: 43 passed, including 9 for these controls (exact values, support
checks, frame-cap range, tampered backups refused, mixed PowerShell/driver
batches, and engine apply/restore back to driver defaults). The parity suite
records the two deliberate changes above. A test build showed correct
availability on the development PC. No NVIDIA setting was written to a real
driver during this review.
