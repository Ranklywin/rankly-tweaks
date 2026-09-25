# Further gaming tweak review: Intel Wi-Fi

Reviewed September 25, 2026, after the [keyboard shortcut review](gaming-tweak-gap-review.md). Existing controls, including the earlier cooling/storage additions, were treated as the baseline. This pass adds two optional Intel Wi-Fi compatibility controls. There is no measured FPS or internet-ping claim.

## Research and decisions

GitHub discovery included [fortnite-latency-tweaks](https://github.com/omnibot007/fortnite-latency-tweaks/blob/main/README.md), [windows11-scripts' network suggestions](https://github.com/shoober420/windows11-scripts/blob/main/NetworkTweaks.bat), and [GamerGuardian's settings inventory](https://github.com/carterscode/GamerGuardian). No downloaded code was executed or copied into Rankly. Their hardware-specific measurements, numeric registry encodings, and broad optimization recommendations were not assumed to apply to other PCs.

| Candidate | Decision |
| --- | --- |
| Intel SMPS | Added **Wi-Fi antenna power fix**. Intel recommends trying No SMPS for link-quality problems with certain legacy access points. |
| Intel U-APSD | Added **Wi-Fi U-APSD compatibility**. Intel documents access-point interoperability problems that can reduce receive throughput; disabling that mode is a conditional workaround. It is already disabled on many drivers. |
| Windows Wi-Fi power plan, Ethernet power/packet settings, capture, keyboard shortcuts | Already covered. The new driver settings use different controls from the AC-only Windows Wi-Fi power preference. |
| Wi-Fi roaming, preferred band, maximum transmit power, packet bursting | Not added. Appropriate choices depend on coverage, roaming needs, and nearby clients. Intel describes packet bursting mainly as an upload-throughput feature, with possible costs to other clients. |
| Network scan blocking and packet coalescing | Not added in this pass. Stationary and mobile users have different needs; the reviewed material does not establish a general benefit from globally changing these settings. |
| Dynamic Refresh Rate (DRR) off | A valid troubleshooting step when DRR limits a game's refresh rate, but not implemented as an automatic display change. A display control needs topology-aware recovery and protection against an unusable display mode. The existing Graphics setup guide links Windows settings. [Microsoft guidance](https://support.microsoft.com/en-us/windows/hardware/display-graphics/change-the-refresh-rate-on-your-monitor-in-windows), [display-path flag/API](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-displayconfig_path_info). |
| Global audio-ducking registry edit | Not added. Microsoft's documented opt-out is an audio-session API; that does not validate a persistent global registry edit with reliable application and recovery. [SetDuckingPreference](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nf-audiopolicy-iaudiosessioncontrol2-setduckingpreference). |
| Timer, MMCSS, TCP, affinity, and cache packs | Still excluded for the reasons in the [prior gap review](gaming-tweak-gap-review.md). No new general performance evidence justified revisiting them. |

The primary reference for the wireless mechanisms and tradeoffs is [Intel's advanced wireless settings documentation](https://www.intel.com/content/www/us/en/support/articles/000005585/wireless/legacy-intel-wireless-products.html). Expected benefits are conditional, not benchmark results. Both controls can increase power consumption on battery as well as AC. Keep defaults unless diagnosing a matching connection problem.

## Support and recovery

The new controls appear in the existing Network category with the existing selection, review, source, and Recovery flows. Neither is selected automatically.

- Requires Windows 10 or newer, administrator access for writes, a connected physical Intel PCI Wi-Fi adapter, an Intel driver, and an unlocked adapter. Ethernet, virtual adapters, other vendors, unavailable properties, and unknown choices are excluded. Discovery uses the documented [network adapter properties](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/legacy/hh968170(v=vs.85)).
- Reads the driver's own valid labels and values using [Get-NetAdapterAdvancedProperty](https://learn.microsoft.com/en-us/powershell/module/netadapter/get-netadapteradvancedproperty). Numeric values are resolved from the target labels rather than copied from a tweak script. This release recognizes the English labels `No SMPS` and `Disabled`; unrecognized/localized labels leave the control unavailable.
- The current value must have an unambiguous, matching display label and a restorable enumeration entry. Device identity and label/value correspondence are checked again before each write. Apply also rechecks connection state.
- Backups save the adapter GUID, PnP identity, original value and meaning, and advertised choices before the first write. Recovery targets that original adapter even after a rename, without resolving a different current adapter. It can restore a disconnected adapter if its original hardware and property remain accessible.
- A removed/replaced adapter or changed driver encoding keeps the backup recoverable and blocks an unverified write. No alternate numeric value is guessed. Backup validation rejects missing controls, foreign properties, or unexpected target values.
- Writes use [Set-NetAdapterAdvancedProperty](https://learn.microsoft.com/en-us/powershell/module/netadapter/set-netadapteradvancedproperty) with `-NoRestart`. Matching values cause no setter call. Apply and restore require a later PC restart to activate; the live connection is not intentionally restarted. Stored-setting verification does not prove driver runtime behavior.
- Uses the existing durable journal, post-write verification, whole-batch rollback, interrupted-change blocking, and reverse-order Recovery.

## Necessary checks performed

- **48 focused tests passed:** 9 new Wi-Fi tests plus 39 engine, existing network/power, and researched-control regression tests. Only the affected Wi-Fi tests were repeated after corrections; already-passing unrelated tests were not repeated.
- Simulated native tests executed the production PowerShell with all adapter cmdlets replaced by in-memory fixtures. Coverage includes alternate driver encodings, escaped adapter names, no-op writes, recovery while disconnected, management locks, virtual/non-Intel devices, changed identities, driver drift, partial failure, failed rollback, and recovery after restart. No real setter or reconnect was called.
- Generated PowerShell parsed successfully. A small live adapter probe performed reads only. No benchmark, Windows tweak application, service change, power-plan write, or registry write was performed on this PC.
- `npm run build` passed. `src/App.tsx` and `src/styles.css` retain their original hashes. The source and frontend build are updated; the portable EXE was not repackaged, and a running app must be reopened to load the new source.
