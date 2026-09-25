import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { tweaks, validateTweakIds } from '../shared/catalog.mjs';
import { operationsFor, operationKey, unavailableReason, materializeOperations, equalOperations, validateBackupOperations } from '../shared/operations.mjs';
import { TweakEngine, atomicJSON } from '../electron/engine.mjs';
import { buildReadScript, buildWriteScript, runPowerShell, psQuote } from '../electron/windows.mjs';
import { wifiReadPrelude } from '../electron/wifi-scripts.mjs';

const adapter='246ed835-ce67-4f81-9301-1ed6b13aa4f8';
const deviceId='PCI\\VEN_8086&DEV_2723&SUBSYS_00848086&REV_1A\\4&123&0&00E0';
const ids=['wifi-smps','wifi-uapsd'];
const definitions=validateTweakIds(ids);
// Deliberately use a different encoding from common driver defaults.
const originals=[
  {keyword:'MIMOPowerSaveMode',value:['0'],label:'Auto SMPS',choices:[{value:'0',label:'Auto SMPS'},{value:'9',label:'No SMPS'}]},
  {keyword:'uAPSD',value:['1'],label:'Enabled',choices:[{value:'1',label:'Enabled'},{value:'7',label:'Disabled'}]},
].map(o=>({type:'wifi-property',adapter,deviceId,available:true,up:true,...o}));
const context={build:19045,wifiProperties:originals};
const ops=operationsFor(definitions,context);

test('Wi-Fi controls resolve driver-labelled choices without duplicating existing power or Ethernet controls',()=>{
  assert.deepEqual(ops.map(o=>o.value),[['9'],['7']]);
  for(const t of definitions)assert.equal(unavailableReason(t,context),'');
  assert.match(unavailableReason(definitions[0],{...context,build:9600}),/newer Windows/);
  const all=operationsFor(tweaks,{...context,scheme:'381b4222-f694-41f0-9685-ff5bb260df2e'});
  assert.equal(new Set(all.map(operationKey)).size,all.length);
  assert.equal(all.filter(o=>o.type==='wifi-property').length,2);
});

test('Wi-Fi discovery fails closed on unknown labels, ambiguous values, unsupported devices, and unreadable originals',()=>{
  const base=originals[0];
  const invalid=[
    {...base,up:false},{...base,available:false},{...base,deviceId:deviceId.replace('8086','10EC')},{...base,adapter:'bad'},
    {...base,value:[]},{...base,value:['999']},{...base,value:['0','9']},{...base,label:'Unexpected'},
    {...base,choices:[]},{...base,choices:[...base.choices,base.choices[1]]},
    {...base,choices:base.choices.map(c=>({...c,label:'Ambiguous'}))},
    {...base,choices:base.choices.map(c=>c.value==='9'?{...c,label:'Keine SMPS'}:c)},
  ];
  for(const property of invalid) {
    const limited={...context,wifiProperties:[property]};
    assert.deepEqual(operationsFor([definitions[0]],limited),[]);
    assert.match(unavailableReason(definitions[0],limited),/No connected Intel Wi-Fi/);
  }
  assert.deepEqual(operationsFor(definitions,{...context,wifiProperties:[]}),[]);
  assert.deepEqual(operationsFor([definitions[0]],{...context,wifiProperties:[base,base]}),[]);
  assert.equal(operationsFor(definitions,{...context,wifiProperties:[originals[1]]}).length,1);
});

async function fixture(t) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'rankly-wifi-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const values=new Map(originals.map(o=>[operationKey(o),structuredClone(o)]));
  const native={resolve:async selected=>operationsFor(selected,context),
    read:async requested=>requested.map(o=>structuredClone(values.get(operationKey(o)))),
    write:async requested=>{for(const o of requested){const saved=values.get(operationKey(o));saved.value=[...o.value];saved.label=o.label;}},
  };
  return {directory,values,native,engine:new TweakEngine(directory,native)};
}

test('Wi-Fi changes durably save originals, skip matching batches, and recover using the saved hardware identity',async t=>{
  const f=await fixture(t),write=f.native.write;
  f.native.write=async requested=>{
    const journal=JSON.parse(await readFile(f.engine.file,'utf8'));
    assert.equal(journal[0].status,'prepared');assert.deepEqual(journal[0].before,originals);
    await write(requested);
  };
  const entry=await f.engine.apply(ids);f.native.write=write;
  assert.equal((await f.engine.apply(ids)).unchanged,true);
  f.native.resolve=async()=>{throw new Error('Must not resolve current hardware during restore');};
  await new TweakEngine(f.directory,f.native).restore(entry.id);
  assert.deepEqual(await f.native.read(ops),originals);
});

