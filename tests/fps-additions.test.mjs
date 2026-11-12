import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tweaks, guides, validateTweakIds } from '../shared/catalog.mjs';
import { operationsFor, operationKey, unavailableReason, validateBackupOperations, materializeOperations } from '../shared/operations.mjs';
import { evaluateCheckup, gpuKind } from '../shared/checkup.mjs';
import { summarizePolling } from '../shared/input-test.mjs';
import { TweakEngine } from '../electron/engine.mjs';
import { getCapabilities } from '../electron/capabilities.mjs';
import { checkupScript } from '../electron/checkup-scripts.mjs';
import { runPowerShell, psQuote } from '../electron/windows.mjs';

const definition=id=>tweaks.find(t=>t.id===id);
const now=Date.parse('2026-11-12T12:00:00Z');

// --- Variable refresh rate control -------------------------------------------------

test('VRR control requires Windows 1903 and a WDDM 2.6 driver',()=>{
  const vrr=definition('windowed-vrr');
  assert.equal(unavailableReason(vrr,{build:22631,vrr:true}),'');
  assert.match(unavailableReason(vrr,{build:22631,vrr:false}),/WDDM 2\.6/);
  assert.match(unavailableReason(vrr,{build:17763,vrr:true}),/newer Windows/);
  assert.equal(vrr.admin,undefined,'a per-user graphics preference must not require administrator access');
  assert.ok(vrr.source.startsWith('https://devblogs.microsoft.com/'));
});

test('VRR and windowed optimizations share one read, backup, and write',()=>{
  const both=operationsFor(validateTweakIds(['windowed-gaming','windowed-vrr']));
  assert.equal(both.length,1);
  assert.equal(both[0].value,'SwapEffectUpgradeEnable=1;VRROptimizeEnable=1;');
  // Merging must not alter the catalog definitions themselves.
  assert.equal(operationsFor([definition('windowed-gaming')])[0].value,'SwapEffectUpgradeEnable=1;');
  assert.equal(operationsFor([definition('windowed-vrr')])[0].value,'VRROptimizeEnable=1;');
  const before=[{type:'registry',path:both[0].path,name:both[0].name,exists:true,kind:'String',value:'AutoHDREnable=1;VRROptimizeEnable=0;'}];
  const after=materializeOperations(both,before);
  assert.equal(after[0].value,'AutoHDREnable=1;SwapEffectUpgradeEnable=1;VRROptimizeEnable=1;');
  validateBackupOperations({before,after},validateTweakIds(['windowed-gaming','windowed-vrr']));
  const catalogOps=operationsFor(tweaks,{build:26100,vrr:true});
  assert.equal(new Set(catalogOps.map(operationKey)).size,catalogOps.length);
});

test('applying VRR keeps other graphics preferences and restores the exact original',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'rankly-vrr-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const [op]=operationsFor([definition('windowed-vrr')]);
  const original={type:'registry',path:op.path,name:op.name,exists:true,kind:'String',value:'SwapEffectUpgradeEnable=1;VendorOption=keep;'};
  const values=new Map([[operationKey(original),structuredClone(original)]]);
  const adapter={resolve:async selected=>operationsFor(selected),read:async ops=>ops.map(o=>structuredClone(values.get(operationKey(o)))),write:async ops=>{for(const o of ops)values.set(operationKey(o),structuredClone(o));}};
  const engine=new TweakEngine(directory,adapter);
  const entry=await engine.apply(['windowed-vrr']);
  assert.equal(values.get(operationKey(original)).value,'SwapEffectUpgradeEnable=1;VendorOption=keep;VRROptimizeEnable=1;');
  assert.equal((await engine.apply(['windowed-vrr'])).unchanged,true);
  await new TweakEngine(directory,adapter).restore(entry.id);
  assert.deepEqual(values.get(operationKey(original)),original);
});

