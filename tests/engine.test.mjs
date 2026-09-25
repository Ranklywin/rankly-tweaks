import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TweakEngine, atomicJSON } from '../electron/engine.mjs';
import { operationsFor, equalOperations, buildWriteScript, psQuote } from '../electron/windows.mjs';
import { tweaks, validateTweakIds, validateRecoveryIds } from '../shared/catalog.mjs';
import { operationKey } from '../shared/operations.mjs';
import { legacyTweaks } from '../shared/legacy-tweaks.mjs';
import { retiredTweakIds } from '../shared/retired-settings.mjs';

async function setup(t, initial=[]) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'rankly-engine-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const key=operationKey;
  const values=new Map(initial.map(o=>[key(o),structuredClone(o)]));
  const adapter={
    read:async ops=>ops.map(o=>values.has(key(o))?structuredClone(values.get(key(o))):{type:'registry',path:o.path,name:o.name,exists:false}),
    write:async ops=>{for(const o of ops) { if(o.exists===false)values.delete(key(o));else values.set(key(o),structuredClone(o)); }},
  };
  return {engine:new TweakEngine(directory,adapter),directory,values,adapter};
}
test('catalog accepts only explicit unique tweak IDs',()=>{
  assert.throws(()=>validateTweakIds(['game-mode; Remove-Item C:']));
  assert.throws(()=>validateTweakIds(['windows-cleanup','windows-cleanup']));
  assert.throws(()=>validateTweakIds([]));
  assert.throws(()=>validateTweakIds('windows-cleanup'));
  assert.equal(validateTweakIds(['windows-cleanup'])[0].name,'Windows cleanup');
});
test('withdrawn controls cannot be applied or restored through the native writer',async t=>{
  const {engine,adapter}=await setup(t);let writes=0;adapter.write=async()=>{writes++;};
  for(const id of retiredTweakIds) {
    assert.throws(()=>validateTweakIds([id]));assert.throws(()=>validateRecoveryIds([id]));
    await assert.rejects(engine.apply([id]));
  }
  for(const type of ['defender','defender-startup'])assert.throws(()=>buildWriteScript([{type,name:'DisableRealtimeMonitoring',value:true}]),/allowlist/);
  assert.equal(writes,0);assert.equal(typeof engine.enableDefender,'undefined');
});

test('old withdrawn backups stay intact on disk without blocking or entering normal recovery',async t=>{
  const {engine,adapter,directory}=await setup(t),file=path.join(directory,'recovery.json');
  const retired=retiredTweakIds.map((id,i)=>({id:'retired-'+i,date:new Date().toISOString(),ids:[id],names:['Old control'],before:[{type:'defender-startup',value:[]}],after:[{type:'defender-startup',value:[]}],status:'recovery-needed'}));
  const mixed={...structuredClone(retired[0]),id:'old-mixed-batch',ids:[retiredTweakIds[0],'gaming-optimization'],names:['Old control','Gaming optimization']};
  const preserved=[...retired,mixed];await atomicJSON(file,preserved);
  await writeFile(path.join(directory,'defender-control.json'),'not valid JSON');
  await writeFile(path.join(directory,'defender-remover.json'),'not valid JSON');
  assert.deepEqual(await engine.history(),[]);
  let writes=0;const write=adapter.write;adapter.write=async ops=>{writes++;assert.ok(ops.every(o=>o.type==='registry'));await write(ops);};
  for(const entry of preserved)await assert.rejects(engine.restore(entry.id),/most recent/);
  assert.equal(writes,0);
  const change=await engine.apply(['gaming-optimization']);await engine.restore(change.id);
  assert.equal(writes,2);assert.equal((await engine.history()).length,1);assert.equal((await engine.history())[0].status,'restored');
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')).slice(0,preserved.length),preserved);
});

