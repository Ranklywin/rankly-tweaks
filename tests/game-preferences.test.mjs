import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TweakEngine, atomicJSON } from '../electron/engine.mjs';
import { operationsFor, operationKey, materializeOperations, allowedOperation, validateBackupOperations } from '../shared/operations.mjs';
import { GAME_GPU_ID, GAME_GPU_REGISTRY, gamePreferenceDefinition, gameRecoveryDefinitions, isLocalGameExecutable } from '../shared/game-preferences.mjs';
import { buildReadScript, buildWriteScript, runPowerShell, psQuote } from '../electron/windows.mjs';
import { validateRecoveryIds } from '../shared/catalog.mjs';

const game={id:'77777777-1111-2222-3333-444444444444',name:'Example game',path:'C:\\Games\\Example\\Game.exe'};
const target=()=>operationsFor([gamePreferenceDefinition(game)]);
async function setup(t,initial=[]) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'rankly-game-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const values=new Map(initial.map(o=>[operationKey(o),structuredClone(o)]));
  const adapter={
    read:async ops=>ops.map(o=>structuredClone(values.get(operationKey(o))||{type:o.type,path:o.path,name:o.name,exists:false})),
    write:async ops=>{for(const o of ops) {if(o.exists===false) values.delete(operationKey(o));else values.set(operationKey(o),structuredClone(o));}},
  };
  const engine=new TweakEngine(directory,adapter);
  // Reproduce an existing v1.9 journal without exposing the retired apply action.
  const seedLegacy=async (savedGame=game,status='applied')=>{
    const definition=gamePreferenceDefinition(savedGame);
    const before=await adapter.read(operationsFor([definition]));
    const after=materializeOperations(operationsFor([definition]),before);
    const entry={format:2,id:randomUUID(),date:new Date().toISOString(),ids:[GAME_GPU_ID],names:[definition.name],gamePath:savedGame.path,before,after,status};
    await atomicJSON(engine.file,[...await engine.readJournal(),entry]);
    await adapter.write(after);
    return entry;
  };
  return {directory,adapter,values,engine,seedLegacy};
}

test('per-game targets allow only local executable names in the graphics preferences key',()=>{
  for(const invalid of ['game.exe','C:game.exe','\\\\server\\game.exe','\\\\?\\C:\\game.exe','C:\\Games\\..\\game.exe','C:\\Games\\Game.exe:other','C:\\Game\\script.ps1','C:\\Games\\*.exe','C:\\Games\\\nGame.exe','C:\\NUL.exe','C:\\Games.\\Game.exe','C:\\Games\\\\Game.exe']) {
    assert.equal(isLocalGameExecutable(invalid),false,invalid);
    assert.throws(()=>gamePreferenceDefinition({path:invalid}),/local .exe/);
    assert.equal(allowedOperation({type:'registry',path:GAME_GPU_REGISTRY,name:invalid}),false);
  }
  assert.equal(isLocalGameExecutable("D:\\Player's Games\\Game $().exe"),true);
  assert.equal(allowedOperation(target()[0]),true);
  assert.equal(allowedOperation({...target()[0],path:'HKCU:\\Software\\Other'}),false);
  assert.equal(allowedOperation({...target()[0],name:'DirectXUserGlobalSettings'},[gamePreferenceDefinition(game)]),false);
  assert.throws(()=>buildWriteScript([{...target()[0],transform:undefined,name:'ArbitraryRegistryValue',value:'GpuPreference=2;'}]),/allowlist/);
});

test('legacy GPU backups restore exact originals and absent values after feature removal',async t=>{
  const original={...target()[0],exists:true,value:'AutoHDREnable=1;GpuPreference=2;CustomFlag=keep;GpuPreference=1;'};
  delete original.transform;
  const {engine,adapter,seedLegacy}=await setup(t,[original]);
  const entry=await seedLegacy();
  assert.equal(entry.after[0].value,'AutoHDREnable=1;CustomFlag=keep;GpuPreference=2;');
  assert.equal(engine.applyGame,undefined);
  await engine.restore(entry.id);assert.deepEqual((await adapter.read(target()))[0],original);
  const other={...game,path:'D:\\Other game\\Game.exe'};
  const missing=await seedLegacy(other);assert.equal(missing.before[0].exists,false);
  await engine.restore(missing.id);assert.equal((await adapter.read(operationsFor([gamePreferenceDefinition(other)])))[0].exists,false);
});

