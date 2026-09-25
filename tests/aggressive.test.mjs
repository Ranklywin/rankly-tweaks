import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TweakEngine } from '../electron/engine.mjs';
import { validateTweakIds } from '../shared/catalog.mjs';
import { leanServices } from '../shared/aggressive.mjs';
import { operationsFor, materializeOperations, equalOperations, operationKey, validateBackupOperations, unavailableReason } from '../shared/operations.mjs';
import { buildReadScript, buildWriteScript, runPowerShell, psQuote } from '../electron/windows.mjs';
import { SessionApps, closeAppsScript } from '../electron/session-apps.mjs';

const serviceContext={services:leanServices.map(name=>({name,available:true}))};
const desired=()=>operationsFor(validateTweakIds(['lean-services']),serviceContext);
const originals=()=>desired().map((o,i)=>({...o,value:{startup:i===2?3:2,running:i!==2,delayed:i===0?{exists:true,kind:'DWord',value:1}:{exists:false}}}));
async function fixture(t) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'rankly-aggressive-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const values=new Map(originals().map(o=>[operationKey(o),structuredClone(o)]));
  const adapter={resolve:async selected=>operationsFor(selected,serviceContext),read:async ops=>ops.map(o=>structuredClone(values.get(operationKey(o))||{type:'registry',path:o.path,name:o.name,exists:false})),write:async ops=>{for(const o of ops)values.set(operationKey(o),structuredClone(o));}};
  return {directory,adapter,values,engine:new TweakEngine(directory,adapter)};
}

test('aggressive service changes preserve original startup, running and delayed-start states',async t=>{
  const f=await fixture(t);const write=f.adapter.write;
  f.adapter.write=async ops=>{const journal=JSON.parse(await readFile(path.join(f.directory,'recovery.json'),'utf8'));assert.equal(journal[0].status,'prepared');assert.deepEqual(journal[0].before,originals());await write(ops);};
  const entry=await f.engine.apply(['lean-services']);f.adapter.write=write;
  assert.ok(entry.after.every(o=>o.value.startup===4&&!o.value.running));
  assert.deepEqual(entry.after.map(o=>o.value.delayed),originals().map(o=>o.value.delayed));
  assert.equal((await f.engine.apply(['lean-services'])).unchanged,true);
  await f.engine.restore(entry.id);assert.deepEqual(await f.adapter.read(desired()),originals());
});

test('partly disabled service bundles roll back together and recover across registry changes',async t=>{
  const f=await fixture(t);const write=f.adapter.write;let writes=0;
  f.adapter.write=async ops=>{if(++writes===1){await write(ops.slice(0,1));throw new Error('Cannot stop second service');}await write(ops);};
  await assert.rejects(f.engine.apply(['lean-services','browser-background']),/restored and verified/);
  assert.deepEqual(await f.adapter.read(desired()),originals());
  f.adapter.write=write;const first=await f.engine.apply(['lean-services']);const second=await f.engine.apply(['browser-background']);
  await assert.rejects(f.engine.restore(first.id),/most recent/);
  await f.engine.restore(second.id);await f.engine.restore(first.id);
  assert.deepEqual(await f.adapter.read(desired()),originals());
});

test('missing or removed services are skipped on apply but retain their original recovery targets',async t=>{
  const selected=validateTweakIds(['lean-services']);assert.equal(operationsFor(selected,{services:[{name:'WSearch',available:true}]}).length,1);
  assert.match(unavailableReason(selected[0],{services:[]}),/No available/);
  const f=await fixture(t);const entry=await f.engine.apply(['lean-services']);const write=f.adapter.write;
  f.adapter.write=async()=>{throw new Error('Saved service was removed');};
  await assert.rejects(f.engine.restore(entry.id),/removed/);
  assert.equal((await f.engine.history())[0].status,'recovery-needed');
  await assert.rejects(f.engine.apply(['browser-background']),/interrupted/);
  f.adapter.write=write;await f.engine.restore(entry.id);
});

test('service journal and native allowlists reject security services and changed snapshot values',()=>{
  const definitions=validateTweakIds(['lean-services']);const before=originals();const after=materializeOperations(desired(),before);
  validateBackupOperations({before,after},definitions);
  for(const name of ['WinDefend','BFE','wuauserv','vgc','RpcSs','WSearch; cmd'])assert.throws(()=>buildWriteScript([{...after[0],name}]),/allowlist/);
  assert.throws(()=>validateBackupOperations({before,after:after.map(o=>({...o,value:{...o.value,startup:2}}))},definitions),/unexpected/);
  assert.throws(()=>materializeOperations(desired(),before.map(o=>({...o,value:{...o.value,startup:0}}))),/Unsupported/);
  assert.equal(equalOperations(desired(),after),true);
  assert.equal(equalOperations(after,before),false);
});

