# Global Windows gaming settings review

Reviewed September 25, 2026 against the current source catalog, after the [keyboard](gaming-tweak-gap-review.md) and [Wi-Fi](wifi-tweak-research.md) additions. This pass prioritizes controls that work across games and hardware. No further universal FPS improvement was established. One documented interruption control was worth adding; its edition limit is explicit.

## Discovery

Reviewed [WinUtil's catalog](https://github.com/ChrisTitusTech/winutil/blob/main/config/tweaks.json), [FrameGuard's proposed optimizations](https://github.com/eferlin/frameguard/blob/main/New%20performance%20tweaks%20for%20FrameGuard%20on%20Windows%2011.md), [Win11-LowLatency-NoExtraW](https://github.com/ossusdev/Win11-LowLatency-NoExtraW), and [Microsoft's WindowsDeveloperConfig inventory](https://github.com/microsoft/WindowsDeveloperConfig/blob/main/windows-dev-config/README.md). These supplied candidates, not benchmark evidence. No downloaded script was executed.

## Implemented

**Quiet app notifications** sets the user-scoped `NoToastApplicationNotification` DWORD to `1`. Microsoft's [ADMX_WPN policy reference](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-admx-wpn#notoastnotification) documents blocking application toasts without a restart, while excluding system notifications and taskbar balloons. The local Windows `WPN.admx` was read, without changes, to independently confirm its user scope, path, and enabled value. Game overlays remain outside its scope.

The control works across CPU, GPU, and network vendors, including windowed games. It is optional, persists outside gameplay, and suppresses chat/mail alerts too. This is interruption prevention, not an FPS or latency claim. It does not stop applications, suspend syncing, or configure Do Not Disturb schedules, so it does not duplicate the background-app policy or promotional-content cleanup.

Rankly conservatively requires Windows build 19044 or later and Pro, Enterprise, Education, or IoT Enterprise. Home and unknown editions are unavailable. The build floor avoids needing to infer whether older Windows 10 releases have the update identified in the CSP documentation; the underlying Group Policy predates that CSP. All minimum-build controls now reject missing or invalid build information. Existing native resolution rechecks support immediately before a user-requested application.

Rankly requires administrator access to write the protected user policy branch. A read-only ACL inspection found ReadKey in the current user's direct permission entry. The existing review dialog enforces the administrator requirement.

The existing registry allowlist and durable transaction engine handle the new control. Original value, type, or absence are saved before writing. Apply verifies the stored result and rolls back on failure; Recovery restores the saved original after app restart. An existing matching value produces no write or backup. As with other policy preferences, a management policy can replace it later; the stored indicator is not a runtime notification delivery test.

**Notification settings** uses the existing Windows-tool card and documented [`ms-settings:notifications` URI](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings). It directs users to the automatic gaming rule and exceptions, including Home users, and notes that rules may already be enabled. Microsoft documents these options in [Notifications and Do Not Disturb](https://support.microsoft.com/en-us/windows/experience/notifications-and-do-not-disturb-in-windows) and [Focus](https://support.microsoft.com/en-us/windows/focus-stay-on-task-without-distractions-in-windows-cbcc9ddb-8164-43fa-8919-b9a2af072382). It opens Settings only. Manual Windows changes are not Rankly transactions; the guide explains how to undo them there and to restore the Rankly policy first if applied.

## Other candidates

| Candidate | Decision |
| --- | --- |
| Game Mode, recording, HAGS, windowed presentation, power plans, CPU/device power, network settings | Existing controls. No second switch for the same setting. |
| Global power-throttling disable | Not added. Microsoft's [QoS classifications](https://learn.microsoft.com/en-us/windows/win32/procthread/quality-of-service) already assign focused/audible work high QoS; [power-slider documentation](https://learn.microsoft.com/en-us/windows-hardware/customize/desktop/customize-power-slider#power-throttling) describes throttling background work for efficiency. These do not establish a universal gaming benefit from opting all background processes out. |
| Disable automatic maintenance | Not added. [Microsoft's scheduler documentation](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-maintenence) says ordinary maintenance defers/suspends during active use; critical tasks are exceptions. Disabling maintenance broadly is not justified by that behavior. |
| Undocumented notification registry shortcuts and CloudStore edits | Not added. WindowsDeveloperConfig labels `NOC_GLOBAL_SETTING_TOASTS_ENABLED` as Do Not Disturb, but the [official settings reference](https://learn.microsoft.com/en-us/windows/apps/develop/settings/settings-common#do-not-disturb) describes structured Cloud Data Store profiles and rules. Neither verifies a stable reversible DND setter through that registry value. The implemented control uses a separate documented application-toast policy. |
| Blanket Home background-app registry override | Not added. Background-app control already exists, and Microsoft's [Settings URI reference](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings) identifies the old global background-app toggle as deprecated on Windows 11. No new supported Home setter was established. |
| Restartable apps after sign-in | No automated addition. [Microsoft documents the Windows UI option](https://support.microsoft.com/en-us/edge/stop-microsoft-edge-from-starting-automatically); the reviewed sources did not establish a supported global setter suitable for Rankly. Existing Startup apps and browser controls cover related background-work choices. |
| Timer/HPET, MMCSS, TCP packs, global fullscreen disable, memory/cache cleaners | Retain the evidence-based exclusions in the [earlier review](gaming-tweak-gap-review.md#other-candidates). No new evidence overcame them. |

## Validation

`node --test tests/notification-control.test.mjs tests/engine.test.mjs`: **27 passed**. Covers build/edition checks, nonduplication, account-scoped allowlists, durable backup ordering, exact original type/absence recovery after restart, no-op behavior, failed verification rollback, and the existing interrupted-change/recovery protections. All setting reads and writes in engine tests are in-memory substitutes. Generated notification scripts were parsed, not executed.

The eight notification tests passed again after adding the administrator gate. `npm run build` passed. No full suite or package build was needed for this catalog change.

No live notification toggle, registry write, tweak application, or benchmark was run. Host policy inspections only read the installed definition and registry permissions. The UI component and stylesheet remain unchanged. The source/frontend build includes the additions; the existing portable executable is not repackaged by this pass.
