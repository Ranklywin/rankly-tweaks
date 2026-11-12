
$sessionId=(Get-Process -Id $PID).SessionId
$ownerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$items=@(foreach($cim in @(Get-CimInstance Win32_Process -Filter __RANKLY_PROCESS_FILTER__)) {
  if($cim.SessionId -ne $sessionId) {continue}
  try {
    $owner=Invoke-CimMethod -InputObject $cim -MethodName GetOwnerSid -ErrorAction Stop
    if($owner.ReturnValue -ne 0 -or $owner.Sid -ne $ownerSid) {continue}
    $proc=Get-Process -Id $cim.ProcessId -ErrorAction Stop
    try {
      $null=$proc.Handle
      @{pid=$proc.Id;executable=$cim.Name;path=$proc.MainModule.FileName;started=$proc.StartTime.ToUniversalTime().Ticks.ToString();memoryBytes=$proc.WorkingSet64}
    } finally {$proc.Dispose()}
  } catch {}
})
ConvertTo-Json -InputObject $items -Depth 5 -Compress
