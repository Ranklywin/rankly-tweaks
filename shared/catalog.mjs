import { leanServices } from './aggressive.mjs';
import { MEMORY_INTEGRITY_PATH } from './security-settings.mjs';
import { legacyTweaks } from './legacy-tweaks.mjs';
import { legacyV11Tweaks } from './legacy-v1.1-tweaks.mjs';
import { powerControls, networkControls } from './power-settings.mjs';
import { keyboardShortcuts } from './keyboard-settings.mjs';
import { wifiControls } from './wifi-settings.mjs';
const reg=(path,name,value,kind='DWord',transform)=>({path,name,value,kind,...(transform?{transform}:{})});
const operations = (...ids) => ids.flatMap(id => legacyTweaks.find(t => t.id===id).operations || []);

/** @typedef {{path:string,name:string,value:number|string,kind:string,transform?:string}} RegistrySetting */
/** @typedef {{id:string,name:string,category:string,icon:string,tag:string,impact:string,description:string,detail:string,tradeoff:string,restart:string,primary:boolean,aggressive?:boolean,source?:string,services?:string[],keyboardShortcuts?:readonly string[],wifiSetting?:{keyword:string,target:string},admin?:boolean,minBuild?:number,proOnly?:boolean,hardware?:string,operations?:RegistrySetting[],power?:string,requireAllPowerSettings?:boolean,powerSettings?:{subgroup:string,setting:string,value:number}[],networkSettings?:{keyword:string,value:string[],required?:boolean}[]}} Tweak */
/** @type {Tweak[]} */
export const tweaks = [
  {
    id:'gaming-optimization', name:'Gaming optimization', category:'Gaming', icon:'Gamepad2', tag:'Recommended', impact:'Gaming',
    description:'Prioritize your game and turn off Windows game recording.',
    detail:'Enables Game Mode and disables Windows game capture in one step.',
    tradeoff:'Turns off Game Bar recording and clips. OBS is unaffected.',
    restart:'Restart game', primary:true, operations:operations('game-mode','game-capture'),
  },
  {
    id:'app-notifications',name:'Quiet app notifications',category:'Gaming',icon:'BellOff',tag:'Optional',impact:'Fewer interruptions',
    description:'Silence app notification pop-ups across your Windows account.',
    detail:'Prevents applications from raising Windows toast notifications, including while a game is windowed. Applies across games and hardware. Windows system alerts, taskbar balloons, and in-game overlays are unaffected.',
    tradeoff:'Chat, mail, and other app alerts stay suppressed outside games too, until restored in Recovery. This is not an FPS boost. Requires Windows Pro, Enterprise, or Education; for scheduled quiet time or Home edition, use the Notification settings tool.',
    restart:'Instant',primary:true,admin:true,minBuild:19044,proOnly:true,
    operations:[reg('HKCU:\\SOFTWARE\\Policies\\Microsoft\\Windows\\CurrentVersion\\PushNotifications','NoToastApplicationNotification',1)],
    source:'https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-admx-wpn#notoastnotification',
  },
  {
    id:'high-performance', name:'Gaming power plan', category:'CPU & power', icon:'Zap', tag:'Plugged-in PCs', impact:'Power',
    description:'Switch Windows to its High performance power plan.',
    detail:'Switches to the High performance plan, including its battery settings.',
    tradeoff:'May increase heat, fan noise, and battery use.',
    restart:'Instant', primary:true, power:'8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
  },
  {
    id:'mouse-acceleration', name:'Raw mouse feel', category:'Input', icon:'MousePointer2', tag:'Optional', impact:'Input',
    description:'Remove Windows pointer acceleration for consistent movement.',
    detail:'Keeps pointer movement linear instead of changing with your hand speed.',
    tradeoff:'Changes desktop mouse feel. Games using raw input are unaffected.',
    restart:'Sign out', primary:true,
    operations:operations('mouse-acceleration'),
  },
  {
    id:'keyboard-shortcuts',name:'Keyboard shortcut protection',category:'Input',icon:'SlidersHorizontal',tag:'Optional',impact:'Fewer interruptions',
    description:'Prevent accidental Sticky Keys, Filter Keys, and Toggle Keys shortcuts.',
    detail:'Turns off the accessibility shortcuts triggered by repeated Shift presses or holding right Shift or Num Lock. Can prevent accidental prompts or feature activation during play. Available only while all three accessibility features are off.',
    tradeoff:'These shortcuts stay off for your Windows account until restored in Recovery. Accessibility features remain available in Windows Settings. Preserves typing delays, repeat rates, and other options; does not improve FPS or input latency.',
    restart:'Instant',primary:true,minBuild:10240,keyboardShortcuts,
    source:'https://learn.microsoft.com/en-us/windows/win32/dxtecharts/disabling-shortcut-keys-in-games',
  },
  {
    id:'performance-power',name:'Performance power',category:'CPU & power',icon:'Cpu',tag:'Plugged-in PCs',impact:'CPU & device power',
    description:'Favor CPU boost and responsive device power while plugged in.',detail:'Tunes CPU performance and PCIe power saving together in your selected power plan.',
    tradeoff:'May increase heat, fan noise, and idle power use. Battery settings stay unchanged.',restart:'Instant',primary:true,admin:true,powerSettings:powerControls['performance-power'],
  },
  {
    id:'core-parking',name:'Reduce core parking',category:'CPU & power',icon:'Cpu',tag:'Advanced',impact:'CPU',
    description:'Keep more processor cores ready for work.',detail:'Reduces power-saving core parking while plugged in.',
    tradeoff:'Can increase power use. Unavailable on Ryzen X3D systems to preserve their core scheduling.',restart:'Instant',primary:true,admin:true,hardware:'non-x3d',powerSettings:powerControls['core-parking'],
  },
  {
    id:'active-cooling',name:'Active cooling preference',category:'CPU & power',icon:'Cpu',tag:'Hardware dependent',impact:'Thermal performance',
    description:'Favor fan cooling before reducing processor performance while plugged in.',
    detail:'Requests Windows active cooling in your current power plan. It may help maintain performance when a passive cooling policy was limiting the CPU and the firmware honors this setting.',
    tradeoff:'Can increase fan noise and power use. Many PCs already use active cooling or manage fans independently. Thermal protection remains enabled; battery settings stay unchanged.',
    restart:'Instant',primary:true,admin:true,requireAllPowerSettings:true,powerSettings:powerControls['active-cooling'],
    source:'https://learn.microsoft.com/en-us/windows-hardware/drivers/kernel/device-level-thermal-management',
  },
  {
    id:'nvme-latency',name:'NVMe low-latency power',category:'CPU & power',icon:'HardDrive',tag:'NVMe drives',impact:'Storage response',
    description:'Reduce delays from NVMe idle power-state transitions while plugged in.',
    detail:'Sets primary and secondary NVMe transition latency tolerances to 0 ms, matching the AC values in Windows High performance. Applies to drives using Microsoft’s StorNVMe driver without switching your whole power plan.',
    tradeoff:'Can increase SSD power use and temperature. May help accesses after idle, not sustained throughput or guaranteed FPS. Already-matching settings need no change; battery values stay unchanged.',
    restart:'Instant',primary:true,admin:true,minBuild:18362,hardware:'nvme',requireAllPowerSettings:true,powerSettings:powerControls['nvme-latency'],
    source:'https://learn.microsoft.com/en-us/windows-hardware/design/component-guidelines/power-management-for-storage-hardware-devices-nvme',
  },
  {
    id:'sata-link-power',name:'SATA link readiness',category:'CPU & power',icon:'HardDrive',tag:'SATA / AHCI',impact:'Storage response',
    description:'Keep supported SATA storage links active while plugged in.',
    detail:'Disables AHCI host- and device-initiated link power saving in your current power plan. Can avoid link wake-up delays on drives using Microsoft’s standard SATA AHCI driver.',
    tradeoff:'Increases storage power use. Helps only if link power transitions were causing delays; it does not increase a drive’s maximum speed. Battery settings stay unchanged.',
    restart:'Instant',primary:true,admin:true,hardware:'ahci',requireAllPowerSettings:true,powerSettings:powerControls['sata-link-power'],
    source:'https://learn.microsoft.com/en-us/windows-hardware/customize/power-settings/disk-settings-link-power-management-mode---hipm-dipm',
  },
  {
    id:'gpu-scheduling',name:'GPU scheduling',category:'Graphics',icon:'Monitor',tag:'Hardware dependent',impact:'Graphics',
    description:'Let supported GPUs handle hardware scheduling.',detail:'Enables hardware-accelerated GPU scheduling when your driver supports it.',
    tradeoff:'Some games or capture setups work better with it off. Restart after changing.',restart:'Restart PC',primary:true,admin:true,minBuild:19041,hardware:'hags',
    operations:[reg('HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers','HwSchMode',2)],
  },
  {
    id:'windowed-gaming',name:'Windowed game optimization',category:'Graphics',icon:'PanelsTopLeft',tag:'Windows 11',impact:'Graphics',
    description:'Use modern presentation for windowed DX10 and DX11 games.',detail:'Enables Windows 11 optimizations for compatible windowed and borderless games.',
    tradeoff:'A game may need this turned off if presentation problems appear.',restart:'Restart game',primary:true,minBuild:22621,
    operations:[reg('HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences','DirectXUserGlobalSettings','SwapEffectUpgradeEnable=1;','String','semicolon')],
  },
  {
    id:'background-apps',name:'Background app control',category:'Windows',icon:'Layers',tag:'Optional',impact:'Background activity',
    description:'Stop supported Store apps from running in the background.',detail:'Restricts Windows app background activity across this PC. Desktop apps are unaffected.',
    tradeoff:'Some apps may stop syncing or sending notifications while closed.',restart:'Sign out',primary:true,admin:true,minBuild:15063,proOnly:true,
    operations:[reg('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\AppPrivacy','LetAppsRunInBackground',2)],
  },
  {
    id:'update-bandwidth',name:'Update bandwidth control',category:'Network',icon:'Download',tag:'Optional',impact:'Bandwidth',
    description:'Limit background Windows downloads and stop update sharing.',detail:'Caps Delivery Optimization background downloads at 1 MB/s and turns off peer-to-peer update sharing.',
    tradeoff:'Background Windows and Store updates take longer. Updates remain enabled.',restart:'New downloads',primary:true,admin:true,minBuild:19041,proOnly:true,
    operations:[reg('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DeliveryOptimization','DOMaxBackgroundDownloadBandwidth',1024),reg('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DeliveryOptimization','DODownloadMode',0)],
  },
  {
    id:'ethernet-optimization',name:'Ethernet optimization',category:'Network',icon:'Network',tag:'Advanced',impact:'Network response',
    description:'Tune Ethernet packet handling and power saving together.',detail:'Uses supported low-latency, multicore processing, and energy-saving options on active Ethernet adapters.',
    tradeoff:'Can increase CPU and power use. Results depend on your adapter; restart to activate.',restart:'Restart PC',primary:true,admin:true,networkSettings:networkControls['ethernet-optimization'],
  },
  {
    id:'ethernet-idle-sleep',name:'Ethernet idle-sleep fix',category:'Network',icon:'Network',tag:'Troubleshooting',impact:'Connection stability',
    description:'Try this for Ethernet dropouts or slow reconnection after idle.',
    detail:'Disables NDIS selective suspend only on active Ethernet adapters whose drivers expose and support that option. This is separate from Energy Efficient Ethernet and interrupt moderation.',
    tradeoff:'Uses more adapter power, including on battery. Keep the default unless idle-related problems occur. It is not an FPS or internet-ping boost. Restart to activate; Rankly does not interrupt the live connection.',
    restart:'Restart PC',primary:true,admin:true,networkSettings:networkControls['ethernet-idle-sleep'],
    source:'https://learn.microsoft.com/en-us/windows-hardware/drivers/network/standardized-inf-keywords-for-ndis-selective-suspend',
  },
  {
    id:'wifi-performance',name:'Wi-Fi performance power',category:'Network',icon:'Network',tag:'Wi-Fi',impact:'Wireless power',
    description:'Favor Wi-Fi performance while plugged in.',detail:'Uses maximum wireless adapter performance in your plugged-in power settings.',
    tradeoff:'Uses more power. Driver support determines whether this setting takes effect.',restart:'Instant',primary:true,admin:true,hardware:'wifi',powerSettings:powerControls['wifi-performance'],
  },
  {
    id:'wifi-smps',name:'Wi-Fi antenna power fix',category:'Network',icon:'Network',tag:'Troubleshooting',impact:'Wi-Fi compatibility',
    description:'Try No SMPS for Intel Wi-Fi link problems with older access points.',
    detail:'Keeps the adapter’s receive antennas active. Intel documents No SMPS as a workaround for access points that handle antenna power saving poorly. Separate from the Windows Wi-Fi power-plan preference.',
    tradeoff:'For existing link-quality problems only. Uses more power on AC and battery; no guaranteed ping or FPS gain. Applies to supported connected Intel Wi-Fi adapters. Restart to activate or restore; Rankly leaves the live connection running.',
    restart:'Restart PC',primary:true,admin:true,minBuild:10240,wifiSetting:wifiControls['wifi-smps'],
    source:'https://www.intel.com/content/www/us/en/support/articles/000005585/wireless/legacy-intel-wireless-products.html',
  },
  {
    id:'wifi-uapsd',name:'Wi-Fi U-APSD compatibility',category:'Network',icon:'Network',tag:'Troubleshooting',impact:'Wi-Fi compatibility',
    description:'Try disabling U-APSD when an access point causes poor receive speed.',
    detail:'Disables this Intel Wi-Fi power-saving option for access-point interoperability problems. It is already disabled by default on many drivers, so matching settings need no change.',
    tradeoff:'Can increase battery use, including during voice chat. Helps only affected connections; no guaranteed ping or FPS gain. Applies to supported connected Intel Wi-Fi adapters. Restart to activate or restore; Rankly leaves the live connection running.',
    restart:'Restart PC',primary:true,admin:true,minBuild:10240,wifiSetting:wifiControls['wifi-uapsd'],
    source:'https://www.intel.com/content/www/us/en/support/articles/000005585/wireless/legacy-intel-wireless-products.html',
  },
  {
    id:'usb-stability',name:'USB disconnect fix',category:'Input',icon:'Mouse',tag:'Troubleshooting',impact:'Device stability',
    description:'Try this if USB devices disconnect after being idle.',detail:'Disables USB selective suspend while plugged in to troubleshoot idle-related disconnects.',
    tradeoff:'Keep the default unless you have disconnects. This uses more power and is not an FPS boost.',restart:'Restart PC',primary:true,admin:true,powerSettings:powerControls['usb-stability'],
  },
  {
    id:'stay-awake',name:'Keep your setup awake',category:'Gaming',icon:'Monitor',tag:'Optional',impact:'Gaming sessions',
    description:'Prevent idle display-off, sleep, and hibernation while plugged in.',detail:'Keeps long controller sessions and game downloads from being interrupted by idle timers.',
    tradeoff:'Your screen and PC stay on until you turn them off. Battery timers stay unchanged.',restart:'Instant',primary:true,admin:true,powerSettings:powerControls['stay-awake'],
  },
  {
    id:'hdd-readiness',name:'Keep game drives ready',category:'CPU & power',icon:'HardDrive',tag:'Hard drives',impact:'Drive readiness',
    description:'Stop idle hard drives from spinning down while plugged in.',detail:'Disables the idle disk power-off timer on PCs with a detected mechanical drive.',
    tradeoff:'Mechanical drives stay spinning and use more power. This provides no SSD speed boost.',restart:'Instant',primary:true,admin:true,hardware:'hdd',powerSettings:powerControls['hdd-readiness'],
  },
  {
    id:'lean-services',name:'Lean Windows services',category:'Windows',icon:'Layers',tag:'Aggressive',impact:'Background CPU & disk',
    description:'Stop search indexing, app preloading, and diagnostic telemetry.',detail:'Stops and disables Windows Search, SysMain, and Connected User Experiences and Telemetry when installed.',
    tradeoff:'File and Outlook searches can slow down, apps may start slower, and background diagnostics are reduced. Stays disabled until restored.',restart:'Instant',primary:true,admin:true,aggressive:true,services:[...leanServices],
  },
  {
    id:'browser-background',name:'Browser background control',category:'Windows',icon:'PanelsTopLeft',tag:'Aggressive',impact:'Background apps',
    description:'Stop Edge and Chrome from lingering after you close them.',detail:'Turns off Edge startup boost and background app mode in Edge and Chrome.',
    tradeoff:'Closed-browser apps and notifications stop. Browsers may open slower and show a managed-settings label.',restart:'Restart browser',primary:true,admin:true,aggressive:true,hardware:'browser',
    operations:[reg('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge','StartupBoostEnabled',0),reg('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge','BackgroundModeEnabled',0),reg('HKLM:\\SOFTWARE\\Policies\\Google\\Chrome','BackgroundModeEnabled',0)],
  },
  {
    id:'onedrive-off',name:'OneDrive sync off',category:'Windows',icon:'Download',tag:'Aggressive',impact:'Background sync',
    description:'Disable OneDrive syncing and its Windows integration.',detail:'Prevents OneDrive file synchronization across this PC until you restore the setting. Keep needed files downloaded locally first.',
    tradeoff:'Cloud-only files and OneDrive access may be unavailable. File backups and changes stop syncing until restored.',restart:'Sign out',primary:true,admin:true,aggressive:true,minBuild:10240,proOnly:true,hardware:'onedrive',
    operations:[reg('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\OneDrive','DisableFileSyncNGSC',1)],
  },
  {
    id:'memory-integrity-off',name:'Memory Integrity off',category:'CPU & power',icon:'Cpu',tag:'Aggressive',impact:'CPU overhead',
    description:'Turn off Memory Integrity to remove its CPU overhead.',detail:'Disables Windows hypervisor-protected code integrity directly. A restart is required; other virtualization features stay as configured.',
    tradeoff:'Reduces kernel protection. Some anti-cheat systems require it enabled. FPS gains depend on the PC and game.',restart:'Restart PC',primary:true,admin:true,aggressive:true,minBuild:10240,hardware:'memory-integrity',
    operations:[reg(MEMORY_INTEGRITY_PATH,'Enabled',0)],
  },
  {
    id:'windows-cleanup', name:'Windows cleanup', category:'Windows', icon:'Sparkles', tag:'Optional', impact:'Less clutter',
    description:'Turn off Windows ads, tips, welcome screens, and suggestions.',
    detail:'Combines Windows promotional content and ad-personalization settings into one cleanup.',
    tradeoff:'Reduces clutter; it is not an FPS boost.',
    restart:'Sign out', primary:false,
    operations:operations('advertising','tailored','tips','welcome','suggestions'),
  },
];

