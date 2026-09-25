# Rankly Tweaks

Windows gaming controls with hardware checks, clear tradeoffs, and local recovery.
Choose changes that fit your PC, review them, and restore saved settings from
Recovery. Opening or scanning the app does not apply tweaks.

## Download v1.0.0

Download **Rankly-Tweaks-1.0.0.exe** from the
[v1.0.0 release](https://github.com/ranklywin/rankly-tweaks/releases/tag/v1.0.0).
Use the portable executable under **Assets**; the source ZIP is for development.
No installer or companion folder is needed.

- Windows 10 21H2 (build 19044) or newer, or Windows 11; **x64 only**.
- The app requests administrator access for system controls.
- This release is **unsigned**. Check the source and release checksum before
  deciding whether to run it; signing is not yet available.
- Some controls require a specific Windows edition, driver, or device. Unsupported
  controls stay unavailable. Managed or firmware-locked settings are respected.

The release includes `SHA256SUMS.txt`. Compare your download in PowerShell:

```powershell
Get-FileHash .\Rankly-Tweaks-1.0.0.exe -Algorithm SHA256
```

## What it does

| Area | Controls |
| --- | --- |
| Gaming | Game Mode, Windows game recording, optional notification suppression, keep-awake preferences |
| CPU and power | High performance plan, CPU/PCIe preferences, core parking, active cooling |
| Graphics | Hardware GPU scheduling, windowed game optimizations |
| Storage | NVMe latency tolerance, SATA link readiness, hard-drive idle preferences |
| Input | Pointer acceleration, accessibility shortcut protection, USB disconnect troubleshooting |
| Network | Supported Ethernet properties, Wi-Fi power and Intel compatibility settings, update bandwidth |
| Background activity | Store apps, optional services, browsers, OneDrive, selective app closing |
| Advanced | Memory Integrity control, with policy/firmware checks and security tradeoffs |

The library includes performance-related controls and explicitly labelled
troubleshooting or convenience options. **No universal FPS or ping improvement is
promised.** Read each control's explanation; compare results in your own games.
Power settings can increase heat, fan noise, or battery use. Disabling Memory
Integrity reduces a Windows security protection. Closing apps can lose unsaved
work, and reopening an app does not recover its previous session.

## Recovery and privacy

Original values are durably saved before a change. Rankly verifies writes and
attempts rollback on failure. An interrupted change blocks further changes until
Recovery finishes. Restore the newest change first.

Backups preserve original registry types and missing values, the original power
plan, and the original adapter identity. If hardware or driver choices change,
recovery can refuse an unsafe restore and retain the backup. Restoring a setting
replaces later manual changes to that same setting.

Settings and backups live in `%APPDATA%\rankly-tweaks`. Keep that directory and use
the same Windows account. The portable app's settings are not stored beside its
EXE. Recovery is not a Windows System Restore point and cannot restore closed app
sessions. Changes made manually through Windows settings guides are not journaled.

No account or Rankly telemetry is required. Connection tests contact only the
selected test endpoint; documentation links open when requested. Exported reports
can include device details and backup values: review them before sharing.

## Build from source

Use **Node.js 24**, npm, and Git. Building the Windows executable requires Windows
x64. Dependencies are pinned, with full resolution in `package-lock.json`.

```powershell
git clone https://github.com/ranklywin/rankly-tweaks.git
cd rankly-tweaks
npm ci
npm run build
npm run desktop
```

`npm run dev` starts a local server at `http://127.0.0.1:5178` with read-only Windows
diagnostics. `/tests/ui/tweaks.html` is a mock UI fixture that cannot change Windows.
Linux/macOS can build and preview the frontend; native controls and the portable
executable are Windows-only.

## Validate and package

```powershell
npm test
npm run check:release
npm run package
npm run verify:package
npm run checksums
```

The result is `release/Rankly-Tweaks-1.0.0.exe`. Tests cover durable backups,
rollback, interrupted recovery, allowlists, hardware/edition gates, and adapter
identity. On Windows, native tests use isolated temporary registry keys,
disposable test processes, stubbed setters, and read-only capability probes.
They do not apply gaming settings to the host. Windows-only tests are skipped on
other platforms. The package check compares bundled code against source and
verifies licenses and administrator manifests without launching the executable.

GitHub Actions runs Linux source checks and Windows tests/build/package checks.
Pushing a version tag creates a **draft release** only after the checks pass.
See [the release procedure](docs/releasing.md) and [release notes](RELEASE_NOTES.md).

## Known limits

The documented real-PC validation baseline is Windows 10 build 19045. Automated
Windows runner checks do not establish game performance or driver compatibility
on every Windows 11 machine. HAGS, Modern Standby power plans, firmware, Windows
policy, non-English driver labels, and hardware changes can limit individual
controls. Status generally reflects stored preferences, not benchmark gains;
some controls require a restart or sign-out.

## Contributing and license

Read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and
[CHANGELOG.md](CHANGELOG.md). Rankly is [MIT licensed](LICENSE). Bundled libraries
and fonts retain their [third-party notices](THIRD_PARTY_NOTICES.md).

Research records: [Windows controls](docs/windows-tweak-research.md),
[input controls](docs/gaming-tweak-gap-review.md),
[Wi-Fi compatibility](docs/wifi-tweak-research.md),
[global settings](docs/global-tweak-research.md), and
[Batlez review](docs/batlez-tweak-review.md).
