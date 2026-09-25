import { APP_VERSION } from '../../shared/version.mjs';
// Manual browser fixture; no Windows writes and never packaged.
import { tweaks } from '../../shared/catalog.mjs';
const ok=(data:unknown)=>Promise.resolve({ok:true as const,data});
const journal:any[]=[];
const applied=new Map<string,Record<string,unknown>>();
let apps=[{token:'fixture-chrome',name:'Google Chrome',processCount:14,memoryMB:1640},{token:'fixture-discord',name:'Discord',processCount:5,memoryMB:380}];
const system={os:'Windows 11 Pro · UI test fixture',build:'22631',cpu:'AMD Ryzen 7 7800X3D',cores:8,threads:16,memoryTotal:32,memoryFree:24,diskTotal:1000,diskFree:650,laptop:false,administrator:true,gpus:[{Name:'NVIDIA GeForce RTX 4070',DriverVersion:'Test',CurrentRefreshRate:240},{Name:'AMD Radeon Graphics',DriverVersion:'Test',CurrentRefreshRate:0}],adapters:[],powerPlan:'Balanced',scannedAt:new Date().toISOString(),appVersion:APP_VERSION};
window.rankly={
 sessionApps:()=>ok(apps),closeApps:(tokens:string[])=>{const count=apps.filter(a=>tokens.includes(a.token)).reduce((n,a)=>n+a.processCount,0);apps=apps.filter(a=>!tokens.includes(a.token));return ok({closedProcesses:count,failedProcesses:0,skippedProcesses:0});},
 status:()=>ok({system,states:Object.fromEntries(tweaks.map(t=>[t.id,{available:true,enabled:false,current:[],...applied.get(t.id)}])),history:structuredClone(journal)}),
 restore:(id:string)=>{const entry=journal.find(e=>e.id===id);if(entry){for(const tweakId of entry.ids)applied.delete(tweakId);entry.status='restored';}return ok(entry);},
 apply:(ids:string[])=>{for(const id of ids)applied.set(id,id==='memory-integrity-off'?{pending:true,label:'Restart required',reason:'Change saved. Memory Integrity is still running until restart.'}:{enabled:true});const entry={id:'fixture-'+journal.length,date:new Date().toISOString(),ids,names:ids.map(id=>tweaks.find(t=>t.id===id)!.name),status:'applied'};journal.push(entry);return ok({entry,message:'Tweaks applied and backed up.'});},
 openSettings:()=>ok(undefined),openSource:()=>ok(undefined),exportReport:()=>ok(null),windowControl:()=>ok(undefined),
 network:()=>ok({target:'Fixture',testedAt:new Date().toISOString(),samples:[]})
};
await import('../../src/main.tsx');
