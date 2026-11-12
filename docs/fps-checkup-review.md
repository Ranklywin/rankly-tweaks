# Performance checkup, mouse test, and VRR review

Reviewed November 12, 2026, after the [global settings review](global-tweak-research.md). Earlier passes concluded that the remaining popular registry "FPS packs" lack evidence; that conclusion stands. The largest remaining losses on real PCs come from setup problems that no Windows setting fixes: a monitor left at 60 Hz, memory at its base speed, a monitor cable in the motherboard, or a laptop on battery. This pass detects those instead of adding more registry switches.

## Added

### Performance checkup (read-only)

Runs with every scan and appears on Overview. It changes nothing; findings link to the Windows page or explain the BIOS step.

| Check | Source of truth | Reports a problem when |
| --- | --- | --- |
| Refresh rate | `EnumDisplaySettings` on each attached display (non-interlaced modes at the current resolution only) | The highest listed rate is at least 10 Hz and 10% above the current rate. 59/60 Hz rounding is ignored. |
| Display adapter | `EnumDisplayDevices` primary display, matched to `Win32_VideoController` and PCI vendor | On a desktop, the main display runs from integrated graphics while a discrete GPU is installed. Skipped on laptops (hybrid graphics is normal there). |
| Memory speed | `Win32_PhysicalMemory` `ConfiguredClockSpeed`, `Speed`, `SMBIOSMemoryType`, `FormFactor` | Desktop DIMMs run at DDR4 ≤ 2400 or DDR5 ≤ 4800 MT/s (the usual fallback when XMP/EXPO is off), or below the speed the modules report. Notes mixed kits. SO-DIMMs and laptops are skipped. |
| Memory channels | `DeviceLocator` / `BankLabel` | One stick installed, or every stick reports the same controller and channel. Intel DDR5 reports dual channel as `Controller0/1-ChannelA`, which is treated as two channels. Soldered LPDDR is skipped. |
| Power source | `GetSystemPowerStatus` | A battery-powered PC is unplugged or has Battery saver on. |
| Graphics driver | `Win32_VideoController` | Windows uses the Microsoft Basic Display Adapter, or a discrete GPU driver is over a year old. Integrated drivers are left to the PC maker. |

The refresh-rate finding opens `ms-settings:display-advanced` ([documented URI](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings)) through a new **Refresh rate** guide rather than switching the mode itself. Windows Settings asks the user to keep a new display mode and reverts automatically if the screen goes blank; a background mode switch from Rankly would lose that safety net. The change is therefore manual and not a Recovery entry, as the guide explains.

Every check stays silent when Windows does not report enough information; failures in one section do not hide the others, and a failed checkup does not fail the scan.

### Mouse polling test

The new Input page measures how often the mouse reports movement using `pointerrawupdate` events (falling back to `pointermove` with `getCoalescedEvents`). Because a mouse reports only while moving, the result uses the 90th percentile of 100 ms windows during movement, not the average across pauses. Tests require at least 200 events across five or more windows; otherwise the user is asked to retry. Results are matched to standard rates (125–8000 Hz) within 20%. Nothing is sent or stored. The page notes that rates above 1000 Hz may read lower in a browser-based measurement.

### Variable refresh for more games

Adds `VRROptimizeEnable=1` to the existing `DirectXUserGlobalSettings` preference. Microsoft's [OS VRR announcement](https://devblogs.microsoft.com/directx/os-variable-refresh-rate/) describes it as enabling VRR for DX11 games that did not support it natively, requiring Windows 1903+, a VRR-capable monitor, and a WDDM 2.6+ driver. Rankly checks the build and the highest WDDM version reported by dxdiag; it cannot confirm monitor VRR support, which the tradeoff text states.

The token shares a registry value with **Windowed game optimization**. `operationsFor` now merges semicolon tokens for the same value into one operation, so selecting both controls produces one read, one backup, and one write instead of two writes where the second would discard the first. Unrelated tokens such as `AutoHDREnable` are preserved; Recovery restores the exact original string.

## Considered, not added

| Candidate | Decision |
| --- | --- |
| In-app display mode switch with Recovery | Not added. Display device names are not stable across reconnects, and switching without Windows' keep-or-revert prompt risks a blank screen. The guide uses Windows' own flow. |
| NVIDIA Low Latency Mode / power management through driver profiles | Deferred. Needs NVAPI driver-profile reads, writes, and backups. Games with Reflex, including Fortnite, override it. A separate, larger change. |
| Laptop "Best performance" power mode | Deferred. The overlay GUIDs are [documented for OEMs](https://learn.microsoft.com/en-us/windows-hardware/customize/desktop/customize-power-slider), but the setter API is not. A guide card is the safe first step. |
| Timer, HPET, MMCSS, Nagle, forced MSI, memory cleaners | Earlier exclusions stand. No new evidence. |

## Validation

`node --test tests/fps-additions.test.mjs`: **21 passed**. Covers VRR gating, token merging and exact restore through the engine, WDDM parsing, every checkup rule (including a real four-stick mixed-kit snapshot, DDR5 subchannels, half-rate reports, LPDDR, laptops, missing drivers, and missing data), GPU classification, a static read-only check of the checkup script, and polling estimates at standard rates, with pauses, too little movement, and in-between rates.

The Windows-only checkup test parses the script and runs it on the development PC; it only reads display modes, WMI classes, and power status. Full suite: **113 passed**. `npm run build` passed. The browser fixture shows simulated checkup findings and runs the mouse test without Windows access.

No game benchmark was run. The checkup reports conditions with well-understood performance effects; it makes no measured FPS claim for a specific PC. The portable executable was not repackaged.
