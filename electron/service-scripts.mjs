import { leanServices, validServiceValue } from '../shared/aggressive.mjs';
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";

export const serviceReadPrelude=`
function Get-RanklyServiceSnapshot([string]$name) {
  $svc=Get-Service -Name $name -ErrorAction Stop
  $svc.Refresh()
  if ([string]$svc.Status -notin @('Running','Stopped')) { throw 'A selected service is changing state. Wait a moment and scan again.' }
  $key=Get-Item -LiteralPath ('HKLM:\\SYSTEM\\CurrentControlSet\\Services\\'+$name) -ErrorAction Stop
  if ($key.GetValueKind('Start').ToString() -ne 'DWord') { throw 'Unsupported service startup setting.' }
  $delay=@{exists=$false}
  if ($key.GetValueNames() -contains 'DelayedAutoStart') { $delay=@{exists=$true;kind=$key.GetValueKind('DelayedAutoStart').ToString();value=$key.GetValue('DelayedAutoStart')} }
  @{type='service';name=$name;value=@{startup=$key.GetValue('Start');running=([string]$svc.Status -eq 'Running');delayed=$delay}}
}
`;

export function serviceWriteScript(operation) {
  if(!leanServices.includes(operation.name)||!validServiceValue(operation.value)) throw new Error('Unsupported service snapshot.');
  const v=operation.value;
  const delayPath='HKLM:\\SYSTEM\\CurrentControlSet\\Services\\'+operation.name;
  const startup={2:'Automatic',3:'Manual',4:'Disabled'}[v.startup];
  // When restoring an unusual disabled-but-running service, briefly allow a
  // start, then put its exact startup setting back. Dependencies must already
  // be running; never change an unjournaled service to satisfy a dependency.
  return `
$svc=Get-Service -Name ${quote(operation.name)} -ErrorAction Stop
$svc.Refresh()
if ([string]$svc.Status -notin @('Running','Stopped')) { throw 'The service is changing state. Retry recovery when it settles.' }
${v.running?`if ([string]$svc.Status -ne 'Running' -and @($svc.ServicesDependedOn | Where-Object Status -ne 'Running').Count) { throw 'A required service is stopped. Start it in Windows before restoring this backup.' }`:`if ([string]$svc.Status -ne 'Stopped' -and @($svc.DependentServices | Where-Object Status -ne 'Stopped').Count) { throw 'Another service depends on this one. No dependent services were stopped.' }`}
${v.running?`if ([string]$svc.Status -ne 'Running') {
  Set-Service -Name ${quote(operation.name)} -StartupType ${v.startup===4?'Manual':startup} -ErrorAction Stop
  Start-Service -Name ${quote(operation.name)} -ErrorAction Stop
  $svc.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running,[TimeSpan]::FromSeconds(15))
}
Set-Service -Name ${quote(operation.name)} -StartupType ${startup} -ErrorAction Stop`:`Set-Service -Name ${quote(operation.name)} -StartupType ${startup} -ErrorAction Stop
if ([string]$svc.Status -ne 'Stopped') {
  Stop-Service -Name ${quote(operation.name)} -ErrorAction Stop
  $svc.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(15))
}`}
${v.delayed.exists?`New-ItemProperty -LiteralPath ${quote(delayPath)} -Name 'DelayedAutoStart' -PropertyType DWord -Value ${v.delayed.value} -Force -ErrorAction Stop | Out-Null`:`Remove-ItemProperty -LiteralPath ${quote(delayPath)} -Name 'DelayedAutoStart' -ErrorAction SilentlyContinue`}
`;
}
