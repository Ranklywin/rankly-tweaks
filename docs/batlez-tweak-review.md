# Batlez Tweaks review

Reviewed September 25, 2026. Source pinned to [commit 5993bced5aa3a465509ed1a2d0e45418506f20e1](https://github.com/Batlez/Batlez-Tweaks/tree/5993bced5aa3a465509ed1a2d0e45418506f20e1). The 17,740-line batch file was saved as inert text under the ignored `.verification` directory. Inspected its menu inventory and relevant power, timer, graphics, network, memory, input, monitor, audio, storage, registry, and MSI sections. This was candidate research, not a full security audit. No downloaded code was executed or incorporated into Rankly.

## Useful addition

The [audio section](https://github.com/Batlez/Batlez-Tweaks/blob/5993bced5aa3a465509ed1a2d0e45418506f20e1/Batlez-Tweaks.bat#L8097-L8180) suggests preventing communication-related volume drops and disabling troublesome audio effects. These are useful symptom-specific ideas, including on Home edition and across GPU vendors.

Microsoft documents [Windows communication ducking](https://learn.microsoft.com/en-us/windows/win32/coreaudio/stream-attenuation) and changing the preference in Sound Control Panel. The documented [SetDuckingPreference API](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nf-audiopolicy-iaudiosessioncontrol2-setduckingpreference) operates on an audio session; it is not a verified persistent setter for every game. A successful write of Batlez's `UserDuckingPreference` registry value alone would not verify live behavior or recovery. Its presence did not resolve the automation limitation from the earlier review.

Microsoft also recommends testing playback enhancements off for [distorted or crackling audio](https://support.microsoft.com/en-us/windows/hardware/audio/fix-distorted-or-crackling-audio-in-windows). Device support varies. That supports a targeted troubleshooting step, not disabling effects on every input/output device or promising lower latency/FPS improvements.

Added **Game audio setup** using the existing Windows-tool card and documented `ms-settings:sound` route. It explains the Communications option, separate chat-app attenuation, Windows 10/11 playback-effect settings, and manual undo. It does not create a recovery entry or count as an automated tweak. Users must note their original choices and reverse manual changes in Windows; the card explicitly explains that Rankly Recovery does not capture those changes. No sound settings were changed during development.

## Candidates not imported

| Candidate | Finding |
| --- | --- |
| Power plans, parking, GPU scheduling, game capture, mouse acceleration, accessibility shortcuts, network power/RSS, background apps, browser activity, Windows suggestions | Already covered by Rankly. Existing support checks and saved-original recovery are retained. |
| MPO / DirectX pack, lines 15701–15768 | Batlez labels `OverlayTestMode=5` as enabling MPO. Do not treat that label as evidence of a gaming benefit. [NVIDIA's current article](https://nvidia.custhelp.com/app/answers/detail/a_id/5157) describes MPO's performance/power benefit and an optional disable/restore procedure; [Microsoft](https://learn.microsoft.com/en-us/windows-hardware/drivers/display/multiplane-overlay-support) describes hardware composition. No general reason to disable it was established. NVIDIA attachment fetches failed in this session, so their exact bytes were not independently checked. |
| MSI for every PCI controller, lines 16435–16469 | Batlez writes settings to USB, GPU, network, and storage controllers selected by device class/PCI identity. [Microsoft](https://learn.microsoft.com/en-us/windows-hardware/drivers/kernel/enabling-message-signaled-interrupts-in-the-registry) documents MSI configuration through a supporting driver's INF. A PCI vendor ID is insufficient proof that forcing a driver mode is appropriate. No blanket switch added. |
| MMCSS GPU/SFIO priorities | [Microsoft](https://learn.microsoft.com/en-us/windows/win32/procthread/multimedia-class-scheduler-service) explicitly says these values are unused. No benefit to import. |
| Timer/BCD, global TCP/UDP, power-throttling disable | No new evidence beyond the unsupported or environment-dependent candidates rejected in the [global review](global-tweak-research.md) and [earlier review](gaming-tweak-gap-review.md). |
| Memory/cache pack, lines 5285–5343 | Fixed cache sizes, memory-compression changes based solely on RAM capacity, process-priority changes, and forced browser termination do not establish a general gaming benefit or preserve user sessions. Not imported. |
| Storage pack, lines 10532–10628 | Mixes TRIM with disabling scheduled optimization, filesystem policy changes, controller edits, and maintenance. [Microsoft's fsutil reference](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/fsutil-behavior) describes workload-specific tradeoffs; that is not proof of a universal game benefit. Rankly already covers storage power settings. |
| Registry performance pack | Its Game Mode values are set to zero at lines 12845–12846, while the Stream Optimizer sets AutoGameModeEnabled to one at line 15619. These presets conflict. Do not import them as a coherent performance baseline. |
| Security removal, broad service/app deletion, cleanup | Not imported. These expand beyond the verified additions and cannot provide exact recovery of removed data or live sessions through ordinary setting backups. |

## Validation scope

Only the catalog guide and documentation changed. No native writer, support resolver, or recovery operation was added. Validation is limited to the frontend build and checking that the UI component and stylesheet retain their previous hashes. No unit tests mirroring guide text, full suite, package build, system-tweak trial, or game benchmark is warranted for this change. The portable executable remains unchanged.

Result: `npm run build` passed; both `src/App.tsx` and `src/styles.css` matched their recorded SHA-256 hashes.
