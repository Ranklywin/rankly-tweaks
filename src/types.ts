export interface SystemInfo {
  os: string; build: string; cpu: string; cores: number; threads: number;
  memoryTotal: number; memoryFree: number; diskTotal: number; diskFree: number;
  laptop: boolean; administrator: boolean; gpus: {Name: string; DriverVersion: string; CurrentRefreshRate: number}[];
  adapters: {Name: string; InterfaceDescription: string; LinkSpeed: string}[];
  powerPlan: string; scannedAt: string; appVersion: string;
}
export interface TweakState { pending?:boolean; label?:string; enabled:boolean; available:boolean; reason?:string; current:{exists?:boolean;value?:unknown}[] }
export interface HistoryEntry { id: string; date: string; ids: string[]; names: string[]; status: string; restorable?:boolean; restoredAt?: string; error?: string }
export interface Status { system: SystemInfo|null; states: Record<string,TweakState>; history?: HistoryEntry[]; errors?: string[] }
export interface NetworkResult { target: string; testedAt: string; samples: (number|null)[] }
export interface SessionApp { token:string; name:string; processCount:number; memoryMB:number }
export interface CloseAppsResult { closedProcesses:number; skippedProcesses:number; failedProcesses:number }
export type NativeResult<T> = {ok:true; data:T} | {ok:false; error:string};
export interface NativeBridge {
  sessionApps():Promise<NativeResult<SessionApp[]>>;
  closeApps(tokens:string[]):Promise<NativeResult<CloseAppsResult>>;
  status():Promise<NativeResult<Status>>;
  apply(ids:string[]):Promise<NativeResult<unknown>>;
  restore(id:string):Promise<NativeResult<unknown>>;
  network(target:string):Promise<NativeResult<NetworkResult>>;
  openSettings(id:string):Promise<NativeResult<void>>;
  openSource(id:string):Promise<NativeResult<void>>;
  exportReport():Promise<NativeResult<string|null>>;
  windowControl(action:string):Promise<NativeResult<void>>;
}
declare global { interface Window { rankly?: NativeBridge } }
