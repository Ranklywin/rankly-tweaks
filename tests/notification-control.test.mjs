import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tweaks, validateTweakIds } from '../shared/catalog.mjs';
import { operationsFor, unavailableReason, operationKey, validateBackupOperations } from '../shared/operations.mjs';
import { TweakEngine } from '../electron/engine.mjs';
import { buildReadScript, buildWriteScript, runPowerShell, psQuote } from '../electron/windows.mjs';

const ids=['app-notifications'];
const [definition]=validateTweakIds(ids);
const [operation]=operationsFor([definition]);
const absent={type:'registry',path:operation.path,name:operation.name,exists:false};
const context={build:19045,edition:'Professional'};

test('notification control requires a known supported build and edition without hardware dependencies',()=>{
  for(const edition of ['Professional','ProfessionalN','Enterprise','Education','IoTEnterprise']) {
    for(const build of [19044,19045,22000,22631,26100]) assert.equal(unavailableReason(definition,{build,edition}),'');
  }
  for(const edition of ['Core','CoreSingleLanguage','',undefined]) assert.match(unavailableReason(definition,{...context,edition}),/Requires Windows Pro/);
  for(const build of [10240,19043,undefined,NaN,'26100']) assert.match(unavailableReason(definition,{...context,build}),/Requires a newer Windows/);
  assert.equal(definition.admin,true);
});

test('notification policy is account scoped and not duplicated by another current control',()=>{
  assert.deepEqual(operation,{type:'registry',path:'HKCU:\\SOFTWARE\\Policies\\Microsoft\\Windows\\CurrentVersion\\PushNotifications',name:'NoToastApplicationNotification',kind:'DWord',value:1});
  const matches=tweaks.flatMap(t=>(t.operations||[]).filter(o=>operationKey({type:'registry',...o})===operationKey(operation)));
  assert.equal(matches.length,1);
  assert.throws(()=>buildWriteScript([{...operation,name:'NoToastApplicationNotificationOnLockScreen'}]),/allowlist/);
  assert.throws(()=>validateBackupOperations({before:[{...absent,path:'HKLM:\\'+operation.path.slice(6)}],after:[operation]},[definition]),/does not match/);
});

async function fixture(t,original) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'rankly-notification-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  let current=structuredClone(original),writes=0;
  const adapter={
    resolve:async selected=>operationsFor(selected,context),
    read:async()=>[structuredClone(current)],
    write:async ops=>{writes++;current=structuredClone(ops[0]);},
  };
  return {engine:new TweakEngine(directory,adapter),adapter,directory,writes:()=>writes,current:()=>current};
}

for(const original of [absent,{...operation,exists:true,value:0},{...operation,exists:true,kind:'String',value:'existing preference'}]) {
  test(`notification recovery restores ${original.exists?original.kind:'absence'} exactly after restart`,async t=>{
    const f=await fixture(t,original),write=f.adapter.write;
    f.adapter.write=async ops=>{
      const journal=JSON.parse(await readFile(path.join(f.directory,'recovery.json'),'utf8'));
      assert.equal(journal[0].status,'prepared');
      assert.deepEqual(journal[0].before,[original]);
      await write(ops);
    };
    const entry=await f.engine.apply(ids);
    assert.deepEqual(f.current(),{...operation,exists:true});
    f.adapter.write=write;
    f.adapter.resolve=async()=>{throw new Error('Recovery must use its saved setting');};
    await new TweakEngine(f.directory,f.adapter).restore(entry.id);
    assert.deepEqual(f.current(),original);
  });
}

test('already suppressed notifications create no write or backup',async t=>{
  const f=await fixture(t,{...operation,exists:true});
  assert.equal((await f.engine.apply(ids)).unchanged,true);
  assert.equal(f.writes(),0);
  assert.deepEqual(await f.engine.history(),[]);
});

test('a failed notification verification rolls back the original setting',async t=>{
  const f=await fixture(t,absent),read=f.adapter.read;let reads=0;
  f.adapter.read=async()=>++reads===2?[{...operation,exists:true,value:0}]:read();
  await assert.rejects(f.engine.apply(ids),/restored and verified/);
  assert.deepEqual(f.current(),absent);
  assert.equal((await f.engine.history())[0].status,'rolled-back');
});

test('notification registry read, apply, and recovery scripts parse without executing writes',{skip:process.platform!=='win32'},async()=>{
  const scripts=[buildReadScript([operation]),buildWriteScript([operation]),buildWriteScript([absent]),buildWriteScript([{...operation,kind:'String',value:'old',exists:true}])];
  const errors=await runPowerShell(`$found=@(); foreach($body in @(${scripts.map(psQuote).join(',')})) { $tokens=$null; $errors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($body,[ref]$tokens,[ref]$errors); $found+=@($errors | ForEach-Object { $_.Message }) }; ConvertTo-Json -InputObject @($found) -Compress`);
  assert.deepEqual(errors,[]);
});