test('graphics capability reports VRR support from the highest WDDM version',async()=>{
  // The dxdiag result is cached per module instance, so each case uses a fresh import.
  const fresh=async graphics=>{const module=await import(`../electron/capabilities.mjs?case=${Math.random()}`);return module.getCapabilities(async body=>body.includes('dxdiag')?graphics:{});};
  assert.deepEqual(await fresh({hags:true,wddm:207}).then(c=>[c.hags,c.vrr]),[true,true]);
  assert.deepEqual(await fresh({hags:false,wddm:205}).then(c=>[c.hags,c.vrr]),[false,false]);
  assert.deepEqual(await fresh(true).then(c=>[c.hags,c.vrr]),[true,false]);
  assert.deepEqual(await fresh(false).then(c=>[c.hags,c.vrr]),[false,false]);
  const script=[];
  await getCapabilities(async body=>{script.push(body);return body.includes('dxdiag')?{hags:true,wddm:301}:{};});
  assert.ok(script.some(body=>/DriverModel/.test(body)&&/WDDM/.test(body)));
});

// --- Performance checkup -----------------------------------------------------------

const nvidia={name:'NVIDIA GeForce RTX 4070',pnp:'PCI\\VEN_10DE&DEV_2786',driverDate:'2026-08-24T00:00:00Z'};
const ddr4=(locator,bank,extra={})=>({capacityGB:16,speed:2133,configured:2133,type:26,formFactor:8,locator,bank,part:'KIT-A',...extra});
const display=(extra={})=>({device:'\\\\.\\DISPLAY1',adapter:nvidia.name,primary:true,width:1920,height:1080,hz:240,maxHz:240,...extra});
const desktop=(extra={})=>({laptop:false,checkedAt:'2026-11-12T12:00:00Z',displays:[display()],gpus:[nvidia],power:{ac:1,batteryFlag:128,saver:false},
  memory:[ddr4('Controller0-ChannelA-DIMM1','BANK 0',{configured:3200,speed:2133}),ddr4('Controller0-ChannelB-DIMM1','BANK 1',{configured:3200,speed:2133})],...extra});
const find=(raw,id)=>evaluateCheckup(raw,now).findings.find(f=>f.id===id);

test('a healthy desktop reports every applicable check as clear',()=>{
  const result=evaluateCheckup(desktop(),now);
  assert.deepEqual(result.findings.map(f=>[f.id,f.state]),[['refresh-rate','ok'],['display-adapter','ok'],['memory-speed','ok'],['memory-channels','ok'],['gpu-driver','ok']]);
  assert.equal(result.checkedAt,'2026-11-12T12:00:00Z');
});

test('a monitor below its highest refresh rate links to Windows display settings',()=>{
  const finding=find(desktop({displays:[display({hz:60,maxHz:144,width:2560,height:1440})]}),'refresh-rate');
  assert.equal(finding.state,'warn');
  assert.match(finding.title,/60 Hz/);
  assert.match(finding.detail,/144 Hz at 2560×1440/);
  assert.match(finding.detail,/16\.7 ms to 6\.9 ms/);
  assert.equal(finding.guide,'refresh-rate');
  assert.equal(guides.find(g=>g.id==='refresh-rate').uri,'ms-settings:display-advanced');
  // Fractional-rate rounding (59 vs 60) and small gaps are not problems.
  assert.equal(find(desktop({displays:[display({hz:59,maxHz:60})]}),'refresh-rate').state,'ok');
  assert.equal(find(desktop({displays:[display({hz:144,maxHz:150})]}),'refresh-rate').state,'ok');
  assert.equal(find(desktop({displays:[display({hz:1,maxHz:0})]}),'refresh-rate'),undefined);
  assert.match(find(desktop({displays:[display({hz:60,maxHz:60})]}),'refresh-rate').detail,/DisplayPort/);
});

test('the refresh check names the main display first when several are slow',()=>{
  const finding=find(desktop({displays:[display({primary:false,hz:60,maxHz:75,device:'\\\\.\\DISPLAY2'}),display({hz:60,maxHz:165})]}),'refresh-rate');
  assert.match(finding.title,/main display/);
  assert.match(finding.detail,/165 Hz/);
  assert.match(finding.detail,/1 other display is also below/);
});

