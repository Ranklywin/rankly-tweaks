import { securityReadPrelude, memoryIntegrityWriteGuard } from './security-scripts.mjs';
import { APP_VERSION } from '../shared/version.mjs';
import { MEMORY_INTEGRITY_PATH, securityTweakState } from '../shared/security-settings.mjs';
import { serviceReadPrelude, serviceWriteScript } from './service-scripts.mjs';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { tweaks } from '../shared/catalog.mjs';
import { operationsFor, equalOperations, allowedOperation, unavailableReason, isGuid } from '../shared/operations.mjs';
import { powerReadPrelude, networkReadPrelude } from './native-scripts.mjs';
import { getCapabilities } from './capabilities.mjs';
import { keyboardReadPrelude } from './keyboard-scripts.mjs';
import { validShortcutValue } from '../shared/keyboard-settings.mjs';
import { wifiReadPrelude, wifiWriteScript } from './wifi-scripts.mjs';
export { operationsFor, equalOperations } from '../shared/operations.mjs';

const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
export const psQuote = value => "'" + String(value).replaceAll("'", "''") + "'";
export async function runPowerShell(script, timeout = 40000) {
  if (process.platform !== 'win32') throw new Error('This feature requires Windows.');
  const body = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n$ErrorActionPreference = 'Stop'\ntry {\n${script}\n} catch { ConvertTo-Json -InputObject @{ ranklyError=$_.Exception.Message } -Compress }`;
  // A fixed bootstrap reads trusted script content on stdin, avoiding Windows'
  // command-line length limit when a batch contains many registry operations.
  const bootstrap = '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); $ranklyScript = [Console]::In.ReadToEnd(); & ([scriptblock]::Create($ranklyScript))';
  const stdout = await new Promise((resolve, reject) => {
    const child = execFile(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(bootstrap, 'utf16le').toString('base64')], { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, output, stderr) => {
      if (error) reject(new Error(error.killed ? 'Windows operation timed out. Check Recovery before retrying.' : (stderr.trim() || error.message)));
      else resolve(output);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(body, 'utf8');
  });
  let result;
  try { result=JSON.parse(stdout.trim().replace(/^\uFEFF/, '')); } catch { throw new Error('Windows returned an unreadable response. No success was assumed.'); }
  if(result?.ranklyError) throw new Error(result.ranklyError);
  return result;
}
export function buildReadScript(operations) {
  const statements=operations.map(o=>{
    if(o.type==='wifi-property') {if(!allowedOperation(o))throw new Error('Wi-Fi setting is not in the tweak allowlist.');return `(Get-RanklySavedWifiSetting ${psQuote(o.adapter)} ${psQuote(o.deviceId)} ${psQuote(o.keyword)}).snapshot`;}
    if(o.type==='keyboard-shortcut') {if(!allowedOperation(o))throw new Error('Keyboard shortcut is not in the tweak allowlist.');return `Get-RanklyKeyboardShortcut ${psQuote(o.name)}`;}
    if(o.type==='service') {if(!allowedOperation(o))throw new Error('Service is not in the tweak allowlist.');return `Get-RanklyServiceSnapshot ${psQuote(o.name)}`;}
    if(o.type==='power') return `$text=(& powercfg.exe /getactivescheme | Out-String); if ($LASTEXITCODE -ne 0) { throw 'Cannot read active power plan' }; $match=[regex]::Match($text,'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}'); if (!$match.Success) { throw 'Cannot identify active power plan' }; @{type='power';value=$match.Value.ToLower()}`;
    if(o.type==='power-setting') return `[uint32]$value=0; $result=[RanklyPowerReader]::Read(${psQuote(o.scheme)},${psQuote(o.subgroup)},${psQuote(o.setting)},[ref]$value); if ($result -ne 0) { throw 'A saved power setting is unavailable in this plan.' }; @{type='power-setting';scheme=${psQuote(o.scheme)};subgroup=${psQuote(o.subgroup)};setting=${psQuote(o.setting)};value=$value}`;
    if(o.type==='network') return `$property=Get-RanklyNetworkProperty ${psQuote(o.adapter)} ${psQuote(o.keyword)}; @{type='network';adapter=${psQuote(o.adapter)};keyword=${psQuote(o.keyword)};value=@($property.RegistryValue | ForEach-Object { [string]$_ })}`;
    if(o.type!=='registry') throw new Error('Unknown setting type.');
    return `$key=Get-Item -LiteralPath ${psQuote(o.path)} -ErrorAction SilentlyContinue; if ($null -ne $key -and $key.GetValueNames() -contains ${psQuote(o.name)}) { @{type='registry';path=${psQuote(o.path)};name=${psQuote(o.name)};exists=$true;value=$key.GetValue(${psQuote(o.name)},$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);kind=$key.GetValueKind(${psQuote(o.name)}).ToString()} } else { @{type='registry';path=${psQuote(o.path)};name=${psQuote(o.name)};exists=$false} }`;
  });
  return (operations.some(o=>o.type==='wifi-property')?wifiReadPrelude:'')+(operations.some(o=>o.type==='keyboard-shortcut')?keyboardReadPrelude:'')+(operations.some(o=>o.type==='service')?serviceReadPrelude:'')+(operations.some(o=>o.type==='power-setting')?powerReadPrelude:'')+(operations.some(o=>o.type==='network')?networkReadPrelude:'')+`\n$result=@(\n${statements.join('\n')}\n)\nConvertTo-Json -InputObject @($result) -Depth 8 -Compress`;
}
export async function readOperations(operations) { return runPowerShell(buildReadScript(operations)); }
export function buildWriteScript(operations) {
  const script=operations.map(o => {
    if(o.transform) throw new Error('Resolve the preference change before writing.');
    if (o.type === 'power') {
      if (!isGuid(o.value)) throw new Error('Invalid power plan.');
      return `& powercfg.exe /setactive ${psQuote(o.value)} | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Windows could not activate this power plan. It may be unavailable or managed.' }`;
    }
    if(!allowedOperation(o)) throw new Error('Setting is not in the tweak allowlist.');
    if(o.type==='wifi-property') return wifiWriteScript(o,psQuote);
    if(o.type==='keyboard-shortcut') {
      if(!validShortcutValue(o.value)) throw new Error('Invalid keyboard shortcut flags.');
      return `[RanklyKeyboard]::Write(${psQuote(o.name)},[uint32]${o.value})`;
    }
    if(o.type==='service') return serviceWriteScript(o);
    if(o.type==='power-setting') {
      if(!Number.isInteger(o.value)||o.value<0||o.value>4294967295) throw new Error('Invalid power setting value.');
      return `& powercfg.exe /setacvalueindex ${psQuote(o.scheme)} ${psQuote(o.subgroup)} ${psQuote(o.setting)} ${o.value} | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Windows could not change this power setting.' }`;
    }
    if(o.type==='network') {
      if(!Array.isArray(o.value)||!o.value.length||o.value.length>16||o.value.some(v=>typeof v!=='string'||v.length>256)) throw new Error('Invalid network property value.');
      return `$property=Get-RanklyNetworkProperty ${psQuote(o.adapter)} ${psQuote(o.keyword)}; Set-NetAdapterAdvancedProperty -InputObject $property -RegistryValue @ (${o.value.map(psQuote).join(',')}) -NoRestart -ErrorAction Stop | Out-Null`.replace('@ (','@(');
    }
    if (o.exists === false) return `if (Test-Path -LiteralPath ${psQuote(o.path)}) { Remove-ItemProperty -LiteralPath ${psQuote(o.path)} -Name ${psQuote(o.name)} -ErrorAction SilentlyContinue }`;
    if (!['String', 'ExpandString', 'DWord', 'QWord', 'Binary', 'MultiString'].includes(o.kind)) throw new Error('Unsupported registry value type.');
    let value;
    if (o.kind === 'DWord') { if (!Number.isInteger(o.value) || o.value < -2147483648 || o.value > 4294967295) throw new Error('Invalid DWORD.'); value = `([int]${o.value > 2147483647 ? o.value - 4294967296 : o.value})`; }
    else if (o.kind === 'QWord') { if (!Number.isSafeInteger(o.value)) throw new Error('Cannot safely restore this QWORD.'); value = `([long]${o.value})`; }
    else if (o.kind === 'Binary') { if (!Array.isArray(o.value) || o.value.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error('Invalid binary value.'); value = `([byte[]]@(${o.value.join(',')}))`; }
    else if (o.kind === 'MultiString') { if (!Array.isArray(o.value) || o.value.some(v => typeof v !== 'string')) throw new Error('Invalid multi-string.'); value = `([string[]]@(${o.value.map(psQuote).join(',')}))`; }
    else { if (typeof o.value !== 'string') throw new Error('Invalid string.'); value = psQuote(o.value); }
    return `if (!(Test-Path -LiteralPath ${psQuote(o.path)})) { New-Item -Path ${psQuote(o.path)} -Force | Out-Null }; New-ItemProperty -LiteralPath ${psQuote(o.path)} -Name ${psQuote(o.name)} -PropertyType ${o.kind} -Value ${value} -Force | Out-Null`;
  }).join('\n');
  const refresh=operations.some(o=>o.type==='power-setting')?`\n$text=(& powercfg.exe /getactivescheme | Out-String); if ($LASTEXITCODE -ne 0) { throw 'Cannot refresh power settings.' }; $plan=[regex]::Match($text,'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}').Value; if (!$plan) { throw 'Cannot identify the active plan.' }; & powercfg.exe /setactive $plan | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Cannot activate the changed power settings.' }`:'';
  return (operations.some(o=>o.type==='wifi-property')?wifiReadPrelude:'')+(operations.some(o=>o.type==='keyboard-shortcut')?keyboardReadPrelude:'')+(operations.some(o=>o.type==='registry'&&o.path===MEMORY_INTEGRITY_PATH)?securityReadPrelude:'')+(operations.some(o=>o.type==='registry'&&o.path===MEMORY_INTEGRITY_PATH)?memoryIntegrityWriteGuard:'')+(operations.some(o=>o.type==='network')?networkReadPrelude:'')+script+refresh+'\nConvertTo-Json -InputObject @{ success=$true } -Compress';
}
export async function writeOperations(operations) { return runPowerShell(buildWriteScript(operations),operations.some(o=>o.type==='service')?90000:40000); }
export async function resolveOperations(selected) {
  const context=await getCapabilities(runPowerShell);
  // Validate against the same destination plan that operationsFor will write.
  const targetContext={...context,scheme:selected.find(t=>t.power)?.power||context.scheme};
  for(const t of selected) {
    const reason=unavailableReason(t,targetContext);
    if(reason) throw new Error(`${t.name}: ${reason}.`);
    if(t.admin&&!context.admin) throw new Error('Open Rankly as administrator to apply system tweaks.');
  }
  const operations=operationsFor(selected,context);
  if(!operations.length) throw new Error('No supported changes were found.');
  return operations;
}
export async function scanSettings() {
  const context=await getCapabilities(runPowerShell);
  const states={};
  // Per-control reads keep one missing driver or inaccessible setting from hiding the library.
  const supported=[];
  for(const t of tweaks) {
    const reason=unavailableReason(t,context);
    if(reason) { states[t.id]={enabled:false,available:false,reason,current:[]};continue; }
    supported.push(t);
  }
  const operations=supported.flatMap(t=>operationsFor([t],context));
  try {
    const actual=await readOperations(operations);let offset=0;
    for(const t of supported) {const expected=operationsFor([t],context);const current=actual.slice(offset,offset+expected.length);offset+=expected.length;states[t.id]={enabled:equalOperations(expected,current),available:true,current};}
  } catch {
    for(const t of supported) {
      try {const expected=operationsFor([t],context);const current=await readOperations(expected);states[t.id]={enabled:equalOperations(expected,current),available:true,current};}
      catch {states[t.id]={enabled:false,available:false,reason:'Windows could not read this setting',current:[]};}
    }
  }
  for(const t of tweaks)states[t.id]=securityTweakState(t,states[t.id],context);
  return states;
}
let systemCache;
export async function getSystem(force = false) {
  if (!force && systemCache && Date.now() - systemCache.at < 30000) return systemCache.value;
  const detected = await runPowerShell(`
$osInfo = Get-CimInstance Win32_OperatingSystem
$cpuInfo = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpus = @(Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, CurrentRefreshRate)
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$battery = @(Get-CimInstance Win32_Battery)
$adapters = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' | Select-Object Name, InterfaceDescription, LinkSpeed)
$active = (& powercfg.exe /getactivescheme | Out-String).Trim()
@{ os=$osInfo.Caption; build=$osInfo.BuildNumber; cpu=$cpuInfo.Name.Trim(); cores=$cpuInfo.NumberOfCores; threads=$cpuInfo.NumberOfLogicalProcessors; memoryTotal=[math]::Round($osInfo.TotalVisibleMemorySize / 1MB, 1); memoryFree=[math]::Round($osInfo.FreePhysicalMemory / 1MB, 1); gpus=$gpus; diskTotal=[math]::Round($disk.Size / 1GB, 1); diskFree=[math]::Round($disk.FreeSpace / 1GB, 1); laptop=($battery.Count -gt 0); administrator=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); adapters=$adapters; powerPlan=$active; scannedAt=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Depth 5 -Compress`);
  const value = { ...detected, platform: os.platform(), appVersion: APP_VERSION };
  systemCache = { value, at: Date.now() }; return value;
}
export async function pingNetwork(target) {
  const allowed = { cloudflare: '1.1.1.1', google: '8.8.8.8', quad9: '9.9.9.9' };
  if (!Object.hasOwn(allowed, target)) throw new Error('Choose one of the available test endpoints.');
  return runPowerShell(`
$ping = New-Object System.Net.NetworkInformation.Ping
$samples = @()
try { for ($i=0; $i -lt 10; $i++) { try { $reply=$ping.Send(${psQuote(allowed[target])}, 1000); if ($reply.Status -eq 'Success') { $samples += [double]$reply.RoundtripTime } else { $samples += $null } } catch { $samples += $null }; Start-Sleep -Milliseconds 200 } } finally { $ping.Dispose() }
@{ samples=@($samples); target=${psQuote(allowed[target])}; testedAt=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Depth 3 -Compress`, 20000);
}
