import { randomUUID } from 'node:crypto';
import { backgroundApps } from '../shared/aggressive.mjs';
import { isLocalGameExecutable } from '../shared/game-preferences.mjs';
import { runPowerShell, psQuote } from './windows.mjs';

export const appSnapshotScript = `
$sessionId=(Get-Process -Id $PID).SessionId
$ownerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$items=@(foreach($cim in @(Get-CimInstance Win32_Process -Filter ${psQuote(backgroundApps.flatMap(a=>a.executables).map(n=>`Name='${n}'`).join(' OR '))})) {
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
`;

function validProcess(p) {
  return p && Number.isInteger(p.pid)&&p.pid>0&&p.pid<=4294967295&&
    typeof p.started==='string'&&/^\d{15,20}$/.test(p.started)&&
    typeof p.executable==='string'&&isLocalGameExecutable(p.path)&&
    p.path.split('\\').at(-1).toLowerCase()===p.executable.toLowerCase()&&
    backgroundApps.some(a=>a.executables.some(n=>n.toLowerCase()===p.executable.toLowerCase()));
}

export function closeAppsScript(processes) {
  if(!Array.isArray(processes)||!processes.length||processes.length>1024||processes.some(p=>!validProcess(p)))throw new Error('Invalid app snapshot.');
  return `
$sessionId=(Get-Process -Id $PID).SessionId
$ownerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$results=@(
${processes.map(p=>`
$proc=$null
try {
  $proc=[System.Diagnostics.Process]::GetProcessById(${p.pid})
  $null=$proc.Handle
  if($proc.SessionId -ne $sessionId -or $proc.StartTime.ToUniversalTime().Ticks.ToString() -cne ${psQuote(p.started)} -or $proc.MainModule.FileName -ine ${psQuote(p.path)}) { @{status='skipped'} }
  else {
    $cim=Get-CimInstance Win32_Process -Filter 'ProcessId = ${p.pid}' -ErrorAction Stop
    $owner=Invoke-CimMethod -InputObject $cim -MethodName GetOwnerSid -ErrorAction Stop
    if($owner.ReturnValue -ne 0 -or $owner.Sid -ne $ownerSid) { @{status='skipped'} }
    else {
      $proc.Kill()
      if(!$proc.WaitForExit(2000)) { @{status='failed'} } else { @{status='closed'} }
    }
  }
} catch [System.ArgumentException] { @{status='skipped'} }
catch { @{status='failed'} }
finally {if($null -ne $proc) {$proc.Dispose()}}
`).join('\n')}
)
@{closedProcesses=@($results | Where-Object status -eq 'closed').Count;skippedProcesses=@($results | Where-Object status -eq 'skipped').Count;failedProcesses=@($results | Where-Object status -eq 'failed').Count} | ConvertTo-Json -Compress
`;
}

export class SessionApps {
  constructor(adapter={list:()=>runPowerShell(appSnapshotScript),close:processes=>runPowerShell(closeAppsScript(processes),60000)},clock=Date.now) {
    this.adapter=adapter;this.clock=clock;this.tokens=new Map();this.busy=false;
  }
  async scan() {
    if(this.busy)throw new Error('Wait for app closing to finish.');
    const processes=await this.adapter.list();
    if(!Array.isArray(processes))throw new Error('Could not read background apps.');
    this.tokens.clear();
    return backgroundApps.flatMap(app=>{
      const matches=processes.filter(p=>validProcess(p)&&app.executables.some(n=>n.toLowerCase()===p.executable.toLowerCase()));
      if(!matches.length)return [];
      const token=randomUUID();this.tokens.set(token,{processes:structuredClone(matches),expires:this.clock()+300000});
      return [{token,name:app.name,processCount:matches.length,memoryMB:Math.round(matches.reduce((sum,p)=>sum+(Number.isFinite(p.memoryBytes)&&p.memoryBytes>0?p.memoryBytes:0),0)/1048576)}];
    });
  }
  async close(tokens) {
    if(this.busy)throw new Error('Another app close is in progress.');
    if(!Array.isArray(tokens)||!tokens.length||tokens.length>backgroundApps.length||new Set(tokens).size!==tokens.length||tokens.some(t=>typeof t!=='string'||!this.tokens.has(t)||this.tokens.get(t).expires<this.clock())) throw new Error('Refresh the app list and choose the apps again.');
    this.busy=true;
    const processes=tokens.flatMap(t=>this.tokens.get(t).processes);
    this.tokens.clear(); // One-use tokens prevent replaying an old selection.
    try {return await this.adapter.close(processes);} finally {this.busy=false;}
  }
}
