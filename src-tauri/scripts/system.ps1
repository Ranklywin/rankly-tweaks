
$osInfo = Get-CimInstance Win32_OperatingSystem
$cpuInfo = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpus = @(Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, CurrentRefreshRate)
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$battery = @(Get-CimInstance Win32_Battery)
$adapters = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' | Select-Object Name, InterfaceDescription, LinkSpeed)
$active = (& powercfg.exe /getactivescheme | Out-String).Trim()
@{ os=$osInfo.Caption; build=$osInfo.BuildNumber; cpu=$cpuInfo.Name.Trim(); cores=$cpuInfo.NumberOfCores; threads=$cpuInfo.NumberOfLogicalProcessors; memoryTotal=[math]::Round($osInfo.TotalVisibleMemorySize / 1MB, 1); memoryFree=[math]::Round($osInfo.FreePhysicalMemory / 1MB, 1); gpus=$gpus; diskTotal=[math]::Round($disk.Size / 1GB, 1); diskFree=[math]::Round($disk.FreeSpace / 1GB, 1); laptop=($battery.Count -gt 0); administrator=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); adapters=$adapters; powerPlan=$active; scannedAt=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Depth 5 -Compress