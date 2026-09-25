import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { tweaks, validateTweakIds } from '../shared/catalog.mjs';
import { powerControls } from '../shared/power-settings.mjs';
import { operationsFor, materializeOperations, equalOperations, unavailableReason, operationKey, validateBackupOperations } from '../shared/operations.mjs';
import { TweakEngine } from '../electron/engine.mjs';
import { buildReadScript, buildWriteScript, runPowerShell, psQuote } from '../electron/windows.mjs';

const balanced='381b4222-f694-41f0-9685-ff5bb260df2e';
const high='8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
const adapterId='246ed835-ce67-4f81-9301-1ed6b13aa4f8';
const context={scheme:balanced,plans:[balanced,high],build:22631,edition:'Professional',admin:true,cpu:'Intel Core',hags:true,wifi:true,hdd:true,
  powerValues:[balanced,high].flatMap(scheme=>Object.values(powerControls).flat().map(s=>({scheme,...s,value:s.value===0?1:0,available:true}))),
  networkProperties:['*InterruptModeration','*EEE','EnableGreenEthernet','*RSS'].map(keyword=>({adapter:adapterId,keyword,value:['1'],validValues:['0','1']}))};
const definition=id=>tweaks.find(t=>t.id===id);

async function fixture(t,ids,extra=[]) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'rankly-expanded-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const operations=operationsFor(validateTweakIds(ids),context);
  const before=operations.map(o=>o.type==='registry'?{type:o.type,path:o.path,name:o.name,exists:false}:o.type==='power'?{...o,value:balanced}:o.type==='network'?{...o,value:['1']}:{...o,value:o.value===0?1:0});
  const values=new Map([...before,...extra].map(o=>[operationKey(o),structuredClone(o)]));
  const adapter={resolve:async selected=>operationsFor(selected,context),
    read:async ops=>ops.map(o=>structuredClone(values.get(operationKey(o))||{type:'registry',path:o.path,name:o.name,exists:false})),
    write:async ops=>{for(const o of ops)values.set(operationKey(o),structuredClone(o));}};
  return {engine:new TweakEngine(directory,adapter),adapter,values,operations,before,directory};
}

test('mixed plan and CPU changes back up the target plan before switching',async t=>{
  const f=await fixture(t,['performance-power','high-performance']);
  assert.ok(f.operations.filter(o=>o.type==='power-setting').every(o=>o.scheme===high));
  const write=f.adapter.write;
  f.adapter.write=async ops=>{const journal=JSON.parse(await readFile(path.join(f.directory,'recovery.json'),'utf8'));assert.equal(journal[0].status,'prepared');assert.deepEqual(journal[0].before,f.before);await write(ops);};
  const entry=await f.engine.apply(['performance-power','high-performance']);
  f.adapter.write=write;
  await f.engine.restore(entry.id);
  assert.deepEqual(await f.adapter.read(f.operations),f.before);
});

test('power recovery stays bound to the saved plan after an external plan switch',async t=>{
  const f=await fixture(t,['performance-power']);
  const entry=await f.engine.apply(['performance-power']);
  f.values.set('power',{type:'power',value:high});
  await f.engine.restore(entry.id);
  assert.equal(f.values.get('power').value,high);
  assert.deepEqual(await f.adapter.read(f.operations),f.before);
});

test('an entire CPU and Ethernet batch rolls back on partial network failure',async t=>{
  const f=await fixture(t,['performance-power','ethernet-optimization']);
  const write=f.adapter.write;let calls=0;
  f.adapter.write=async ops=>{if(++calls===1){await write(ops.slice(0,5));throw new Error('Driver rejected the change');}await write(ops);};
  await assert.rejects(f.engine.apply(['performance-power','ethernet-optimization']),/restored and verified/);
  assert.deepEqual(await f.adapter.read(f.operations),f.before);
  assert.equal((await f.engine.history())[0].status,'rolled-back');
});

test('Ethernet recovery targets its saved adapter without touching another adapter',async t=>{
  const other={type:'network',adapter:'11111111-2222-4333-8444-555555555555',keyword:'*EEE',value:['1']};
  const f=await fixture(t,['ethernet-optimization'],[other]);
  const entry=await f.engine.apply(['ethernet-optimization']);
  await f.engine.restore(entry.id);
  assert.deepEqual(await f.adapter.read(f.operations),f.before);
  assert.deepEqual(f.values.get(operationKey(other)),other);
});

