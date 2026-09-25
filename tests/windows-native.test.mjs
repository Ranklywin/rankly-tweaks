import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runPowerShell, buildWriteScript, buildReadScript, operationsFor, psQuote } from '../electron/windows.mjs';
import { validateTweakIds } from '../shared/catalog.mjs';

test('actual PowerShell adapter applies and restores within an isolated temporary registry drive', {skip:process.platform!=='win32'}, async()=>{
  // Rebind HKCU and HKLM only inside this PowerShell process. Generated commands
  // are tested under a disposable subkey, never the user's real gaming preferences.
  const root=`HKEY_CURRENT_USER\\Software\\RanklyNativeTest-${randomUUID()}`;
  const registryPath=`Registry::${root}`;
  const after=operationsFor(validateTweakIds(['gaming-optimization','mouse-acceleration','gpu-scheduling','background-apps','update-bandwidth','windowed-gaming','browser-background','onedrive-off'])).map(({transform,...o})=>({...o,exists:true}));
  const before=after.map((o,i)=>i===0?{...o,value:'Original string',kind:'String'}:{type:'registry',path:o.path,name:o.name,exists:false});
  const output=await runPowerShell(`
$testRoot=${psQuote(registryPath)}
New-Item -Path $testRoot -Force | Out-Null
try {
  Remove-PSDrive -Name HKCU
  New-PSDrive -Name HKCU -PSProvider Registry -Root ${psQuote(root)} | Out-Null
  Remove-PSDrive -Name HKLM
  New-PSDrive -Name HKLM -PSProvider Registry -Root ${psQuote(root)} | Out-Null
  $null = & { ${buildWriteScript(before)} }
  New-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\GameBar' -Name 'UnrelatedValue' -Value 'Keep me' -PropertyType String | Out-Null
  $original = & { ${buildReadScript(after)} } | ConvertFrom-Json
  $null = & { ${buildWriteScript(after)} }
  $configured = & { ${buildReadScript(after)} } | ConvertFrom-Json
  $unrelated = (Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\GameBar').UnrelatedValue
  $null = & { ${buildWriteScript(before)} }
  $restored = & { ${buildReadScript(after)} } | ConvertFrom-Json
  @{ original=@($original); configured=@($configured); restored=@($restored); unrelated=$unrelated } | ConvertTo-Json -Depth 8 -Compress
} finally {
  Remove-PSDrive -Name HKCU -ErrorAction SilentlyContinue
  Remove-PSDrive -Name HKLM -ErrorAction SilentlyContinue
  if ($testRoot -notmatch '^Registry::HKEY_CURRENT_USER\\\\Software\\\\RanklyNativeTest-[a-f0-9-]+$') { throw 'Test cleanup target escaped its registry namespace.' }
  Remove-Item -LiteralPath $testRoot -Recurse -Force
}`);
  assert.equal(output.unrelated,'Keep me');
  assert.deepEqual(output.original,output.restored);
  assert.equal(output.configured[0].kind,'DWord');assert.equal(output.configured[0].value,1);
  const mouse=output.configured.find(o=>o.name==='MouseSpeed');
  assert.equal(mouse.kind,'String');assert.equal(mouse.value,'0');
  assert.equal(output.configured.find(o=>o.name==='HwSchMode').value,2);
  assert.equal(output.configured.find(o=>o.name==='DOMaxBackgroundDownloadBandwidth').value,1024);
});