test('backup is durably written before the first setting write',async t=>{
  const {engine,adapter,directory}=await setup(t); const write=adapter.write;
  adapter.write=async ops=>{const journal=JSON.parse(await readFile(path.join(directory,'recovery.json'),'utf8'));assert.equal(journal[0].status,'prepared');assert.equal(journal[0].before[0].exists,false);await write(ops);};
  await engine.apply(['gaming-optimization']);
  assert.equal((await engine.history())[0].status,'applied');
});
test('restore recovers missing values and original registry types exactly',async t=>{
  const original={type:'registry',...tweaks[0].operations[0],exists:true,kind:'String',value:'original'};
  const {engine,adapter}=await setup(t,[original]);
  const before=await adapter.read(operationsFor([tweaks[0]]));
  const change=await engine.apply(['gaming-optimization']);await engine.restore(change.id);
  assert.deepEqual(await adapter.read(operationsFor([tweaks[0]])),before);
  assert.equal((await engine.history())[0].status,'restored');
});
test('partial writes roll back the entire batch',async t=>{
  const {engine,adapter}=await setup(t);const write=adapter.write;let count=0;
  adapter.write=async ops=>{count++;if(count===1){await write(ops.slice(0,1));throw new Error('Simulated Windows failure');}await write(ops);};
  await assert.rejects(engine.apply(['gaming-optimization','windows-cleanup']),/Previous values were restored and verified/);
  assert.equal((await engine.history())[0].status,'rolled-back');
  assert.ok((await adapter.read(operationsFor(validateTweakIds(['gaming-optimization','windows-cleanup'])))).every(o=>!o.exists));
});
test('failed rollback blocks new changes and remains recoverable',async t=>{
  const {engine,adapter}=await setup(t);const write=adapter.write;
  adapter.write=async()=>{throw new Error('Simulated access denied');};
  await assert.rejects(engine.apply(['windows-cleanup']),/Open Recovery/);
  await assert.rejects(engine.apply(['gaming-optimization']),/Restore the interrupted change/);
  const entry=(await engine.history())[0];assert.equal(entry.status,'recovery-needed');
  adapter.write=write;await engine.restore(entry.id);assert.equal((await engine.history())[0].status,'restored');
});
test('verifies persisted settings instead of trusting process exit',async t=>{
  const {engine,adapter}=await setup(t);adapter.write=async()=>{};
  await assert.rejects(engine.apply(['windows-cleanup']),/did not retain/);
  assert.equal((await engine.history())[0].status,'rolled-back');
});
test('restores must follow reverse chronological order',async t=>{
  const {engine}=await setup(t);const a=await engine.apply(['gaming-optimization']);const b=await engine.apply(['windows-cleanup']);
  await assert.rejects(engine.restore(a.id),/most recent change first/);
  await engine.restore(b.id);await engine.restore(a.id);
  assert.ok((await engine.history()).every(e=>e.status==='restored'));
});
test('already matching settings do not create redundant backups',async t=>{
  const {engine}=await setup(t);await engine.apply(['windows-cleanup']);const result=await engine.apply(['windows-cleanup']);
  assert.equal(result.unchanged,true);assert.equal((await engine.history()).length,1);
});
test('malformed journals fail closed without overwriting backups',async t=>{
  const {engine,directory}=await setup(t);const file=path.join(directory,'recovery.json');await writeFile(file,'{broken','utf8');
  await assert.rejects(engine.apply(['windows-cleanup']),/journal could not be read/);assert.equal(await readFile(file,'utf8'),'{broken');
  await writeFile(file,JSON.stringify([{id:'bad',date:'bad-date',before:[],after:[],status:'applied'}]),'utf8');
  await assert.rejects(engine.history(),/journal could not be read/);
});
test('interrupted prepared transactions are recoverable on restart',async t=>{
  const {engine,adapter,directory}=await setup(t);const before=await adapter.read(operationsFor(validateTweakIds(['windows-cleanup'])));
  const after=operationsFor(validateTweakIds(['windows-cleanup'])).map(o=>({...o,exists:true}));
  await atomicJSON(path.join(directory,'recovery.json'),[{id:'interrupted',date:new Date().toISOString(),ids:['windows-cleanup'],names:['Windows cleanup'],before,after,status:'prepared'}]);
  await adapter.write(after);await assert.rejects(engine.apply(['gaming-optimization']),/interrupted/);await engine.restore('interrupted');assert.deepEqual(await adapter.read(after),before);
});
test('parallel mutations are refused while a batch is in flight',async t=>{
  const {engine,adapter}=await setup(t);let unblock;const gate=new Promise(r=>{unblock=r;});const write=adapter.write;adapter.write=async ops=>{await gate;await write(ops);};
  const first=engine.apply(['windows-cleanup']);await assert.rejects(engine.apply(['gaming-optimization']),/in progress/);unblock();await first;
});
test('power plan backup returns to the original plan',async t=>{
  const original={type:'power',value:'381b4222-f694-41f0-9685-ff5bb260df2e'};
  const {engine,adapter}=await setup(t,[original]);const entry=await engine.apply(['high-performance']);await engine.restore(entry.id);
  assert.deepEqual(await adapter.read([original]),[original]);
});
test('native write scripts preserve unrelated values and constrain paths',()=>{
  const script=buildWriteScript(operationsFor(validateTweakIds(['windows-cleanup'])));
  assert.match(script,/if \(!\(Test-Path -LiteralPath/);
  assert.throws(()=>buildWriteScript([{type:'registry',path:'HKLM:\\SOFTWARE',name:'x',kind:'DWord',value:0}]),/allowlist/);
  assert.throws(()=>buildWriteScript([{type:'power',value:'x; evil'}]),/Invalid power/);
  assert.throws(()=>buildWriteScript([{type:'registry',...tweaks[0].operations[0],kind:'QWord',value:9007199254740992}]),/safely restore/);
  assert.equal(psQuote("it's $(not executed)"),"'it''s $(not executed)'");
});
test('state equality distinguishes absent, zero, and different types',()=>{
  const o={type:'registry',...tweaks[0].operations[0],exists:true};
  assert.equal(equalOperations([o],[{...o,exists:false}]),false);
  assert.equal(equalOperations([o],[{...o,kind:'String',value:'1'}]),false);
  assert.equal(equalOperations([{...o,exists:false}],[{...o,exists:false}]),true);
});

async function legacyChange(directory,adapter,ids,status='applied') {
  const after=operationsFor(validateRecoveryIds(ids)).map(o=>o.type==='registry'?{...o,exists:true}:o);
  const before=await adapter.read(after);
  const entry={id:'legacy-change',date:new Date().toISOString(),ids,names:ids,before,after,status};
  await atomicJSON(path.join(directory,'recovery.json'),[entry]);
  await adapter.write(after);
  return entry;
}

test('retired individual tweaks can be restored but cannot be applied',async t=>{
  const {engine,directory,adapter}=await setup(t);
  const entry=await legacyChange(directory,adapter,['transparency','tips','welcome'],'prepared');
  for(const id of ['transparency','tips','welcome','game-mode','game-capture']) {
    assert.throws(()=>validateTweakIds([id]));
    await assert.rejects(engine.apply([id]),/valid, unique/);
  }
  await engine.restore(entry.id);
  assert.deepEqual(await adapter.read(entry.after),entry.before);
});

test('all ten legacy tweaks remain restorable after catalog expansion',async t=>{
  const originalPower={type:'power',value:'381b4222-f694-41f0-9685-ff5bb260df2e'};
  const {engine,directory,adapter}=await setup(t,[originalPower]);
  const entry=await legacyChange(directory,adapter,legacyTweaks.map(t=>t.id));
  assert.equal(entry.ids.length,10);
  assert.equal((await engine.history())[0].ids.length,10);
  await engine.restore(entry.id);
  assert.deepEqual(await adapter.read(entry.after),entry.before);
});

test('a grouped cleanup restores precisely across an older individual backup',async t=>{
  const {engine,directory,adapter}=await setup(t);
  const old=await legacyChange(directory,adapter,['tips']);
  const cleanup=operationsFor(validateTweakIds(['windows-cleanup']));
  const beforeBundle=await adapter.read(cleanup);
  const current=await engine.apply(['windows-cleanup']);
  assert.equal(current.ids.length,1);
  assert.equal(current.after.length,6);
  await assert.rejects(engine.restore(old.id),/most recent/);
  await engine.restore(current.id);
  assert.deepEqual(await adapter.read(cleanup),beforeBundle);
  await engine.restore(old.id);
  assert.deepEqual(await adapter.read(old.after),old.before);
});