test('partial Wi-Fi failure rolls back and failed rollback survives app restart',async t=>{
  for(const rollbackFails of [false,true]) {
    const f=await fixture(t),write=f.native.write;let count=0;
    f.native.write=async requested=>{
      if(++count===1){await write(requested.slice(0,1));throw new Error('Simulated driver refusal');}
      if(rollbackFails)throw new Error('Adapter unavailable');
      await write(requested);
    };
    await assert.rejects(f.engine.apply(ids),rollbackFails?/Open Recovery/:/restored and verified/);
    const entry=(await f.engine.history())[0];
    assert.equal(entry.status,rollbackFails?'recovery-needed':'rolled-back');
    if(rollbackFails) {
      await assert.rejects(f.engine.apply(ids),/interrupted/);
      f.native.write=write;
      await new TweakEngine(f.directory,f.native).restore(entry.id);
    }
    assert.deepEqual(await f.native.read(ops),originals);
  }
});

test('Wi-Fi recovery preserves reverse order and accepts an interrupted prepared batch',async t=>{
  const f=await fixture(t),first=await f.engine.apply([ids[0]]),second=await f.engine.apply([ids[1]]);
  await assert.rejects(f.engine.restore(first.id),/most recent/);
  await f.engine.restore(second.id);await f.engine.restore(first.id);
  const interrupted={format:2,id:'interrupted-wifi',date:new Date().toISOString(),ids,names:definitions.map(t=>t.name),before:originals,after:ops,status:'prepared'};
  await atomicJSON(f.engine.file,[interrupted]);await f.native.write(ops.slice(0,1));
  await new TweakEngine(f.directory,f.native).restore(interrupted.id);
  assert.deepEqual(await f.native.read(ops),originals);
});

test('Wi-Fi backup and native allowlists reject new devices, settings, values, and meanings',()=>{
  validateBackupOperations({before:originals,after:ops},definitions);
  assert.throws(()=>validateBackupOperations({before:originals.slice(1),after:ops.slice(1)},definitions),/missing/);
  for(const changed of [{...ops[0],label:'Auto SMPS'},{...ops[0],value:['3']},{...ops[0],requireUp:false},{...ops[0],deviceId:deviceId+'X'}]) {
    assert.throws(()=>validateBackupOperations({before:originals,after:[changed,ops[1]]},definitions),/unexpected change|definitions/);
  }
  assert.throws(()=>validateBackupOperations({before:[{...originals[0],choices:[]},originals[1]],after:ops},definitions),/unexpected change/);
  for(const changed of [{...ops[0],keyword:'Arbitrary'},{...ops[0],deviceId:'USB\\VEN_8086'},{...ops[0],adapter:'bad'}]) {
    for(const builder of [buildReadScript,buildWriteScript])assert.throws(()=>builder([changed]),/allowlist/);
  }
  for(const value of [[],['-1'],['1','2'],['$(bad)'],['4294967296']])assert.throws(()=>buildWriteScript([{...ops[0],value}]),/Invalid Wi-Fi/);
  assert.equal(equalOperations([ops[0]],[{...ops[0],label:'Changed meaning'}]),false);
  assert.throws(()=>materializeOperations(ops,[{...originals[0],up:false},originals[1]]),/no longer available/);
  assert.throws(()=>materializeOperations(ops,[{...originals[0],choices:[]},originals[1]]),/choices changed/);
});

// Every adapter cmdlet is shadowed here. No real adapter write or restart is
// possible in this fixture; it executes the production PowerShell generators.
const fakeNative=`
$script:writes=@()
$script:nic=[pscustomobject]@{Name='Renamed Wi-Fi [2]';InterfaceGuid='{${adapter}}';PnPDeviceID=${psQuote(deviceId)};HardwareInterface=$true;Virtual=$false;NdisPhysicalMedium=9;DriverProvider='Intel Corporation';AdminLocked=$false;Status='Up'}
$script:smps=[pscustomobject]@{RegistryKeyword='MIMOPowerSaveMode';RegistryValue=@('0');DisplayValue='Auto SMPS';ValidRegistryValues=@('0','9');ValidDisplayValues=@('Auto SMPS','No SMPS')}
$script:uapsd=[pscustomobject]@{RegistryKeyword='uAPSD';RegistryValue=@('1');DisplayValue='Enabled';ValidRegistryValues=@('1','7');ValidDisplayValues=@('Enabled','Disabled')}
function Get-NetAdapter { [CmdletBinding()]param([switch]$IncludeHidden,[switch]$Physical); $script:nic }
function Get-NetAdapterAdvancedProperty { [CmdletBinding()]param([string]$Name,[switch]$IncludeHidden,[switch]$AllProperties);
  if ($Name -cne ('Renamed Wi-Fi '+[char]96+'[2'+[char]96+']')) { throw 'Adapter name was not escaped' }
  $script:smps; $script:uapsd
}
function Set-NetAdapterAdvancedProperty { [CmdletBinding()]param($InputObject,[string[]]$RegistryValue,[switch]$NoRestart);
  $script:writes+=@{keyword=$InputObject.RegistryKeyword;value=@($RegistryValue);noRestart=[bool]$NoRestart}
  $InputObject.RegistryValue=@($RegistryValue)
  $InputObject.DisplayValue=$InputObject.ValidDisplayValues[[array]::IndexOf($InputObject.ValidRegistryValues,$RegistryValue[0])]
}
function Restart-NetAdapter { throw 'A connection restart is forbidden' }
`;

