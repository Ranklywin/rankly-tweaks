import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tweaks, validateTweakIds } from '../shared/catalog.mjs';
import { keyboardShortcuts } from '../shared/keyboard-settings.mjs';
import { operationsFor, operationKey, unavailableReason, materializeOperations, validateBackupOperations } from '../shared/operations.mjs';
import { TweakEngine, atomicJSON } from '../electron/engine.mjs';
import { buildReadScript, buildWriteScript, runPowerShell, psQuote } from '../electron/windows.mjs';
import { keyboardStructures, keyboardLogic, keyboardReadPrelude } from '../electron/keyboard-scripts.mjs';

const ids=['keyboard-shortcuts'];
const definitions=validateTweakIds(ids);
const originals=keyboardShortcuts.map((name,i)=>({type:'keyboard-shortcut',name,value:[12,4,8][i],available:true,active:false}));
const context={build:19045,keyboardShortcuts:originals};
const ops=operationsFor(definitions,context);

test('keyboard support fails closed for missing, unreadable, unavailable, or active features',()=>{
  assert.equal(unavailableReason(definitions[0],context),'');
  assert.match(unavailableReason(definitions[0],{...context,build:9600}),/newer Windows/);
  const invalid=[undefined,[],originals.slice(0,2),...['available','active','value'].map(key=>originals.map((s,i)=>i?s:{...s,[key]:undefined})),originals.map(s=>({...s,available:false}))];
  for(const keyboardShortcuts of invalid) {
    assert.match(unavailableReason(definitions[0],{...context,keyboardShortcuts}),/could not be verified/);
    assert.deepEqual(operationsFor(definitions,{...context,keyboardShortcuts}),[]);
  }
  for(let i=0;i<3;i++) {
    const keyboardShortcuts=originals.map((s,j)=>({...s,active:i===j}));
    assert.match(unavailableReason(definitions[0],{...context,keyboardShortcuts}),/Preserves active/);
    assert.deepEqual(operationsFor(definitions,{...context,keyboardShortcuts}),[]);
    assert.throws(()=>materializeOperations(ops,keyboardShortcuts),/accessibility feature is active/);
  }
  const all=operationsFor(tweaks,{...context,scheme:'381b4222-f694-41f0-9685-ff5bb260df2e'});
  assert.equal(new Set(all.map(operationKey)).size,all.length);
});

async function fixture(t) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'rankly-keyboard-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const values=new Map(originals.map(o=>[operationKey(o),structuredClone(o)]));
  const adapter={
    resolve:async selected=>operationsFor(selected,context),
    read:async requested=>requested.map(o=>structuredClone(values.get(operationKey(o)))),
    write:async requested=>{for(const o of requested)values.set(operationKey(o),{...values.get(operationKey(o)),...structuredClone(o)});},
  };
  return {directory,values,adapter,engine:new TweakEngine(directory,adapter)};
}

test('keyboard changes save a complete durable backup and restore original bits after restart',async t=>{
  const f=await fixture(t),write=f.adapter.write;
  f.adapter.write=async requested=>{
    const journal=JSON.parse(await readFile(f.engine.file,'utf8'));
    assert.equal(journal[0].status,'prepared');
    assert.deepEqual(journal[0].before,originals);
    await write(requested);
  };
  const entry=await f.engine.apply(ids);
  f.adapter.write=write;
  assert.equal((await f.engine.apply(ids)).unchanged,true);
  f.adapter.resolve=async()=>{throw new Error('Recovery must use saved targets');};
  await new TweakEngine(f.directory,f.adapter).restore(entry.id);
  assert.deepEqual(await f.adapter.read(ops),originals);
});