test('missing devices retain a recoverable backup until reconnection',async t=>{
  const f=await fixture(t,['ethernet-optimization']);
  const entry=await f.engine.apply(['ethernet-optimization']);const write=f.adapter.write;
  f.adapter.write=async()=>{throw new Error('Adapter removed');};
  await assert.rejects(f.engine.restore(entry.id),/Adapter removed/);
  assert.equal((await f.engine.history())[0].status,'recovery-needed');
  await assert.rejects(f.engine.apply(['gaming-optimization']),/interrupted/);
  f.adapter.write=write;await f.engine.restore(entry.id);
  assert.deepEqual(await f.adapter.read(f.operations),f.before);
});

test('windowed graphics changes preserve unrelated preferences and restore exactly',async t=>{
  const op=operationsFor([definition('windowed-gaming')])[0];
  const original={type:'registry',path:op.path,name:op.name,exists:true,kind:'String',value:'AutoHDREnable=0;VendorOption=keep;SwapEffectUpgradeEnable=0;'};
  const f=await fixture(t,['windowed-gaming'],[original]);
  const entry=await f.engine.apply(['windowed-gaming']);
  const changed=(await f.adapter.read([op]))[0];
  assert.equal(changed.value,'AutoHDREnable=0;VendorOption=keep;SwapEffectUpgradeEnable=1;');
  await f.engine.restore(entry.id);assert.deepEqual((await f.adapter.read([op]))[0],original);
});

test('graphics state handles duplicate tokens and refuses unsupported original types',()=>{
  const op=operationsFor([definition('windowed-gaming')])[0];
  const snapshot={...op,exists:true,kind:'String',value:'SwapEffectUpgradeEnable=1;SwapEffectUpgradeEnable=0;'};
  assert.equal(equalOperations([op],[snapshot]),false);
  assert.throws(()=>materializeOperations([op],[{...snapshot,kind:'DWord',value:1}]),/supported string/);
});

test('hardware and Windows edition gates prevent unsupported controls',()=>{
  assert.match(unavailableReason(definition('gpu-scheduling'),{...context,hags:false}),/not detected/);
  assert.match(unavailableReason(definition('windowed-gaming'),{...context,build:19045}),/Windows 11/);
  assert.match(unavailableReason(definition('windowed-gaming'),{...context,build:22000}),/22H2/);
  assert.match(unavailableReason(definition('background-apps'),{...context,edition:'Core'}),/Requires Windows Pro/);
  assert.match(unavailableReason(definition('core-parking'),{...context,cpu:'AMD Ryzen 9 9950X3D'}),/X3D/);
  assert.match(unavailableReason(definition('wifi-performance'),{...context,wifi:false}),/Wi-Fi/);
  assert.match(unavailableReason(definition('hdd-readiness'),{...context,hdd:false}),/mechanical/);
});

test('Ethernet bundle accepts RSS-only and moderation-only adapters and skips unsupported values',()=>{
  const t=definition('ethernet-optimization');
  const filtered={...context,networkProperties:context.networkProperties.filter(p=>p.keyword==='*InterruptModeration')};
  assert.equal(operationsFor([t],filtered).length,1);
  const rssOnly={...context,networkProperties:context.networkProperties.filter(p=>p.keyword==='*RSS')};
  assert.deepEqual(operationsFor([t],rssOnly).map(o=>o.keyword),['*RSS']);
  assert.equal(unavailableReason(t,rssOnly),'');
  assert.equal(unavailableReason(t,filtered),'');
  assert.match(unavailableReason(t,{...context,networkProperties:[]}),/No supported active Ethernet/);
  assert.equal(operationsFor([t],{...filtered,networkProperties:filtered.networkProperties.map(p=>({...p,validValues:['1']}))}).length,0);
});

