import { securityReadPrelude } from './security-scripts.mjs';
import { leanServices } from '../shared/aggressive.mjs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { powerControls, networkControls } from '../shared/power-settings.mjs';
import { powerReadPrelude } from './native-scripts.mjs';
import { keyboardShortcuts } from '../shared/keyboard-settings.mjs';
import { keyboardReadPrelude } from './keyboard-scripts.mjs';
import { wifiControls } from '../shared/wifi-settings.mjs';
import { wifiReadPrelude } from './wifi-scripts.mjs';

const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
let gpuSupport;
async function hagsSupport(run) {
  if(!gpuSupport) gpuSupport=run(`
$report=${quote(path.join(os.tmpdir(),`rankly-capabilities-${randomUUID()}.xml`))}
try {
  $process=Start-Process -FilePath "$env:SystemRoot\\System32\\dxdiag.exe" -ArgumentList @('/whql:off','/x',('"'+$report+'"')) -WindowStyle Hidden -PassThru
  if (!$process.WaitForExit(25000)) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue; throw 'Graphics detection timed out.' }
  [xml]$dx=Get-Content -LiteralPath $report -Raw
  $supported=@($dx.DxDiag.DisplayDevices.DisplayDevice | Where-Object { [string]$_.HardwareSchedulingAttributes -match 'Supported:\\s*True|DriverSupportState:\\s*Stable' }).Count -gt 0
  ConvertTo-Json -InputObject $supported -Compress
} finally { Remove-Item -LiteralPath $report -ErrorAction SilentlyContinue }
`,30000).catch(()=>false);
  return gpuSupport;
}

export async function getCapabilities(run) {
  const settings=[...new Map(Object.values(powerControls).flat().map(s=>[`${s.subgroup}/${s.setting}`,s])).values()];
  const keywords=[...new Set(Object.values(networkControls).flat().map(s=>s.keyword))];
  const [capabilities,hags]=await Promise.all([run(`
${powerReadPrelude}
${securityReadPrelude}
${wifiReadPrelude}
$version=Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$active=(& powercfg.exe /getactivescheme | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'The current power plan could not be read.' }
$scheme=[regex]::Match($active,'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}').Value.ToLower()
$planText=(& powercfg.exe /list | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Power plan availability could not be read.' }
$plans=@([regex]::Matches($planText,'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}') | ForEach-Object { $_.Value.ToLower() })
$targetPlans=@($scheme,'8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' | Select-Object -Unique | Where-Object { $plans -contains $_ })
$powerValues=@(foreach($plan in $targetPlans) {
${settings.map(s=>`[uint32]$value=0; $result=[RanklyPowerReader]::Read($plan,${quote(s.subgroup)},${quote(s.setting)},[ref]$value); @{scheme=$plan;subgroup=${quote(s.subgroup)};setting=${quote(s.setting)};value=$value;available=($result -eq 0)}`).join('\n')}
})
$adapters=@(Get-NetAdapter -Physical -ErrorAction SilentlyContinue)
$keywords=@(${keywords.map(quote).join(',')})
$properties=@(foreach($nic in $adapters | Where-Object { $_.Status -eq 'Up' -and [string]$_.MediaType -eq '802.3' }) {
  try {
    Get-NetAdapterAdvancedProperty -Name ([System.Management.Automation.WildcardPattern]::Escape($nic.Name)) -AllProperties -ErrorAction Stop | Where-Object { $keywords -ccontains $_.RegistryKeyword } | ForEach-Object {
      @{adapter=([string]$nic.InterfaceGuid).Trim('{}').ToLower();keyword=$_.RegistryKeyword;value=@($_.RegistryValue | ForEach-Object { [string]$_ });validValues=@($_.ValidRegistryValues | ForEach-Object { [string]$_ })}
    }
  } catch { }
})
$wifi=@($adapters | Where-Object { [string]$_.PhysicalMediaType -match '802.11|Wireless|Native' }).Count -gt 0
$wifiProperties=@(foreach($nic in $adapters | Where-Object { [string]$_.Status -eq 'Up' -and (Test-RanklyIntelWifi $_) }) {
  foreach($keyword in @(${Object.values(wifiControls).map(s=>quote(s.keyword)).join(',')})) {
    try { (Get-RanklyWifiSetting $nic $keyword).snapshot } catch { }
  }
})
$hdd=@(Get-PhysicalDisk -ErrorAction SilentlyContinue | Where-Object MediaType -eq 'HDD').Count -gt 0
# A power GUID existing in Windows does not prove that its storage driver is in use.
# Restrict these controls to working controllers using the documented Microsoft drivers.
$storageControllers=@()
try { $storageControllers=@(Get-CimInstance Win32_PnPEntity -Filter "Service='stornvme' OR Service='storahci'" -ErrorAction Stop | Where-Object { $_.ConfigManagerErrorCode -eq 0 }) } catch { }
$nvme=@($storageControllers | Where-Object Service -eq 'stornvme').Count -gt 0
$ahci=@($storageControllers | Where-Object Service -eq 'storahci').Count -gt 0
$optionalServices=@(foreach($serviceName in @(${leanServices.map(quote).join(',')})) {try {$svc=Get-Service -Name $serviceName -ErrorAction Stop; @{name=$serviceName;available=([string]$svc.Status -in @('Running','Stopped'))}} catch {}})
$browser=(@('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe','HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe') | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0
$onedrive=(Test-Path -LiteralPath 'HKCU:\\Software\\Microsoft\\OneDrive') -or (Test-Path -LiteralPath "$env:LOCALAPPDATA\\Microsoft\\OneDrive\\OneDrive.exe") -or (Test-Path -LiteralPath "$env:ProgramFiles\\Microsoft OneDrive\\OneDrive.exe")
$cpu=(Get-CimInstance Win32_Processor | Select-Object -First 1).Name
$keyboardShortcuts=@()
try {
${keyboardReadPrelude}
  $keyboardShortcuts=@(${keyboardShortcuts.map(name=>`Get-RanklyKeyboardShortcut ${quote(name)}`).join('\n')})
} catch { $keyboardShortcuts=@() }
@{wifiProperties=$wifiProperties;keyboardShortcuts=$keyboardShortcuts;memoryIntegrity=(Get-RanklyMemoryIntegrityStatus);services=$optionalServices;browser=$browser;onedrive=$onedrive;scheme=$scheme;plans=$plans;powerValues=$powerValues;networkProperties=$properties;wifi=$wifi;hdd=$hdd;nvme=$nvme;ahci=$ahci;cpu=$cpu;build=[int]$version.CurrentBuildNumber;edition=$version.EditionID;admin=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)} | ConvertTo-Json -Depth 8 -Compress
`),hagsSupport(run)]);
  return {...capabilities,hags};
}
