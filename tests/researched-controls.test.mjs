import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateTweakIds } from '../shared/catalog.mjs';
import { powerControls } from '../shared/power-settings.mjs';
import { operationsFor, operationKey, unavailableReason, validateBackupOperations } from '../shared/operations.mjs';
import { TweakEngine } from '../electron/engine.mjs';
import { getCapabilities } from '../electron/capabilities.mjs';
import { buildWriteScript, runPowerShell, psQuote } from '../electron/windows.mjs';

const scheme='381b4222-f694-41f0-9685-ff5bb260df2e';
const other='8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
const adapterId='246ed835-ce67-4f81-9301-1ed6b13aa4f8';
const ids=['active-cooling','nvme-latency','sata-link-power','ethernet-idle-sleep'];
const definitions=validateTweakIds(ids);
const context={scheme,build:26100,nvme:true,ahci:true,plans:[scheme,other],
  powerValues:[scheme,other].flatMap(plan=>Object.values(powerControls).flat().map(s=>({...s,scheme:plan,available:true}))),
  networkProperties:[{adapter:adapterId,keyword:'*SelectiveSuspend',validValues:['0','1']}],
};

test('storage controls require a matching Microsoft driver and complete power support',()=>{
  const [,nvme,sata]=definitions;
  assert.match(unavailableReason(nvme,{...context,nvme:false}),/Microsoft NVMe/);
  assert.match(unavailableReason(sata,{...context,ahci:false}),/Microsoft SATA/);
  assert.match(unavailableReason(nvme,{...context,build:17763}),/newer Windows/);
  for(const t of definitions) assert.equal(unavailableReason(t,context),'');
  const missing={...context,powerValues:context.powerValues.filter(v=>v.setting!==nvme.powerSettings[1].setting)};
  assert.equal(operationsFor([nvme],missing).length,0);
  assert.match(unavailableReason(nvme,missing),/Not exposed/);
  const targetMissing={...context,powerValues:context.powerValues.filter(v=>v.scheme!==other||v.setting!==nvme.powerSettings[1].setting)};
  assert.equal(operationsFor([nvme],targetMissing).length,2);
  assert.equal(operationsFor(validateTweakIds(['high-performance','nvme-latency']),targetMissing).length,1);
  assert.match(unavailableReason(nvme,{...targetMissing,scheme:other}),/Not exposed/);
});

test('Ethernet idle-sleep control only resolves adapters advertising the disabled value',()=>{
  const ethernet=definitions[3];
  assert.equal(operationsFor([ethernet],context).length,1);
  for(const properties of [[],[{adapter:adapterId,keyword:'*SelectiveSuspend',validValues:['1']}],[{adapter:adapterId,keyword:'*RSS',validValues:['0','1']}]]) {
    const limited={...context,networkProperties:properties};
    assert.equal(operationsFor([ethernet],limited).length,0);
    assert.match(unavailableReason(ethernet,limited),/No supported active Ethernet/);
  }
});

async function fixture(t) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'rankly-researched-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const ops=operationsFor(definitions,context);
  const originals=ops.map(o=>({...o,value:o.type==='network'?['1']:o.value===1?0:15}));
  const values=new Map(originals.map(o=>[operationKey(o),structuredClone(o)]));
  const adapter={resolve:async selected=>operationsFor(selected,context),read:async operations=>operations.map(o=>structuredClone(values.get(operationKey(o)))),write:async operations=>{for(const o of operations)values.set(operationKey(o),structuredClone(o));}};
  return {engine:new TweakEngine(directory,adapter),adapter,ops,originals,directory};
}

test('new power and Ethernet controls restore original values on their saved plan and adapter',async t=>{
  const f=await fixture(t),entry=await f.engine.apply(ids);
  assert.equal(entry.after.length,5);
  assert.equal((await f.engine.apply(ids)).unchanged,true);
  f.adapter.resolve=async()=>{throw new Error('Current hardware changed');};
  const restarted=new TweakEngine(f.directory,f.adapter);
  await restarted.restore(entry.id);
  assert.deepEqual(await f.adapter.read(f.ops),f.originals);
});

test('a partial storage and Ethernet batch rolls back every changed value',async t=>{
  const f=await fixture(t),write=f.adapter.write;let calls=0;
  f.adapter.write=async ops=>{if(++calls===1){await write(ops.slice(0,3));throw new Error('Device write failed');}await write(ops);};
  await assert.rejects(f.engine.apply(ids),/restored and verified/);
  assert.deepEqual(await f.adapter.read(f.ops),f.originals);
  assert.equal((await f.engine.history())[0].status,'rolled-back');
});

test('NVMe recovery refuses incomplete and split-plan snapshots',()=>{
  const [nvme]=validateTweakIds(['nvme-latency']),before=operationsFor([nvme],context);
  const valid={before,after:structuredClone(before)};
  validateBackupOperations(valid,[nvme]);
  assert.throws(()=>validateBackupOperations({before:before.slice(0,1),after:before.slice(0,1)},[nvme]),/missing part/);
  const split=before.map((o,i)=>({...o,scheme:i?other:scheme}));
  assert.throws(()=>validateBackupOperations({before:split,after:split},[nvme]),/missing part/);
});

test('native additions parse and generate AC-only power writes without reconnecting Ethernet',{skip:process.platform!=='win32'},async()=>{
  const script=buildWriteScript(operationsFor(definitions,context));
  const captured=[];
  await getCapabilities(async body=>{captured.push(body);return body.includes('$storageControllers')?{nvme:true,ahci:false}:false;});
  const scripts=[script,...captured];
  const parse=await runPowerShell(`$errorsFound=@(); foreach($body in @(${scripts.map(psQuote).join(',')})) { $tokens=$null; $errors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($body,[ref]$tokens,[ref]$errors); $errorsFound+=@($errors | ForEach-Object { $_.Message }) }; ConvertTo-Json -InputObject @($errorsFound) -Compress`);
  assert.deepEqual(parse,[]);
  assert.doesNotMatch(script,/\/setdcvalueindex|Restart-NetAdapter|\/duplicatescheme|\/attributes/i);
  const result=await runPowerShell(`
$script:commands=@(); $script:network=@()
function powercfg.exe { $script:commands+=,@($args); $global:LASTEXITCODE=0; if($args[0] -eq '/getactivescheme') { 'Power Scheme GUID: ${other}' } }
function Get-NetAdapter { [CmdletBinding()]param([switch]$IncludeHidden); [pscustomobject]@{Name='Ethernet';InterfaceGuid='{${adapterId}}'} }
function Get-NetAdapterAdvancedProperty { [CmdletBinding()]param([string]$Name,[switch]$IncludeHidden,[switch]$AllProperties); [pscustomobject]@{Name=$Name;RegistryKeyword='*SelectiveSuspend';RegistryValue=@('1')} }
function Set-NetAdapterAdvancedProperty { [CmdletBinding()]param($InputObject,[string[]]$RegistryValue,[switch]$NoRestart); $script:network+=@{keyword=$InputObject.RegistryKeyword;value=@($RegistryValue);noRestart=[bool]$NoRestart} }
$null=& { ${script} }
@{commands=@($script:commands);network=@($script:network)} | ConvertTo-Json -Depth 8 -Compress`);
  const writes=result.commands.filter(a=>a[0]==='/setacvalueindex');
  assert.equal(writes.length,4);
  assert.ok(writes.every(a=>a[1]===scheme));
  assert.deepEqual(result.commands.at(-1),['/setactive',other]);
  assert.deepEqual(result.network,[{keyword:'*SelectiveSuspend',value:['0'],noRestart:true}]);
});
