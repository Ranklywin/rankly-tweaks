
$report=__RANKLY_REPORT_PATH__
try {
  $process=Start-Process -FilePath "$env:SystemRoot\System32\dxdiag.exe" -ArgumentList @('/whql:off','/x',('"'+$report+'"')) -WindowStyle Hidden -PassThru
  if (!$process.WaitForExit(25000)) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue; throw 'Graphics detection timed out.' }
  [xml]$dx=Get-Content -LiteralPath $report -Raw
  $devices=@($dx.DxDiag.DisplayDevices.DisplayDevice)
  $supported=@($devices | Where-Object { [string]$_.HardwareSchedulingAttributes -match 'Supported:\s*True|DriverSupportState:\s*Stable' }).Count -gt 0
  # WDDM 2.6 is the documented driver floor for the Windows VRR option, encoded as 206.
  $wddm=0
  foreach($device in $devices) { $match=[regex]::Match([string]$device.DriverModel,'WDDM\s*(\d+)\.(\d+)'); if($match.Success) { $wddm=[math]::Max($wddm,[int]$match.Groups[1].Value*100+[int]$match.Groups[2].Value) } }
  ConvertTo-Json -InputObject @{hags=$supported;wddm=$wddm} -Compress
} finally { Remove-Item -LiteralPath $report -ErrorAction SilentlyContinue }