test('legacy GPU changes retain reverse recovery order across old and current tweaks',async t=>{
  const {engine,adapter,directory,seedLegacy}=await setup(t);
  const oldDefinitions=validateRecoveryIds(['game-mode']);
  const before=await adapter.read(operationsFor(oldDefinitions));const after=materializeOperations(operationsFor(oldDefinitions),before);
  const legacy={id:'old-game-mode',date:new Date().toISOString(),ids:['game-mode'],names:['Game Mode'],before,after,status:'applied'};
  await atomicJSON(path.join(directory,'recovery.json'),[legacy]);await adapter.write(after);
  const preference=await seedLegacy();const cleanup=await engine.apply(['windows-cleanup']);
  await assert.rejects(engine.restore(preference.id),/most recent/);
  await engine.restore(cleanup.id);
  await engine.restore(preference.id);await engine.restore(legacy.id);
  assert.ok((await engine.history()).every(e=>e.status==='restored'));
});

test('interrupted legacy GPU changes still block new writes and recover after restart',async t=>{
  const {adapter,directory,seedLegacy}=await setup(t);
  const entry=await seedLegacy(game,'prepared');
  const restarted=new TweakEngine(directory,adapter);
  await assert.rejects(restarted.apply(['windows-cleanup']),/interrupted/);
  await restarted.restore(entry.id);assert.equal((await adapter.read(target()))[0].exists,false);
});

test('game recovery rejects altered targets, unexpected changes, and retired apply IDs',async t=>{
  const {engine,seedLegacy}=await setup(t);const entry=await seedLegacy();
  const definitions=gameRecoveryDefinitions(entry);validateBackupOperations(entry,definitions);
  for(const modify of [e=>{e.before[0].name='C:\\Another.exe';e.after[0].name='C:\\Another.exe';},e=>{e.before.push({...e.before[0],name:'D:\\Other.exe'});e.after.push({...e.after[0],name:'D:\\Other.exe'});},e=>{e.after[0].value='GpuPreference=2;UnrequestedFlag=1;';}]) {
    const altered=structuredClone(entry);modify(altered);assert.throws(()=>validateBackupOperations(altered,definitions),/backup/);
  }
  assert.throws(()=>gameRecoveryDefinitions({...entry,ids:[GAME_GPU_ID,'windows-cleanup']}),/invalid target/);
  assert.throws(()=>gameRecoveryDefinitions({...entry,gamePath:'HKLM:\\SOFTWARE'}),/invalid target/);
  assert.throws(()=>gameRecoveryDefinitions({...entry,format:undefined}),/invalid target/);
  await assert.rejects(engine.apply([GAME_GPU_ID]),/valid, unique/);
});

test('malformed legacy GPU snapshots fail before recovery writes',async t=>{
  const {engine,adapter,seedLegacy}=await setup(t);const entry=await seedLegacy();
  entry.before[0]={...entry.before[0],exists:true,kind:'DWord',value:2};
  await atomicJSON(engine.file,[entry]);
  let writes=0;adapter.write=async()=>{writes++;};
  await assert.rejects(engine.restore(entry.id),/supported string/);assert.equal(writes,0);
});

test('actual native game preference commands preserve literal executable names and restore exact values in an isolated registry drive',{skip:process.platform!=='win32'},async()=>{
  const root=`HKEY_CURRENT_USER\\Software\\RanklyGameTest-${randomUUID()}`;
  const special={...game,path:"C:\\Player's Games\\Game $().exe"};
  const desired=operationsFor([gamePreferenceDefinition(special)]);
  const before=[{...desired[0],transform:undefined,exists:true,value:'AutoHDREnable=0;GpuPreference=1;'}];
  const after=materializeOperations(desired,before);
  const result=await runPowerShell(`
$testRoot=${psQuote(`Registry::${root}`)}
New-Item -Path $testRoot -Force | Out-Null
try {
  Remove-PSDrive -Name HKCU
  New-PSDrive -Name HKCU -PSProvider Registry -Root ${psQuote(root)} | Out-Null
  $null=& { ${buildWriteScript(before)} }
  $original=& { ${buildReadScript(desired)} } | ConvertFrom-Json
  $null=& { ${buildWriteScript(after)} }
  $configured=& { ${buildReadScript(desired)} } | ConvertFrom-Json
  $null=& { ${buildWriteScript(before)} }
  $restored=& { ${buildReadScript(desired)} } | ConvertFrom-Json
  @{original=@($original);configured=@($configured);restored=@($restored)} | ConvertTo-Json -Depth 8 -Compress
} finally {
  Remove-PSDrive -Name HKCU -ErrorAction SilentlyContinue
  if($testRoot -notmatch '^Registry::HKEY_CURRENT_USER\\\\Software\\\\RanklyGameTest-[a-f0-9-]+$') { throw 'Test cleanup target escaped its registry namespace.' }
  Remove-Item -LiteralPath $testRoot -Recurse -Force
}`);
  assert.deepEqual(result.original,result.restored);
  assert.equal(result.configured[0].name,special.path);
  assert.equal(result.configured[0].value,'AutoHDREnable=0;GpuPreference=2;');
});