test('a desktop monitor on integrated graphics is flagged; laptops are not',()=>{
  const igpu={name:'Intel(R) UHD Graphics 770',pnp:'PCI\\VEN_8086&DEV_4680',driverDate:'2026-01-01T00:00:00Z'};
  const raw=desktop({gpus:[igpu,nvidia],displays:[display({adapter:igpu.name})]});
  const finding=find(raw,'display-adapter');
  assert.equal(finding.state,'warn');
  assert.match(finding.detail,/Intel\(R\) UHD Graphics 770.*NVIDIA GeForce RTX 4070/);
  assert.equal(find({...raw,laptop:true},'display-adapter'),undefined);
  assert.equal(find(desktop({gpus:[igpu],displays:[display({adapter:igpu.name})]}),'display-adapter'),undefined);
});

test('GPU classification separates integrated and discrete adapters',()=>{
  const kind=(name,ven)=>gpuKind({name,pnp:ven?`PCI\\VEN_${ven}&DEV_0000`:''});
  assert.equal(kind('NVIDIA GeForce RTX 4070','10DE'),'discrete');
  assert.equal(kind('AMD Radeon RX 7800 XT','1002'),'discrete');
  assert.equal(kind('AMD Radeon(TM) Graphics','1002'),'integrated');
  assert.equal(kind('AMD Radeon 780M Graphics','1002'),'integrated');
  assert.equal(kind('AMD Radeon(TM) Vega 8 Graphics','1002'),'integrated');
  assert.equal(kind('Intel(R) Arc(TM) A770 Graphics','8086'),'discrete');
  assert.equal(kind('Intel(R) Arc(TM) B580 Graphics','8086'),'discrete');
  assert.equal(kind('Intel(R) Arc(TM) Graphics','8086'),'integrated');
  assert.equal(kind('Intel(R) Iris(R) Xe Graphics','8086'),'integrated');
  assert.equal(kind('Microsoft Basic Display Adapter','1414'),'basic');
  assert.equal(kind('Parsec Virtual Display Adapter','1AB8'),'unknown');
  assert.equal(kind('NVIDIA GeForce GTX 1060'),'discrete');
});

test('memory at its base speed is flagged on desktops, with a mixed-kit warning',()=>{
  // Matches a real snapshot: two different Corsair kits, all four sticks at 2133 MT/s.
  const raw=desktop({memory:[
    ddr4('Controller0-ChannelA-DIMM0','BANK 0',{capacityGB:8,part:'CMR16GX4M2A2666C16'}),ddr4('Controller0-ChannelA-DIMM1','BANK 0',{part:'CMW32GX4M2Z3600C18'}),
    ddr4('Controller0-ChannelB-DIMM0','BANK 1',{capacityGB:8,part:'CMR16GX4M2A2666C16'}),ddr4('Controller0-ChannelB-DIMM1','BANK 1',{part:'CMW32GX4M2Z3600C18'})]});
  const speed=find(raw,'memory-speed');
  assert.equal(speed.state,'warn');
  assert.match(speed.detail,/DDR4 memory runs at 2133 MT\/s/);
  assert.match(speed.detail,/XMP/);
  assert.match(speed.detail,/not all the same model/);
  assert.equal(find(raw,'memory-channels').state,'ok');
  assert.match(find(raw,'memory-channels').detail,/4 sticks across 2 channels/);
  assert.equal(find({...raw,laptop:true},'memory-speed'),undefined);
});

