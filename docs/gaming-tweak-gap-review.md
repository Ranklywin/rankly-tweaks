# Gaming tweak gap review

Reviewed September 25, 2026 against the existing Rankly 1.9.2 source catalog. This is a follow-up to the [earlier Windows research](windows-tweak-research.md), whose four additions were already present. No downloaded script was executed. No tweak was applied to the development PC.

## Discovery and evidence

Inspected [WinUtil's current tweak catalog](https://github.com/ChrisTitusTech/winutil/blob/main/config/tweaks.json), [envOptimizerMMO's scope and opt-in caveats](https://github.com/kurohige/envOptimizerMMO/blob/main/README.md), and [GamerGuardian's setting inventory](https://github.com/carterscode/GamerGuardian). These provide candidate ideas, not proof of FPS improvements. Also inspected [Microsoft DXUT's accessibility shortcut implementation](https://github.com/microsoft/DXUT/blob/main/Core/DXUT.cpp), which checks whether each accessibility feature is in use before disabling its shortcut.

In this pass, only one additional grouped control met the evidence, nonduplication, and recovery criteria. It prevents a documented interruption; no new universal FPS improvement was established. A [subsequent wireless review](wifi-tweak-research.md) adds two Intel access-point compatibility controls.

## Implemented: Keyboard shortcut protection

Repeated Shift presses and prolonged right-Shift or Num-Lock presses can activate accessibility shortcuts. Disabling those shortcuts avoids accidental prompts or activation while playing. This is useful when those gestures conflict with game controls; it does not raise FPS or reduce input latency. [Microsoft's game-development guidance](https://learn.microsoft.com/en-us/windows/win32/dxtecharts/disabling-shortcut-keys-in-games), [StickyKeys flags](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-stickykeys), [FilterKeys flags](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-filterkeys), [ToggleKeys flags](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-togglekeys).

Rankly implements an explicit account preference, retained until Recovery, rather than DXUT's temporary fullscreen behavior. The existing control card and review dialog explain that duration. There are no keyboard hooks, game watchers, repeat-rate edits, or Windows-key remaps. The documented [SystemParametersInfoW API](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfow) supplies live reads, profile persistence, and change notification.

- Requires Windows 10 or newer and successful reads of all three available features. The whole control is unavailable if any feature is active or support cannot be verified.
- Changes only `HOTKEYACTIVE` and `CONFIRMHOTKEY` (`0x0C`). The enabled state, sounds, indicators, and FilterKeys timings are preserved. The API is read again immediately before each write.
- Stores all three original shortcut bit values in the durable recovery journal before writing. Already matching values cause no native write; an entirely matching batch creates no backup.
- Uses the existing verified apply, rollback, interrupted-change recovery, and reverse restore order. Incomplete or altered backups cannot expand the allowed settings or bits.
- Recovery merges only the saved shortcut bits into the current configuration, preserving later changes to other accessibility options. If an accessibility feature is now active and restoring would change its shortcut, Recovery keeps the backup and reports the conflict instead of changing it.

## Other candidates

| Candidate | Decision and evidence |
| --- | --- |
| Game Mode, capture, HAGS, windowed presentation, CPU/PCIe power, parking, cooling, storage power, Ethernet moderation/RSS/EEE/selective suspend, Wi-Fi, USB | Already implemented. No duplicate controls added. |
| GPU choice and monitor refresh rate | Already covered by the Graphics setup guide; old per-game GPU backups remain recoverable. No duplicate guide or global display-mode override added. |
| HPET/platform-clock and BCD timer packs | Rejected. Microsoft describes `useplatformclock` and `tscsyncpolicy` as debugging options, not gaming recommendations. [BCDEdit documentation](https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/bcdedit--set). |
| Resident timer-resolution booster | Rejected. Modern `timeBeginPeriod` behavior is process-specific; Microsoft warns that higher timer resolution can lower overall performance and prevent power saving. That does not establish an external booster's benefit to a game. [Timer API](https://learn.microsoft.com/en-us/windows/win32/api/timeapi/nf-timeapi-timebeginperiod). |
| MMCSS GPU/SFIO priorities and `SystemResponsiveness=0` | Rejected again. GPU and SFIO priorities are unused; responsiveness values below 10 are clamped to 20. [Microsoft MMCSS](https://learn.microsoft.com/en-us/windows/win32/procthread/multimedia-class-scheduler-service). |
| TCP ACK/Nagle packs | Rejected as a general gaming control. Microsoft's TCP ACK reference recommends environment-specific study before changing its default. The reviewed GitHub material did not establish a general benefit. [TCP ACK documentation](https://learn.microsoft.com/en-us/troubleshoot/windows-server/networking/registry-entry-control-tcp-acknowledgment-behavior). |
| Disable fullscreen optimizations everywhere | Rejected. Microsoft's results generally favor the feature; a per-game compatibility problem does not justify a blanket change. [DirectX explanation](https://devblogs.microsoft.com/directx/demystifying-full-screen-optimizations/). |
| Blanket memory-compression disable, cache cleaners, process affinity, vendor GPU registry packs | Not selected. The reviewed material did not establish a general benefit with reliable support checks and recovery. Vendor/game recommendations cannot safely become universal switches. |

## Validation for this change

`node --test tests/keyboard-shortcuts.test.mjs tests/engine.test.mjs tests/grouping.test.mjs tests/researched-controls.test.mjs`: **40 tests passed**. Coverage includes active-feature protection, unavailable support, duplicate operations, durable backups, no-op application, partial failure, failed rollback, crash recovery, and malformed backups. The production C# merge/write logic ran against an in-memory native substitute; it checked structure sizes, action IDs, persistence/notification flags, and preservation of other flags and timings. No real setter was called.

Generated PowerShell was parsed without executing its writes. A small live read exercised only the three `SPI_GET*KEYS` calls and compiled the native interop successfully. The existing power/network write tests used stubs. `npm run build` passed. `src/App.tsx` and `src/styles.css` retain their original SHA-256 hashes.

No live write/restore test or game benchmark was run, so this review makes no measured performance claim. The source and frontend build are updated; the existing portable executable was not repackaged.
