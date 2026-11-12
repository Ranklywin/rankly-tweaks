
__RANKLY_POWER_READ_PRELUDE__
__RANKLY_SECURITY_READ_PRELUDE__
__RANKLY_WIFI_READ_PRELUDE__
$version=Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$active=(& powercfg.exe /getactivescheme | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'The current power plan could not be read.' }
$scheme=[regex]::Match($active,'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}').Value.ToLower()
$planText=(& powercfg.exe /list | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Power plan availability could not be read.' }
$plans=@([regex]::Matches($planText,'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}') | ForEach-Object { $_.Value.ToLower() })
$targetPlans=@($scheme,'8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' | Select-Object -Unique | Where-Object { $plans -contains $_ })
$powerValues=@(foreach($plan in $targetPlans) {
__RANKLY_POWER_READS__
})
$adapters=@(Get-NetAdapter -Physical -ErrorAction SilentlyContinue)
$keywords=@(__RANKLY_NETWORK_KEYWORDS__)
$properties=@(foreach($nic in $adapters | Where-Object { $_.Status -eq 'Up' -and [string]$_.MediaType -eq '802.3' }) {
  try {
    Get-NetAdapterAdvancedProperty -Name ([System.Management.Automation.WildcardPattern]::Escape($nic.Name)) -AllProperties -ErrorAction Stop | Where-Object { $keywords -ccontains $_.RegistryKeyword } | ForEach-Object {
      @{adapter=([string]$nic.InterfaceGuid).Trim('{}').ToLower();keyword=$_.RegistryKeyword;value=@($_.RegistryValue | ForEach-Object { [string]$_ });validValues=@($_.ValidRegistryValues | ForEach-Object { [string]$_ })}
    }
  } catch { }
})
$wifi=@($adapters | Where-Object { [string]$_.PhysicalMediaType -match '802.11|Wireless|Native' }).Count -gt 0
$wifiProperties=@(foreach($nic in $adapters | Where-Object { [string]$_.Status -eq 'Up' -and (Test-RanklyIntelWifi $_) }) {
  foreach($keyword in @(__RANKLY_WIFI_KEYWORDS__)) {
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
$optionalServices=@(foreach($serviceName in @(__RANKLY_LEAN_SERVICES__)) {try {$svc=Get-Service -Name $serviceName -ErrorAction Stop; @{name=$serviceName;available=([string]$svc.Status -in @('Running','Stopped'))}} catch {}})
$browser=(@('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe','HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe','HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe') | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0
$onedrive=(Test-Path -LiteralPath 'HKCU:\Software\Microsoft\OneDrive') -or (Test-Path -LiteralPath "$env:LOCALAPPDATA\Microsoft\OneDrive\OneDrive.exe") -or (Test-Path -LiteralPath "$env:ProgramFiles\Microsoft OneDrive\OneDrive.exe")
$cpu=(Get-CimInstance Win32_Processor | Select-Object -First 1).Name
$keyboardShortcuts=@()
try {
__RANKLY_KEYBOARD_READ_PRELUDE__
  $keyboardShortcuts=@(__RANKLY_KEYBOARD_READS__)
} catch { $keyboardShortcuts=@() }
@{wifiProperties=$wifiProperties;keyboardShortcuts=$keyboardShortcuts;memoryIntegrity=(Get-RanklyMemoryIntegrityStatus);services=$optionalServices;browser=$browser;onedrive=$onedrive;scheme=$scheme;plans=$plans;powerValues=$powerValues;networkProperties=$properties;wifi=$wifi;hdd=$hdd;nvme=$nvme;ahci=$ahci;cpu=$cpu;build=[int]$version.CurrentBuildNumber;edition=$version.EditionID;admin=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)} | ConvertTo-Json -Depth 8 -Compress