// These are Windows shortcuts, not counted or presented as tweaks.
export const guides = [
  { id:'game-audio',name:'Game audio setup',category:'Gaming',icon:'SlidersHorizontal',description:'Check voice-chat volume drops and device audio effects.',detail:'If Windows lowers game volume during calls, open More sound settings (Sound Control Panel on Windows 10) → Communications → Do nothing. Calls will no longer lower other audio; chat apps may have separate attenuation settings. For crackling or distorted output, select the affected playback device and try Audio enhancements Off if available. On Windows 10, use Playback → device Properties → Enhancements. This can change the sound, so restore the option if it does not help. Note your original choices and undo changes on the same pages; manual Windows changes are not saved in Rankly Recovery. These are sound troubleshooting options, with no claimed FPS gain.',uri:'ms-settings:sound',source:'https://learn.microsoft.com/en-us/windows/win32/coreaudio/stream-attenuation' },
  { id:'notifications',name:'Notification settings',category:'Gaming',icon:'BellOff',description:'Choose quiet time and notification exceptions, including on Windows Home.',detail:'On Windows 11, expand Turn on do not disturb automatically and review When playing a game and the priority exceptions. On Windows 10, open System → Focus assist and review Automatic rules. Rules may already be enabled. These options reduce interruptions, not improve FPS. Restore Quiet app notifications in Rankly first if applied. Changes made in Windows Settings are not backed up by Rankly; change them back on the same Windows page.',uri:'ms-settings:notifications',source:'https://support.microsoft.com/en-us/windows/experience/notifications-and-do-not-disturb-in-windows' },
  { id:'graphics',name:'Graphics setup',category:'Graphics',icon:'Monitor',description:'GPU choice, display refresh rate, and windowed gaming.',detail:'Choose your gaming GPU in Graphics settings. On Windows 11, review windowed game optimizations. Set your monitor’s refresh rate in Display → Advanced display.',uri:'ms-settings:display-advancedgraphics',source:'https://support.microsoft.com/en-US/Windows/Hardware/Display-Graphics/optimizations-for-windowed-games-in-windows-11' },
  { id:'startup',name:'Startup apps',category:'Windows',icon:'Layers',description:'Choose which apps launch with Windows.',detail:'Turn off launchers and apps you do not need at sign-in. Keep security and device software you rely on.',uri:'ms-settings:startupapps' },
  { id:'storage',name:'Storage cleanup',category:'Windows',icon:'HardDrive',description:'Free space with Windows Storage settings.',detail:'Review temporary files before deleting them. Keep Downloads and shader caches unless you intend to remove them.',uri:'ms-settings:storagesense' },
  { id:'network-adapter',name:'Network settings',category:'Network',icon:'Network',description:'Manage your connection and adapter.',detail:'Use Ethernet when possible and pause large downloads while playing. Changing DNS does not guarantee lower game ping.',uri:'ms-settings:network-status' },
  { id:'updates',name:'Windows & drivers',category:'Windows',icon:'RefreshCw',description:'Keep your system and drivers up to date.',detail:'Check for Windows updates and install GPU drivers from your GPU vendor. Schedule updates outside your gaming sessions.',uri:'ms-settings:windowsupdate' },
];

export const recoveryTweaks = [...tweaks,...legacyV11Tweaks,...legacyTweaks.filter(old=>!tweaks.some(t=>t.id===old.id))];
function select(ids,catalog) {
  if (!Array.isArray(ids) || ids.length<1 || ids.length>catalog.length || ids.some(id=>typeof id!=='string'||!catalog.some(t=>t.id===id)) || new Set(ids).size!==ids.length) throw new Error('Choose valid, unique tweaks from the library.');
  return ids.map(id=>catalog.find(t=>t.id===id));
}
export const validateTweakIds = ids => select(ids,tweaks);
export const validateRecoveryIds = ids => select(ids,recoveryTweaks);