test('memory speed thresholds cover DDR5, half-rate reports, and below-rated memory',()=>{
  const ddr5=(configured,speed=4800)=>desktop({memory:[ddr4('DIMM 1','P0 CHANNEL A',{type:34,configured,speed}),ddr4('DIMM 1','P0 CHANNEL B',{type:34,configured,speed})]});
  assert.equal(find(ddr5(4800),'memory-speed').state,'warn');
  assert.equal(find(ddr5(6000),'memory-speed').state,'ok');
  assert.equal(find(ddr5(2400),'memory-speed').state,'warn','a 2400 MHz clock report is 4800 MT/s');
  const below=find(desktop({memory:[ddr4('ChannelA-DIMM0','BANK 0',{configured:2666,speed:3200}),ddr4('ChannelB-DIMM0','BANK 1',{configured:2666,speed:3200})]}),'memory-speed');
  assert.equal(below.state,'warn');
  assert.match(below.title,/below its rated speed/);
  assert.equal(find(desktop({memory:[ddr4('A','B',{formFactor:12})]}),'memory-speed'),undefined,'SO-DIMMs are skipped');
});

test('single sticks and same-channel installs are flagged; DDR5 subchannels are not',()=>{
  const single=find(desktop({memory:[ddr4('Controller0-ChannelA-DIMM1','BANK 0',{configured:3200})]}),'memory-channels');
  assert.equal(single.state,'warn');
  assert.match(single.title,/one memory stick/);
  const sameChannel=find(desktop({memory:[ddr4('Controller0-ChannelA-DIMM0','BANK 0',{configured:3200}),ddr4('Controller0-ChannelA-DIMM1','BANK 0',{configured:3200})]}),'memory-channels');
  assert.equal(sameChannel.state,'warn');
  assert.match(sameChannel.title,/wrong slots/);
  // Intel DDR5 reports dual-channel memory as ChannelA on two controllers.
  const ddr5=find(desktop({memory:[ddr4('Controller0-ChannelA-DIMM1','BANK 0',{type:34,configured:6000}),ddr4('Controller1-ChannelA-DIMM1','BANK 0',{type:34,configured:6000})]}),'memory-channels');
  assert.equal(ddr5.state,'ok');
  const unknown=find(desktop({memory:[ddr4('DIMM1','BANK 0'),ddr4('DIMM2','BANK 1')]}),'memory-channels');
  assert.equal(unknown.state,'ok');
  assert.match(unknown.detail,/did not report channel/);
  assert.equal(find(desktop({memory:[ddr4('A','B',{type:35})]}),'memory-channels'),undefined,'soldered LPDDR is skipped');
});

test('laptop power checks flag battery and battery saver only on battery-powered PCs',()=>{
  const laptop=power=>({...desktop(),laptop:true,power});
  assert.match(find(laptop({ac:0,batteryFlag:1,saver:false}),'power-source').title,/on battery/);
  assert.match(find(laptop({ac:1,batteryFlag:8,saver:true}),'power-source').title,/Battery saver/);
  assert.equal(find(laptop({ac:1,batteryFlag:8,saver:false}),'power-source').state,'ok');
  assert.equal(find(desktop(),'power-source'),undefined);
  assert.equal(find(laptop(null),'power-source'),undefined);
});

test('graphics driver checks catch a missing driver and old discrete drivers',()=>{
  const basic=find(desktop({gpus:[{name:'Microsoft Basic Display Adapter',pnp:'PCI\\VEN_10DE&DEV_2786',driverDate:'2006-06-21T00:00:00Z'}]}),'gpu-driver');
  assert.match(basic.title,/missing/);
  assert.equal(basic.guide,'updates');
  const old=find(desktop({gpus:[{...nvidia,driverDate:'2025-06-01T00:00:00Z'}]}),'gpu-driver');
  assert.equal(old.state,'warn');
  assert.match(old.detail,/June 2025/);
  assert.equal(find(desktop({gpus:[{...nvidia,driverDate:null}]}),'gpu-driver'),undefined);
  assert.equal(find(desktop({gpus:[{name:'Intel(R) UHD Graphics',pnp:'PCI\\VEN_8086&DEV_0000',driverDate:'2020-01-01T00:00:00Z'}]}),'gpu-driver'),undefined,'integrated drivers are left to the PC maker');
});