test('native service scripts stop only the requested services and restore delayed start exactly',{skip:process.platform!=='win32'},async()=>{
  const before=originals();const after=materializeOperations(desired(),before);
  const result=await runPowerShell(`
Add-Type -AssemblyName System.ServiceProcess
$script:items=@{}
${before.map(o=>`$script:items['${o.name}']=@{startup=${o.value.startup};running=$${String(o.value.running)};delayExists=$${String(o.value.delayed.exists)};delay=${o.value.delayed.value||0}}`).join('\n')}
$script:calls=@()
function Get-Service { param([string]$Name)
  if(!$script:items.ContainsKey($Name)){throw 'Unexpected service'}
  $item=$script:items[$Name]
  $svc=[pscustomobject]@{Name=$Name;Status=$(if($item.running){'Running'}else{'Stopped'});DependentServices=@();ServicesDependedOn=@()}
  $svc | Add-Member ScriptMethod Refresh {}
  $svc | Add-Member ScriptMethod WaitForStatus {param($state,$timeout) $this.Status=$state.ToString()}
  $svc
}
function Set-Service {param([string]$Name,[string]$StartupType) $script:calls+='configure:'+ $Name; $script:items[$Name].startup=@{Automatic=2;Manual=3;Disabled=4}[$StartupType];$script:items[$Name].delayExists=$true;$script:items[$Name].delay=0}
function Stop-Service {param([string]$Name) $script:calls+='stop:'+ $Name;$script:items[$Name].running=$false}
function Start-Service {param([string]$Name) $script:calls+='start:'+ $Name;$script:items[$Name].running=$true}
function Get-Item {param([string]$LiteralPath)
  $key=[pscustomobject]@{Name=$LiteralPath.Split('\\')[-1]}
  $key | Add-Member ScriptMethod GetValueKind {param($name) [Microsoft.Win32.RegistryValueKind]::DWord}
  $key | Add-Member ScriptMethod GetValueNames {if($script:items[$this.Name].delayExists){@('Start','DelayedAutoStart')}else{@('Start')}}
  $key | Add-Member ScriptMethod GetValue {param($name) if($name -eq 'Start'){$script:items[$this.Name].startup}else{$script:items[$this.Name].delay}}
  $key
}
function New-ItemProperty {param([string]$LiteralPath,[string]$Name,[string]$PropertyType,[int]$Value,[switch]$Force) if($Name -ne 'DelayedAutoStart'){throw 'Unexpected key'};$script:items[$LiteralPath.Split('\\')[-1]].delayExists=$true;$script:items[$LiteralPath.Split('\\')[-1]].delay=$Value}
function Remove-ItemProperty {param([string]$LiteralPath,[string]$Name) if($Name -ne 'DelayedAutoStart'){throw 'Unexpected key'};$script:items[$LiteralPath.Split('\\')[-1]].delayExists=$false}
$null=& {${buildWriteScript(after)}}
$configured=& {${buildReadScript(desired())}} | ConvertFrom-Json
$null=& {${buildWriteScript(before)}}
$restored=& {${buildReadScript(desired())}} | ConvertFrom-Json
@{configured=@($configured);restored=@($restored);calls=@($script:calls)} | ConvertTo-Json -Depth 8 -Compress
`);
  assert.ok(equalOperations(after,result.configured));assert.ok(equalOperations(before,result.restored));
  assert.deepEqual(result.calls.filter(c=>c.startsWith('stop:')),['stop:WSearch','stop:SysMain']);
  assert.deepEqual(result.calls.filter(c=>c.startsWith('start:')),['start:WSearch','start:SysMain']);
  assert.doesNotMatch(buildWriteScript(after),/Stop-Service[^\n]*-Force|Stop-Process/);
});

test('native service changes refuse to cascade into dependent services',{skip:process.platform!=='win32'},async()=>{
  const after=materializeOperations(desired(),originals());
  await assert.rejects(runPowerShell(`
function Get-Service {param($Name) $svc=[pscustomobject]@{Status='Running';DependentServices=@([pscustomobject]@{Status='Running'})};$svc|Add-Member ScriptMethod Refresh {};return $svc}
function Set-Service {throw 'Unexpected configuration'}
${buildWriteScript([after[0]])}
`),/depends on this one/);
});