test('partial keyboard writes roll back; failed rollback remains recoverable after restart',async t=>{
  for(const rollbackFails of [false,true]) {
    const f=await fixture(t),write=f.adapter.write;let calls=0;
    f.adapter.write=async requested=>{
      calls++;
      if(calls===1){await write(requested.slice(0,1));throw new Error('Simulated API failure');}
      if(rollbackFails)throw new Error('Unavailable');
      await write(requested);
    };
    await assert.rejects(f.engine.apply(ids),rollbackFails?/Open Recovery/:/restored and verified/);
    const entry=(await f.engine.history())[0];
    assert.equal(entry.status,rollbackFails?'recovery-needed':'rolled-back');
    if(rollbackFails) {
      await assert.rejects(f.engine.apply(ids),/interrupted/);
      f.adapter.write=write;
      await new TweakEngine(f.directory,f.adapter).restore(entry.id);
    }
    assert.deepEqual(await f.adapter.read(ops),originals);
  }
});

test('crash-prepared keyboard batches recover without a new capability scan',async t=>{
  const f=await fixture(t);
  const entry={format:2,id:'interrupted-keyboard',date:new Date().toISOString(),ids,names:[definitions[0].name],before:originals,after:ops,status:'prepared'};
  await atomicJSON(f.engine.file,[entry]);
  await f.adapter.write(ops.slice(0,2));
  await f.engine.restore(entry.id);
  assert.deepEqual(await f.adapter.read(ops),originals);
});

test('new accessibility activation or an unverifiable write never records success',async t=>{
  const f=await fixture(t),first=operationKey(originals[0]);
  f.values.get(first).active=true;
  let writes=0;f.adapter.write=async()=>{writes++;};
  await assert.rejects(f.engine.apply(ids),/accessibility feature is active/);
  assert.equal(writes,0);assert.deepEqual(await f.engine.history(),[]);
  f.values.get(first).active=false;
  await assert.rejects(f.engine.apply(ids),/did not retain.*restored and verified/);
  assert.equal((await f.engine.history())[0].status,'rolled-back');
});

test('keyboard recovery rejects incomplete, forged, or foreign operations before writing',()=>{
  validateBackupOperations({before:originals,after:ops},definitions);
  assert.throws(()=>validateBackupOperations({before:originals.slice(1),after:ops.slice(1)},definitions),/missing part/);
  for(const value of [-1,1,2,16,4294967296,'0',NaN]) {
    assert.throws(()=>buildWriteScript([{...ops[0],value}]),/Invalid keyboard/);
    assert.throws(()=>validateBackupOperations({before:originals.map((s,i)=>i?s:{...s,value}),after:ops},definitions),/unexpected change/);
  }
  assert.throws(()=>validateBackupOperations({before:originals,after:ops.map(s=>({...s,value:4}))},definitions),/unexpected change/);
  for(const builder of [buildReadScript,buildWriteScript]) assert.throws(()=>builder([{...ops[0],name:'mouse; injected'}]),/allowlist/);
});

// This native boundary has NO P/Invoke declarations. All writes below are to
// C# fields in the test process; the production merge and guard logic is reused.
const fakeNative=`
public static class RanklyKeyboardNative {
  public static uint Sticky=510, Toggle=62;
  public static RanklyKeyboardFilter Current=new RanklyKeyboardFilter {cbSize=24,dwFlags=126,iWaitMSec=750,iDelayMSec=1000,iRepeatMSec=500,iBounceMSec=0};
  public static int Writes;
  public static bool FailWrite, FailRead;
  public static bool Pair(uint action,uint size,ref RanklyKeyboardPair value,uint options) {
    if(size!=8 || value.cbSize!=8) throw new Exception("Wrong pair size");
    if(action==0x3A || action==0x34) {if(options!=0)throw new Exception("Read options");value.dwFlags=action==0x3A?Sticky:Toggle;return !FailRead;}
    if(action!=0x3B && action!=0x35) throw new Exception("Unexpected action");
    if(options!=3)throw new Exception("Must persist and notify");
    if(FailWrite)return false;
    Writes++;if(action==0x3B)Sticky=value.dwFlags;else Toggle=value.dwFlags;return true;
  }
  public static bool Filter(uint action,uint size,ref RanklyKeyboardFilter value,uint options) {
    if(size!=24 || value.cbSize!=24)throw new Exception("Wrong filter size");
    if(action==0x32) {if(options!=0)throw new Exception("Read options");value=Current;return !FailRead;}
    if(action!=0x33 || options!=3)throw new Exception("Unexpected filter write");
    if(FailWrite)return false;
    Writes++;Current=value;return true;
  }
}
`;