test('checkup tolerates missing sections and orders problems first',()=>{
  assert.deepEqual(evaluateCheckup(null),{findings:[],checkedAt:null});
  assert.deepEqual(evaluateCheckup({},now).findings,[]);
  assert.deepEqual(evaluateCheckup({displays:null,memory:null,gpus:null,power:null},now).findings,[]);
  const result=evaluateCheckup(desktop({displays:[display({hz:60,maxHz:144})],memory:[ddr4('Controller0-ChannelA-DIMM0','BANK 0')]}),now);
  const states=result.findings.map(f=>f.state);
  assert.deepEqual(states,[...states].sort((a,b)=>(a==='warn'?0:1)-(b==='warn'?0:1)));
  for(const f of result.findings.filter(f=>f.guide)) assert.ok(guides.some(g=>g.id===f.guide&&g.uri.startsWith('ms-settings:')),`${f.guide} must be an existing settings guide`);
});

test('the checkup script is read-only',()=>{
  assert.doesNotMatch(checkupScript,/ChangeDisplaySettings|Set-ItemProperty|New-ItemProperty|Remove-Item|Set-Cim|Invoke-Cim|powercfg|SetSystemPowerState|bcdedit|reg\.exe/i);
});

test('the checkup script compiles and reads this PC without changes',{skip:process.platform!=='win32'},async()=>{
  const parse=await runPowerShell(`$tokens=$null; $errors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput(${psQuote(checkupScript)},[ref]$tokens,[ref]$errors); ConvertTo-Json -InputObject @($errors | ForEach-Object { $_.Message }) -Compress`);
  assert.deepEqual(parse,[]);
  const raw=await runPowerShell(checkupScript,60000);
  assert.equal(typeof raw.laptop,'boolean');
  // Headless CI runners may expose no usable display; a section failure must stay isolated.
  assert.ok(raw.displays===null||Array.isArray(raw.displays));
  for(const d of raw.displays||[]) { assert.ok(Number.isInteger(d.hz)); assert.ok(d.maxHz>=d.hz||d.hz<=1); }
  assert.ok(Array.isArray(evaluateCheckup(raw).findings));
});

// --- Mouse polling test ------------------------------------------------------------

const steady=(hz,ms,start=0,jitter=0)=>Array.from({length:Math.floor(ms*hz/1000)},(_,i)=>start+i*1000/hz+(jitter?((i*7919)%11-5)/5*jitter:0));

test('polling rates are recognised at common mouse settings',()=>{
  for(const hz of [125,250,500,1000,2000]) {
    const result=summarizePolling(steady(hz,4000));
    assert.equal(result.enough,true);
    assert.equal(result.nearest,hz);
    assert.ok(Math.abs(result.rate-hz)/hz<0.05,`${hz} Hz measured as ${result.rate}`);
  }
  assert.ok(Math.abs(summarizePolling(steady(1000,4000)).interval-1)<0.05);
});

test('pauses and slow movement do not drag the measured rate down',()=>{
  // Fast 1000 Hz bursts, a full stop, then slow movement at about 200 reports per second.
  const times=[...steady(1000,1500),...steady(200,1000,2500),...steady(1000,1200,4000,0.2)];
  assert.equal(summarizePolling(times).nearest,1000);
});

test('too little movement asks for a retry instead of guessing',()=>{
  assert.equal(summarizePolling(steady(1000,150)).enough,false);
  assert.equal(summarizePolling([]).rate,null);
  assert.equal(summarizePolling([1,2,NaN,Infinity]).enough,false);
  // Enough events, but crammed into too short a span to measure.
  assert.equal(summarizePolling(steady(8000,300)).enough,false);
});

test('rates between standard settings are reported without a closest setting',()=>{
  const result=summarizePolling(steady(700,4000));
  assert.equal(result.enough,true);
  assert.equal(result.nearest,null);
  assert.ok(Math.abs(result.rate-700)<20);
});
