import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateRecoveryIds } from '../shared/catalog.mjs';
import { operationsFor, equalOperations, unavailableReason } from '../shared/operations.mjs';
import { MEMORY_INTEGRITY_PATH, securityTweakState } from '../shared/security-settings.mjs';
import { buildReadScript, buildWriteScript, runPowerShell, psQuote } from '../electron/windows.mjs';
import { securityReadPrelude } from '../electron/security-scripts.mjs';
const definitions=validateRecoveryIds(['memory-integrity-off']);
const desired=operationsFor(definitions);
const originalMemory={type:'registry',path:MEMORY_INTEGRITY_PATH,name:'Enabled',exists:true,kind:'DWord',value:1};
test('Memory Integrity distinguishes blocked, active, pending restart and actually off states',()=>{
  const [memory]=definitions,context={build:22631,memoryIntegrity:{available:true,running:true}};
  assert.equal(unavailableReason(memory,context),'');
  assert.equal(unavailableReason(memory,{...context,memoryIntegrity:{available:false,reason:'Memory Integrity is firmware-locked'}}),'Memory Integrity is firmware-locked');
  const base={available:true,enabled:true,current:[]};
  const pending=securityTweakState(memory,base,context);assert.equal(pending.pending,true);assert.equal(pending.enabled,false);
  const off=securityTweakState(memory,{...base,enabled:false},{...context,memoryIntegrity:{available:true,running:false}});assert.equal(off.enabled,true);assert.equal(off.label,'Off');
});
test('generated Memory Integrity command reads lock and policy gates and only changes an isolated registry key',{skip:process.platform!=='win32'},async()=>{
  const root=`HKEY_CURRENT_USER\\Software\\RanklySecurityTest-${randomUUID()}`;
  const testRoot=`Registry::${root}`;
  const result=await runPowerShell(`
$testRoot=${psQuote(testRoot)}
New-Item -Path $testRoot -Force | Out-Null
try {
  Remove-PSDrive -Name HKLM
  New-PSDrive -Name HKLM -PSProvider Registry -Root ${psQuote(root)} | Out-Null
  function Get-CimInstance {param($Namespace,$ClassName) if($ClassName -ne 'Win32_DeviceGuard'){throw 'Unexpected query'};[pscustomobject]@{SecurityServicesRunning=@(2)} }
  ${securityReadPrelude}
  $null=& {${buildWriteScript([originalMemory])}}
  $original=& {${buildReadScript([desired[0]])}} | ConvertFrom-Json
  $null=& {${buildWriteScript([{...desired[0],exists:true}])}}
  $configured=& {${buildReadScript([desired[0]])}} | ConvertFrom-Json
  New-ItemProperty -LiteralPath ${psQuote(MEMORY_INTEGRITY_PATH)} -Name Locked -Value 1 -PropertyType DWord | Out-Null
  $locked=Get-RanklyMemoryIntegrityStatus
  $failure='';try {${buildWriteScript([originalMemory])}} catch {$failure=$_.Exception.Message}
  Remove-ItemProperty -LiteralPath ${psQuote(MEMORY_INTEGRITY_PATH)} -Name Locked
  $null=& {${buildWriteScript([originalMemory])}}
  $restored=& {${buildReadScript([desired[0]])}} | ConvertFrom-Json
  New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DeviceGuard' -Force | Out-Null
  New-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DeviceGuard' -Name HypervisorEnforcedCodeIntegrity -Value 2 -PropertyType DWord | Out-Null
  $policy=Get-RanklyMemoryIntegrityStatus
  @{original=@($original);configured=@($configured);restored=@($restored);locked=$locked;policy=$policy;failure=$failure} | ConvertTo-Json -Depth 6 -Compress
} finally {
  Remove-PSDrive -Name HKLM -ErrorAction SilentlyContinue
  if($testRoot -notmatch '^Registry::HKEY_CURRENT_USER\\\\Software\\\\RanklySecurityTest-[a-f0-9-]+$'){throw 'Invalid cleanup namespace'}
  Remove-Item -LiteralPath $testRoot -Recurse -Force
}`);
  assert.deepEqual(result.original,result.restored);assert.equal(result.configured[0].value,0);
  assert.equal(result.locked.available,false);assert.match(result.failure,/firmware-locked/);assert.equal(result.policy.available,false);
});
