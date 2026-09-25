import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tweaks, validateTweakIds, validateRecoveryIds } from '../shared/catalog.mjs';
import { legacyV11Tweaks } from '../shared/legacy-v1.1-tweaks.mjs';
import { powerControls } from '../shared/power-settings.mjs';
import { operationsFor, operationKey } from '../shared/operations.mjs';
import { TweakEngine, atomicJSON } from '../electron/engine.mjs';

const scheme='381b4222-f694-41f0-9685-ff5bb260df2e';
const adapterId='246ed835-ce67-4f81-9301-1ed6b13aa4f8';
const high='8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
const context={scheme,
  powerValues:[scheme,high].flatMap(plan=>Object.values(powerControls).flat().map(s=>({scheme:plan,...s,available:true}))),
  networkProperties:['*InterruptModeration','*EEE','EnableGreenEthernet','*RSS'].map(keyword=>({adapter:adapterId,keyword,validValues:['0','1']})),
};
const retiredIds=['cpu-responsiveness','pcie-performance','ethernet-latency','network-rss'];
const bundleIds=['performance-power','ethernet-optimization'];

async function fixture(t) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'rankly-grouping-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const operations=operationsFor(validateTweakIds(bundleIds),context);
  const originals=operations.map(o=>({...o,value:o.type==='network'?[o.value[0]==='0'?'1':'0']:o.value===0?1:0}));
  const values=new Map(originals.map(o=>[operationKey(o),structuredClone(o)]));
  const adapter={
    resolve:async selected=>operationsFor(selected,context),
    read:async ops=>ops.map(o=>structuredClone(values.get(operationKey(o)))),
    write:async ops=>{for(const o of ops)values.set(operationKey(o),structuredClone(o));},
  };
  const engine=new TweakEngine(directory,adapter);
  const seedLegacy=async ids=>{
    const definitions=validateRecoveryIds(ids);
    const after=operationsFor(definitions,context);
    const entry={format:2,id:'v1.1-change',date:'2026-09-13T00:00:00Z',ids,names:definitions.map(t=>t.name),before:await adapter.read(after),after,status:'applied'};
    await atomicJSON(path.join(directory,'recovery.json'),[entry]);
    await adapter.write(after);
    return entry;
  };
  return {engine,adapter,operations,originals,seedLegacy};
}

test('retired v1.1 definitions retain exact settings and cannot drift with the current bundles',()=>{
  assert.deepEqual(legacyV11Tweaks.map(t=>t.id),retiredIds);
  assert.deepEqual(legacyV11Tweaks.map(t=>t.name),['CPU responsiveness','PCIe performance','Ethernet low latency','Multicore networking']);
  const cpu='54533251-82be-4824-96c1-47b60b740d00';
  assert.deepEqual(legacyV11Tweaks[0].powerSettings,[
    {subgroup:cpu,setting:'be337238-0d82-4146-a960-4f3749d470c7',value:2},
    {subgroup:cpu,setting:'36687f9e-e3a5-4dbf-b1dc-15eb381c6863',value:0},
    {subgroup:cpu,setting:'bc5038f7-23e0-4960-96da-33abaf5935ec',value:100},
  ]);
  assert.deepEqual(legacyV11Tweaks[1].powerSettings,[{subgroup:'501a4d13-42af-4429-9fd1-a8218c268e20',setting:'ee12f906-d277-404b-b6da-e5fa1a576df5',value:0}]);
  assert.deepEqual(legacyV11Tweaks[2].networkSettings,[
    {keyword:'*InterruptModeration',value:['0'],required:true},
    {keyword:'*EEE',value:['0']},
    {keyword:'EnableGreenEthernet',value:['0']},
  ]);
  assert.deepEqual(legacyV11Tweaks[3].networkSettings,[{keyword:'*RSS',value:['1'],required:true}]);
  assert.throws(()=>legacyV11Tweaks[0].powerSettings[0].value=9,TypeError);
  assert.throws(()=>legacyV11Tweaks[2].networkSettings[0].value.push('9'),TypeError);
  assert.notEqual(legacyV11Tweaks[0].powerSettings[0],powerControls['performance-power'][0]);
});

for(const id of retiredIds) test(`v1.1 ${id} backup remains restorable but its old control cannot be applied`,async t=>{
  const f=await fixture(t);
  const entry=await f.seedLegacy([id]);
  assert.throws(()=>validateTweakIds([id]),/valid, unique/);
  await assert.rejects(f.engine.apply([id]),/valid, unique/);
  await f.engine.restore(entry.id);
  assert.deepEqual(await f.adapter.read(f.operations),f.originals);
  assert.equal((await f.engine.history())[0].status,'restored');
});

test('new power and Ethernet bundles recover in order across an older v1.1 journal',async t=>{
  const f=await fixture(t);
  const old=await f.seedLegacy(['cpu-responsiveness','ethernet-latency']);
  const beforeBundles=await f.adapter.read(f.operations);
  const current=await f.engine.apply(bundleIds);
  assert.equal(current.after.length,8);
  assert.equal(current.ids.length,2);
  await assert.rejects(f.engine.restore(old.id),/most recent/);
  await f.engine.restore(current.id);
  assert.deepEqual(await f.adapter.read(f.operations),beforeBundles);
  await f.engine.restore(old.id);
  assert.deepEqual(await f.adapter.read(f.operations),f.originals);
});

test('grouped controls retain their settings without duplicate operations',()=>{
  const power=operationsFor(validateTweakIds(['performance-power']),context);
  const ethernet=operationsFor(validateTweakIds(['ethernet-optimization']),context);
  assert.equal(power.length,4);
  assert.ok(power.every(o=>o.scheme===scheme));
  assert.equal(ethernet.length,4);
  assert.ok(tweaks.find(t=>t.id==='ethernet-optimization').networkSettings.every(s=>!s.required));
  assert.ok(retiredIds.every(id=>!tweaks.some(t=>t.id===id)));
  const catalogOps=operationsFor(tweaks,context);
  assert.equal(new Set(catalogOps.map(operationKey)).size,catalogOps.length);
});
