import { APP_VERSION } from '../../shared/version.mjs';
// Manual browser fixture; no Windows writes and never packaged.
import { tweaks } from '../../shared/catalog.mjs';
import { evaluateCheckup } from '../../shared/checkup.mjs';
// Simulated findings: a 144 Hz monitor left at 60 Hz and DDR4 at its base speed.
const checkup=evaluateCheckup({laptop:false,checkedAt:new Date().toISOString(),
  displays:[{device:'\\\\.\\DISPLAY1',adapter:'NVIDIA GeForce RTX 4070',primary:true,width:2560,height:1440,hz:60,maxHz:144}],
  gpus:[{name:'NVIDIA GeForce RTX 4070',pnp:'PCI\\VEN_10DE&DEV_2786',driverDate:new Date(Date.now()-40*86400000).toISOString()},{name:'AMD Radeon(TM) Graphics',pnp:'PCI\\VEN_1002&DEV_164E',driverDate:null}],
  memory:[{capacityGB:16,speed:2133,configured:2133,type:26,formFactor:8,locator:'DIMM 1',bank:'P0 CHANNEL A',part:'Fixture'},{capacityGB:16,speed:2133,configured:2133,type:26,formFactor:8,locator:'DIMM 1',bank:'P0 CHANNEL B',part:'Fixture'}],
  power:{ac:1,batteryFlag:128,saver:false}});
const ok=(data:unknown)=>Promise.resolve({ok:true as const,data});
const journal:any[]=[];
const applied=new Map<string,Record<string,unknown>>();
let apps=[{token:'fixture-chrome',name:'Google Chrome',processCount:14,memoryMB:1640},{token:'fixture-discord',name:'Discord',processCount:5,memoryMB:380}];
const system={os:'Windows 11 Pro · UI test fixture',build:'22631',cpu:'AMD Ryzen 7 7800X3D',cores:8,threads:16,memoryTotal:32,memoryFree:24,diskTotal:1000,diskFree:650,laptop:false,administrator:true,gpus:[{Name:'NVIDIA GeForce RTX 4070',DriverVersion:'Test',CurrentRefreshRate:240},{Name:'AMD Radeon Graphics',DriverVersion:'Test',CurrentRefreshRate:0}],adapters:[],powerPlan:'Balanced',scannedAt:new Date().toISOString(),appVersion:APP_VERSION};
window.rankly={
 sessionApps:()=>ok(apps),closeApps:(tokens:string[])=>{const count=apps.filter(a=>tokens.includes(a.token)).reduce((n,a)=>n+a.processCount,0);apps=apps.filter(a=>!tokens.includes(a.token));return ok({closedProcesses:count,failedProcesses:0,skippedProcesses:0});},
 status:()=>ok({system,checkup,states:Object.fromEntries(tweaks.map(t=>[t.id,{available:true,enabled:false,current:[],...applied.get(t.id)}])),history:structuredClone(journal)}),
 restore:(id:string)=>{const entry=journal.find(e=>e.id===id);if(entry){for(const tweakId of entry.ids)applied.delete(tweakId);entry.status='restored';}return ok(entry);},
 apply:(ids:string[])=>{for(const id of ids)applied.set(id,id==='memory-integrity-off'?{pending:true,label:'Restart required',reason:'Change saved. Memory Integrity is still running until restart.'}:{enabled:true});const entry={id:'fixture-'+journal.length,date:new Date().toISOString(),ids,names:ids.map(id=>tweaks.find(t=>t.id===id)!.name),status:'applied'};journal.push(entry);return ok({entry,message:'Tweaks applied and backed up.'});},
 openSettings:()=>ok(undefined),openSource:()=>ok(undefined),exportReport:()=>ok(null),windowControl:()=>ok(undefined),
 // Simulates a newer published release so the update notice can be reviewed.
 checkUpdate:()=>ok({current:APP_VERSION,latest:'1.1.0',newer:true,url:'https://github.com/Ranklywin/rankly-tweaks/releases/tag/v1.1.0',publishedAt:new Date().toISOString(),checkedAt:new Date().toISOString()}),installUpdate:()=>ok(undefined),
 network:()=>ok({target:'Fixture',testedAt:new Date().toISOString(),samples:[]})
};
await import('../../src/main.tsx');