test('backup validation rejects foreign settings, duplicates, and omitted controls',()=>{
  const selected=validateTweakIds(['performance-power']);const before=operationsFor(selected,context);
  assert.throws(()=>validateBackupOperations({before,after:before.map(o=>({...o,scheme:high}))},selected),/definitions/);
  assert.throws(()=>validateBackupOperations({before:[...before,...before],after:[...before,...before]},selected),/duplicate/);
  assert.throws(()=>validateBackupOperations({before,after:before},validateTweakIds(['performance-power','ethernet-optimization'])),/missing/);
  const incomplete=operationsFor([definition('gaming-optimization')]).slice(0,1);
  assert.throws(()=>validateBackupOperations({before:incomplete,after:incomplete},[definition('gaming-optimization')]),/missing part/);
  assert.throws(()=>buildWriteScript([{type:'network',adapter:adapterId,keyword:'ArbitraryDriverKey',value:['0']}]),/allowlist/);
  assert.throws(()=>buildWriteScript([{...before[0],scheme:'bad; command'}]),/allowlist/);
});

test('power writes change AC only and refresh the active plan, not a saved inactive plan',()=>{
  const script=buildWriteScript(operationsFor([definition('performance-power')],context));
  assert.match(script,/\/setacvalueindex/);assert.doesNotMatch(script,/\/setdcvalueindex/);
  assert.match(script,/\/getactivescheme/);assert.match(script,/\/setactive \$plan/);
});

test('native power reader matches the Windows active-plan query without changing settings',{skip:process.platform!=='win32'},async()=>{
  const queried=await runPowerShell(`$text=(& powercfg.exe /getactivescheme | Out-String); $plan=[regex]::Match($text,'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}').Value; $text=(& powercfg.exe /qh $plan '501a4d13-42af-4429-9fd1-a8218c268e20' 'ee12f906-d277-404b-b6da-e5fa1a576df5' | Out-String); if ($LASTEXITCODE -ne 0) { throw 'Power query failed' }; $hex=@([regex]::Matches($text,'0x[0-9a-fA-F]+') | ForEach-Object { $_.Value }); @{scheme=$plan;value=[Convert]::ToUInt32($hex[-2].Substring(2),16)} | ConvertTo-Json -Compress`);
  const op={type:'power-setting',scheme:queried.scheme,...powerControls['performance-power'].find(s=>s.setting==='ee12f906-d277-404b-b6da-e5fa1a576df5')};
  const result=await runPowerShell(buildReadScript([op]));
  assert.equal(result[0].value,queried.value);
});

test('new native write scripts parse as PowerShell before deployment',{skip:process.platform!=='win32'},async()=>{
  const ops=operationsFor(validateTweakIds(['performance-power','ethernet-optimization','gpu-scheduling']),context);
  const script=buildWriteScript(ops);
  const parsed=await runPowerShell(`$tokens=$null; $errors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput(${psQuote(script)},[ref]$tokens,[ref]$errors); ConvertTo-Json -InputObject @($errors | ForEach-Object { $_.Message }) -Compress`);
  assert.deepEqual(parsed,[]);
  assert.match(script,/-InputObject \$property/);assert.match(script,/-NoRestart/);
});

test('generated network commands use the matched adapter and never restart the live connection',{skip:process.platform!=='win32'},async()=>{
  const ops=operationsFor([definition('ethernet-optimization')],context);
  const result=await runPowerShell(`
$script:recorded=@()
function Get-NetAdapter { [CmdletBinding()]param([switch]$IncludeHidden); [pscustomobject]@{Name='Renamed [Ethernet]';InterfaceGuid='{${adapterId}}'} }
function Get-NetAdapterAdvancedProperty { [CmdletBinding()]param([string]$Name,[switch]$IncludeHidden,[switch]$AllProperties); foreach($keyword in @('*InterruptModeration','*EEE','EnableGreenEthernet','*RSS')) { [pscustomobject]@{Name=$Name;RegistryKeyword=$keyword;RegistryValue=@('1')} } }
function Set-NetAdapterAdvancedProperty { [CmdletBinding()]param($InputObject,[string[]]$RegistryValue,[switch]$NoRestart); $script:recorded+=@{keyword=$InputObject.RegistryKeyword;name=$InputObject.Name;value=@($RegistryValue);noRestart=[bool]$NoRestart} }
$null=& { ${buildWriteScript(ops)} }
ConvertTo-Json -InputObject @($script:recorded) -Depth 5 -Compress
`);
  assert.equal(result.length,4);
  assert.deepEqual(result.map(r=>r.keyword),ops.map(o=>o.keyword));
  assert.ok(result.every((r,i)=>r.noRestart&&r.value.length===1&&r.value[0]===ops[i].value[0]));
  assert.ok(result.every(r=>r.name==='Renamed `[Ethernet`]'));
});
