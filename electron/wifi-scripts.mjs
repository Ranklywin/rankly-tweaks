import { wifiControls, validWifiValue, isIntelWifiId } from '../shared/wifi-settings.mjs';

export const wifiReadPrelude=`
function Test-RanklyIntelWifi($nic) {
  return ($nic.HardwareInterface -eq $true -and $nic.Virtual -eq $false -and $nic.NdisPhysicalMedium -in @(1,9) -and [string]$nic.PnPDeviceID -match '^PCI\\\\VEN_8086&DEV_[0-9A-F]{4}(?:&|\\\\)' -and [string]$nic.DriverProvider -match '^Intel(?:\\b|\\()' -and $nic.AdminLocked -ne $true)
}
function Get-RanklyWifiSetting($nic,[string]$keyword) {
  if (!(Test-RanklyIntelWifi $nic)) { throw 'The saved Intel Wi-Fi hardware or driver is unavailable or managed. The backup has been kept.' }
  if (@(${Object.values(wifiControls).map(s=>`'${s.keyword}'`).join(',')}) -cnotcontains $keyword) { throw 'Unknown Wi-Fi setting.' }
  $properties=@(Get-NetAdapterAdvancedProperty -Name ([System.Management.Automation.WildcardPattern]::Escape($nic.Name)) -IncludeHidden -AllProperties -ErrorAction Stop | Where-Object RegistryKeyword -CEQ $keyword)
  if ($properties.Count -ne 1) { throw 'The Wi-Fi driver no longer exposes this setting. The backup has been kept.' }
  $property=$properties[0]
  $values=@($property.ValidRegistryValues | ForEach-Object { [string]$_ })
  $labels=@($property.ValidDisplayValues | ForEach-Object { ([string]$_).Trim() })
  $current=@($property.RegistryValue | ForEach-Object { [string]$_ })
  if ($values.Count -lt 2 -or $values.Count -gt 16 -or $labels.Count -ne $values.Count -or $current.Count -ne 1) { throw 'Wi-Fi driver choices could not be verified.' }
  $choices=@(for($i=0;$i -lt $values.Count;$i++) {
    if ($values[$i] -notmatch '^\\d{1,10}$' -or [decimal]$values[$i] -gt 4294967295 -or !$labels[$i] -or $labels[$i].Length -gt 128 -or $labels[$i] -match '[\\x00-\\x1f]') { throw 'Unsupported Wi-Fi driver choices.' }
    @{value=$values[$i];label=$labels[$i]}
  })
  if (@($values | Select-Object -Unique).Count -ne $values.Count -or @($labels | ForEach-Object { $_.ToLowerInvariant() } | Select-Object -Unique).Count -ne $labels.Count) { throw 'Ambiguous Wi-Fi driver choices.' }
  $index=[array]::IndexOf($values,$current[0])
  if ($index -lt 0) { throw 'The current Wi-Fi value cannot be restored safely.' }
  if (([string]$property.DisplayValue).Trim() -ine $labels[$index]) { throw 'The Wi-Fi driver labels do not match its current value.' }
  $snapshot=@{type='wifi-property';adapter=([string]$nic.InterfaceGuid).Trim('{}').ToLowerInvariant();deviceId=([string]$nic.PnPDeviceID).ToUpperInvariant();keyword=$keyword;value=$current;label=$labels[$index];choices=$choices;available=$true;up=([string]$nic.Status -eq 'Up')}
  @{property=$property;snapshot=$snapshot}
}
function Get-RanklySavedWifiSetting([string]$adapter,[string]$deviceId,[string]$keyword) {
  $wifiMatches=@(Get-NetAdapter -IncludeHidden -ErrorAction Stop | Where-Object { ([string]$_.InterfaceGuid).Trim('{}') -ieq $adapter -and [string]$_.PnPDeviceID -ieq $deviceId })
  if ($wifiMatches.Count -ne 1) { throw 'The original Wi-Fi adapter is unavailable. Reconnect it before restoring; the backup has been kept.' }
  Get-RanklyWifiSetting $wifiMatches[0] $keyword
}
`;

export function wifiWriteScript(o,quote) {
  if(!isIntelWifiId(o.deviceId)||!validWifiValue(o)) throw new Error('Invalid Wi-Fi setting snapshot.');
  return `
$wifi=Get-RanklySavedWifiSetting ${quote(o.adapter)} ${quote(o.deviceId)} ${quote(o.keyword)}
${o.requireUp===true?"if (!$wifi.snapshot.up) { throw 'The selected Wi-Fi adapter is no longer connected. Scan again before applying.' }":''}
$choice=@($wifi.snapshot.choices | Where-Object { $_.value -ceq ${quote(o.value[0])} -and $_.label -ieq ${quote(o.label.trim())} })
if ($choice.Count -ne 1) { throw 'The Wi-Fi driver choices changed. No replacement value was guessed; the backup has been kept.' }
if ($wifi.snapshot.value[0] -cne ${quote(o.value[0])}) {
  Set-NetAdapterAdvancedProperty -InputObject $wifi.property -RegistryValue @(${quote(o.value[0])}) -NoRestart -ErrorAction Stop | Out-Null
}
`;
}
