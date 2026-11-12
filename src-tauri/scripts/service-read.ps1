
function Get-RanklyServiceSnapshot([string]$name) {
  $svc=Get-Service -Name $name -ErrorAction Stop
  $svc.Refresh()
  if ([string]$svc.Status -notin @('Running','Stopped')) { throw 'A selected service is changing state. Wait a moment and scan again.' }
  $key=Get-Item -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Services\'+$name) -ErrorAction Stop
  if ($key.GetValueKind('Start').ToString() -ne 'DWord') { throw 'Unsupported service startup setting.' }
  $delay=@{exists=$false}
  if ($key.GetValueNames() -contains 'DelayedAutoStart') { $delay=@{exists=$true;kind=$key.GetValueKind('DelayedAutoStart').ToString();value=$key.GetValue('DelayedAutoStart')} }
  @{type='service';name=$name;value=@{startup=$key.GetValue('Start');running=([string]$svc.Status -eq 'Running');delayed=$delay}}
}