const processFixture=(pid=901)=>({pid,executable:'chrome.exe',path:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',started:'638935002001234567',memoryBytes:200*1048576});
test('app closing accepts only one-use current scan tokens, never renderer paths or PIDs',async()=>{
  let now=1;let closed=[];
  const manager=new SessionApps({list:async()=>[processFixture(),processFixture(902),{...processFixture(903),executable:'lsass.exe',path:'C:\\Windows\\System32\\lsass.exe'}],close:async values=>{closed=values;return {closedProcesses:values.length,failedProcesses:0,skippedProcesses:0};}},()=>now);
  const list=await manager.scan();assert.equal(list.length,1);assert.equal(list[0].processCount,2);assert.equal(list[0].memoryMB,400);
  assert.equal('path' in list[0],false);
  for(const invalid of [[901],['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],[list[0].token,list[0].token]])await assert.rejects(manager.close(invalid),/Refresh/);
  await manager.close([list[0].token]);assert.deepEqual(closed,[processFixture(),processFixture(902)]);
  await assert.rejects(manager.close([list[0].token]),/Refresh/);
  const next=await manager.scan();now=300002;await assert.rejects(manager.close([next[0].token]),/Refresh/);
});

test('refresh invalidates old app selections and concurrent closes are refused',async()=>{
  let release;const manager=new SessionApps({list:async()=>[processFixture()],close:()=>new Promise(resolve=>release=resolve)});
  const old=await manager.scan();const list=await manager.scan();await assert.rejects(manager.close([old[0].token]),/Refresh/);
  const pending=manager.close([list[0].token]);await assert.rejects(manager.scan(),/Wait/);await assert.rejects(manager.close([list[0].token]),/progress/);
  release({closedProcesses:1,failedProcesses:0,skippedProcesses:0});await pending;assert.equal(manager.busy,false);
});

test('app-close scripts validate identity and parse without admitting arbitrary executables',{skip:process.platform!=='win32'},async()=>{
  const script=closeAppsScript([processFixture()]);
  assert.match(script,/\$null=\$proc.Handle/);assert.match(script,/StartTime.ToUniversalTime\(\).Ticks/);assert.match(script,/GetOwnerSid/);assert.match(script,/SessionId -ne/);
  for(const invalid of [{...processFixture(),pid:'901;cmd'},{...processFixture(),executable:'svchost.exe'},{...processFixture(),started:'arbitrary'},{...processFixture(),path:'\\\\server\\chrome.exe'}])assert.throws(()=>closeAppsScript([invalid]),/Invalid/);
  const errors=await runPowerShell(`$tokens=$null;$errors=$null;$null=[System.Management.Automation.Language.Parser]::ParseInput(${psQuote(script)},[ref]$tokens,[ref]$errors);ConvertTo-Json -InputObject @($errors | ForEach-Object Message) -Compress`);
  assert.deepEqual(errors,[]);
});

test('native app closing rejects a changed identity and closes only its disposable test process',{skip:process.platform!=='win32'},async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'rankly-owned-app-test-'));
  const executable=path.join(directory,'chrome.exe');let child;
  try {
    child=await runPowerShell(`
Add-Type -TypeDefinition 'public class RanklyOwnedAppTest { public static void Main() { System.Threading.Thread.Sleep(60000); } }' -OutputAssembly ${psQuote(executable)} -OutputType ConsoleApplication
$proc=Start-Process -FilePath ${psQuote(executable)} -WindowStyle Hidden -PassThru
try { $null=$proc.Handle; @{pid=$proc.Id;executable='chrome.exe';path=${psQuote(executable)};started=$proc.StartTime.ToUniversalTime().Ticks.ToString();memoryBytes=$proc.WorkingSet64} | ConvertTo-Json -Compress } finally {$proc.Dispose()}
`);
    const stale=await runPowerShell(closeAppsScript([{...child,started:String(BigInt(child.started)-1n)}]));
    assert.equal(stale.closedProcesses,0);assert.equal(stale.skippedProcesses,1);
    const closed=await runPowerShell(closeAppsScript([child]));
    assert.equal(closed.closedProcesses,1);assert.equal(closed.failedProcesses,0);
  } finally {
    if(child)await runPowerShell(closeAppsScript([child]));
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('rankly-owned-app-test-'));
    await rm(directory,{recursive:true,force:true});
  }
});