test('native keyboard writer preserves other flags and timings and enforces support at write time',{skip:process.platform!=='win32'},async()=>{
  // Strip the real interop prelude completely from the executed write fixture.
  const apply=buildWriteScript(ops).replace(keyboardReadPrelude,'');
  const restore=buildWriteScript(originals).replace(keyboardReadPrelude,'');
  const result=await runPowerShell(`
Add-Type -TypeDefinition ${psQuote(keyboardStructures+fakeNative+keyboardLogic)}
$null=& { ${apply} }
$applied=@([RanklyKeyboardNative]::Sticky,[RanklyKeyboardNative]::Toggle,[RanklyKeyboardNative]::Current.dwFlags)
# Simulate a later independent flag and timing change.
[RanklyKeyboardNative]::Sticky=[RanklyKeyboardNative]::Sticky -bor 512
$filter=[RanklyKeyboardNative]::Current; $filter.iDelayMSec=1250; [RanklyKeyboardNative]::Current=$filter
$null=& { ${restore} }
$restored=@([RanklyKeyboardNative]::Sticky,[RanklyKeyboardNative]::Toggle,[RanklyKeyboardNative]::Current.dwFlags)
$writes=[RanklyKeyboardNative]::Writes
# Reapplying the current value is a native no-op.
$null=& { ${restore} }
$noop=([RanklyKeyboardNative]::Writes -eq $writes)
$blocked=@()
foreach($flags in @(511,508)) {
  [RanklyKeyboardNative]::Sticky=[uint32]$flags
  try { [RanklyKeyboard]::Write('sticky',0); $blocked+=$false } catch { $blocked+=$true }
}
[RanklyKeyboardNative]::Sticky=510
[RanklyKeyboardNative]::FailWrite=$true
try { [RanklyKeyboard]::Write('sticky',0); $blocked+=$false } catch { $blocked+=$true }
[RanklyKeyboardNative]::FailRead=$true
try { [RanklyKeyboard]::Write('sticky',0); $blocked+=$false } catch { $blocked+=$true }
@{applied=$applied;restored=$restored;filter=[RanklyKeyboardNative]::Current;noop=$noop;blocked=$blocked;writes=[RanklyKeyboardNative]::Writes} | ConvertTo-Json -Depth 5 -Compress
`);
  assert.deepEqual(result.applied,[498,50,114]);
  assert.deepEqual(result.restored,[1022,54,122]);
  assert.deepEqual(result.filter,{cbSize:24,dwFlags:122,iWaitMSec:750,iDelayMSec:1250,iRepeatMSec:500,iBounceMSec:0});
  assert.equal(result.noop,true);assert.deepEqual(result.blocked,[true,true,true,true]);assert.equal(result.writes,6);
});

test('real keyboard capability probe uses GET only; generated scripts parse without executing writes',{skip:process.platform!=='win32'},async()=>{
  const scripts=[buildReadScript(ops),buildWriteScript(ops),buildWriteScript(originals)];
  const parse=await runPowerShell(`$all=@(); foreach($body in @(${scripts.map(psQuote).join(',')})) { $tokens=$null; $errors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($body,[ref]$tokens,[ref]$errors); $all+=@($errors | ForEach-Object { $_.Message }) }; ConvertTo-Json -InputObject @($all) -Compress`);
  assert.deepEqual(parse,[]);
  const current=await runPowerShell(scripts[0]);
  assert.equal(current.length,3);
  for(let i=0;i<3;i++) {
    assert.equal(current[i].name,keyboardShortcuts[i]);
    assert.ok([0,4,8,12].includes(current[i].value));
    assert.equal(typeof current[i].available,'boolean');assert.equal(typeof current[i].active,'boolean');
  }
});