test('native Wi-Fi writes target the saved adapter, preserve the connection, restore offline, and skip no-ops',{skip:process.platform!=='win32'},async()=>{
  const result=await runPowerShell(`
${fakeNative}
$before=& { ${buildReadScript(ops)} } | ConvertFrom-Json
$null=& { ${buildWriteScript(ops)} }
$applied=& { ${buildReadScript(ops)} } | ConvertFrom-Json
$null=& { ${buildWriteScript(ops)} }
$script:nic.Status='Disconnected'
$null=& { ${buildWriteScript(originals)} }
$after=& { ${buildReadScript(ops)} } | ConvertFrom-Json
@{before=@($before);applied=@($applied);after=@($after);writes=@($script:writes)} | ConvertTo-Json -Depth 8 -Compress
`);
  assert.ok(equalOperations(originals,result.before));
  assert.ok(equalOperations(ops,result.applied));
  assert.ok(equalOperations(originals,result.after));
  assert.ok(result.after.every(o=>o.up===false));
  assert.deepEqual(result.writes.map(w=>w.value),[['9'],['7'],['0'],['1']]);
  assert.ok(result.writes.every(w=>w.noRestart));
});

test('native Wi-Fi writer refuses races, non-Intel or virtual hardware, management locks, and driver drift',{skip:process.platform!=='win32'},async()=>{
  const mutations=[
    "$script:nic.Status='Disconnected'",
    "$script:nic.HardwareInterface=$false",
    "$script:nic.Virtual=$true",
    "$script:nic.NdisPhysicalMedium=14",
    "$script:nic.DriverProvider='Other vendor'",
    "$script:nic.AdminLocked=$true",
    `$script:nic.PnPDeviceID=${psQuote(deviceId.replace('8086','10EC'))}`,
    "$script:nic.InterfaceGuid='{11111111-2222-4333-8444-555555555555}'",
    "$script:smps.ValidDisplayValues=@('Auto SMPS','Static SMPS')",
    "$script:smps.ValidRegistryValues=@('0','3')",
    "$script:smps.RegistryValue=@('99')",
    "$script:smps.ValidRegistryValues=@('0','0')",
    "$script:smps.ValidDisplayValues=@('No SMPS','No SMPS')",
    "$script:smps.DisplayValue='Wrong meaning'",
  ];
  const result=await runPowerShell(`
$outcomes=@()
foreach($mutation in @(${mutations.map(psQuote).join(',')})) {
  ${fakeNative}
  & ([scriptblock]::Create($mutation))
  $blocked=$false
  try { $null=& { ${buildWriteScript([ops[0]])} } } catch { $blocked=$true }
  $outcomes+=@{blocked=$blocked;writes=$script:writes.Count}
}
ConvertTo-Json -InputObject @($outcomes) -Compress
`);
  assert.equal(result.length,mutations.length);
  assert.ok(result.every(r=>r.blocked&&r.writes===0),JSON.stringify(result));
});

test('Wi-Fi probe is read-only and its scripts parse; unsupported live hardware remains absent',{skip:process.platform!=='win32'},async()=>{
  const scripts=[buildReadScript(ops),buildWriteScript(ops),buildWriteScript(originals)];
  const parse=await runPowerShell(`$all=@(); foreach($body in @(${scripts.map(psQuote).join(',')})) { $tokens=$null; $errors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($body,[ref]$tokens,[ref]$errors); $all+=@($errors | ForEach-Object { $_.Message }) }; ConvertTo-Json -InputObject @($all) -Compress`);
  assert.deepEqual(parse,[]);
  assert.doesNotMatch(wifiReadPrelude,/Set-NetAdapter|Restart-NetAdapter|New-ItemProperty|Set-ItemProperty/);
  const current=await runPowerShell(`
${wifiReadPrelude}
$detected=@(foreach($nic in Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { [string]$_.Status -eq 'Up' -and (Test-RanklyIntelWifi $_) }) {
  foreach($keyword in @('MIMOPowerSaveMode','uAPSD')) { try { (Get-RanklyWifiSetting $nic $keyword).snapshot } catch { } }
})
ConvertTo-Json -InputObject @($detected) -Depth 8 -Compress
`);
  assert.ok(Array.isArray(current));
  for(const snapshot of current){assert.equal(snapshot.available,true);assert.equal(snapshot.up,true);assert.ok(snapshot.choices.length>=2);}
});
