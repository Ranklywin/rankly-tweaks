import { securityAvailability } from './security-settings.mjs';
import { equalServiceValue, validServiceValue } from './aggressive.mjs';
import { recoveryTweaks } from './catalog.mjs';
import { gamePreferenceRecovery, isGamePreferenceOperation } from './game-preferences.mjs';
import { keyboardAvailability, validShortcutValue } from './keyboard-settings.mjs';
import { wifiTarget, wifiLabel, validWifiValue, isIntelWifiId } from './wifi-settings.mjs';

export const isGuid=value=>typeof value==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export const powerKey=o=>`${o.scheme}/${o.subgroup}/${o.setting}`.toLowerCase();
export function operationKey(o) {
  if(o.type==='wifi-property') return `wifi-property/${String(o.adapter).toLowerCase()}/${String(o.deviceId).toUpperCase()}/${o.keyword}`;
  if(o.type==='keyboard-shortcut') return `keyboard-shortcut/${o.name}`;
  if(o.type==='service') return `service/${o.name}`;
  if(o.type==='power') return 'power';
  if(o.type==='power-setting') return `power-setting/${powerKey(o)}`;
  if(o.type==='network') return `network/${String(o.adapter).toLowerCase()}/${o.keyword}`;
  if(o.type==='registry') return `registry/${o.path}/${o.name}`;
  throw new Error('Unknown setting type.');
}

export function operationsFor(selected,context={}) {
  const scheme=selected.find(t=>t.power)?.power||context.scheme;
  return selected.flatMap(t=>{
    if(t.wifiSetting) {
      const properties=context.wifiProperties||[];
      return properties.flatMap(p=>{
        const target=wifiTarget(t.wifiSetting,p);
        if(!target||!isGuid(p.adapter)||properties.filter(other=>String(other.adapter).toLowerCase()===p.adapter.toLowerCase()&&other.keyword===p.keyword).length!==1) return [];
        return [{type:'wifi-property',adapter:p.adapter,deviceId:p.deviceId,keyword:p.keyword,value:[target.value],label:target.label,requireUp:true}];
      });
    }
    if(t.keyboardShortcuts) return keyboardAvailability(context)?[]:t.keyboardShortcuts.map(name=>({type:'keyboard-shortcut',name,value:0}));
    if(t.services) return t.services.filter(name=>context.services?.some(s=>s.name===name&&s.available)).map(name=>({type:'service',name,value:{startup:4,running:false}}));
    if(t.power) return [{type:'power',value:t.power}];
    if(t.powerSettings) {
      if(!isGuid(scheme)) throw new Error('Read the active power plan before choosing power controls.');
      const supported=t.powerSettings.map(s=>({type:'power-setting',scheme,...s})).filter(o=>context.powerValues?.some(v=>powerKey(v)===powerKey(o)&&v.available));
      return t.requireAllPowerSettings&&supported.length!==t.powerSettings.length?[]:supported;
    }
    if(t.networkSettings) {
      const properties=context.networkProperties||[];
      const adapters=[...new Set(properties.map(p=>p.adapter))];
      return adapters.flatMap(adapter=>{
        const supported=s=>properties.find(p=>p.adapter===adapter&&p.keyword===s.keyword&&s.value.every(v=>p.validValues?.includes(v)));
        if(t.networkSettings.some(s=>s.required&&!supported(s))) return [];
        return t.networkSettings.filter(supported).map(s=>({type:'network',adapter,keyword:s.keyword,value:s.value}));
      });
    }
    return (t.operations||[]).map(o=>({type:'registry',...o}));
  });
}

export function unavailableReason(t,context) {
  const securityReason=securityAvailability(t,context);if(securityReason)return securityReason;
  if(t.minBuild&&(!Number.isInteger(context.build)||context.build<t.minBuild)) return t.minBuild>=22621?'Requires Windows 11 22H2 or newer':t.minBuild>=22000?'Requires Windows 11':'Requires a newer Windows version';
  if(t.keyboardShortcuts) {const reason=keyboardAvailability(context);if(reason)return reason;}
  if(t.wifiSetting&&!operationsFor([t],context).length) return 'No connected Intel Wi-Fi adapter with verified driver choices (English labels required)';
  if(t.proOnly&&!/^(Professional|Enterprise|Education|IoTEnterprise)/i.test(context.edition||'')) return 'Requires Windows Pro, Enterprise, or Education';
  if(t.hardware==='browser'&&!context.browser) return 'Edge or Chrome was not detected';
  if(t.hardware==='onedrive'&&!context.onedrive) return 'OneDrive was not detected';
  if(t.services&&!operationsFor([t],context).length) return 'No available optional services';
  if(t.hardware==='hags'&&!context.hags) return 'GPU scheduling support was not detected';
  if(t.hardware==='wifi'&&!context.wifi) return 'No Wi-Fi adapter detected';
  if(t.hardware==='hdd'&&!context.hdd) return 'No mechanical hard drive detected';
  if(t.hardware==='nvme'&&!context.nvme) return 'No active Microsoft NVMe storage controller detected';
  if(t.hardware==='ahci'&&!context.ahci) return 'No active Microsoft SATA AHCI controller detected';
  if(t.hardware==='non-x3d'&&/X3D/i.test(context.cpu||'')) return 'Preserves Ryzen X3D core scheduling';
  if(t.power&&!context.plans?.includes(t.power)) return 'Power plan unavailable on this PC';
  if(!operationsFor([t],context).length) return t.networkSettings?'No supported active Ethernet adapter':'Not exposed by your hardware';
  return '';
}

export function materializeOperations(operations,before) {
  if(operations.length!==before.length) throw new Error('Incomplete settings snapshot.');
  return operations.map((o,i)=>{
    if(operationKey(o)!==operationKey(before[i])) throw new Error('Settings snapshot does not match the requested changes.');
    if(o.type==='wifi-property') {
      if(before[i].available!==true||before[i].up!==true||!validWifiValue(before[i])) throw new Error('The Wi-Fi adapter or its restorable setting is no longer available. Scan again.');
      const choice=before[i].choices?.find(c=>c.value===o.value[0]&&wifiLabel(c.label)===wifiLabel(o.label));
      if(!choice) throw new Error('Wi-Fi driver choices changed. Scan again before applying.');
      return {...o};
    }
    if(o.type==='keyboard-shortcut') {
      if(before[i].available!==true||before[i].active!==false||!validShortcutValue(before[i].value)) throw new Error('Keyboard shortcut support changed or an accessibility feature is active. Scan again before applying.');
      return {...o};
    }
    if(o.type==='service') {if(!validServiceValue(before[i].value))throw new Error('Unsupported service snapshot.');return {...o,value:{...o.value,delayed:structuredClone(before[i].value.delayed)}};}
    if(o.type!=='registry') {if(before[i].available===false) throw new Error('A selected device or power setting is no longer available.');return {...o};}
    const {transform,...result}=o;
    if(transform) {
      if(transform!=='semicolon') throw new Error('Unknown preference transformation.');
      if(before[i].exists&&before[i].kind!=='String') throw new Error('The existing graphics preference is not a supported string.');
      const previous=before[i].exists?before[i].value:'';
      if(typeof previous!=='string') throw new Error('The existing graphics preference could not be read.');
      const changes=String(o.value).split(';').filter(Boolean);
      const keys=new Set(changes.map(v=>v.split('=')[0]));
      const kept=previous.split(';').filter(v=>v&&!keys.has(v.split('=')[0]));
      result.value=[...kept,...changes].join(';')+';';
    }
    return {...result,exists:true};
  });
}

export function equalOperations(expected,actual) {
  return Array.isArray(actual)&&expected.length===actual.length&&expected.every((e,i)=>{
    const a=actual[i];
    if(!a||operationKey(e)!==operationKey(a)||a.available===false) return false;
    if(e.type==='wifi-property') return validWifiValue(e)&&validWifiValue(a)&&e.value[0]===a.value[0]&&wifiLabel(e.label)===wifiLabel(a.label);
    if(e.type==='service') return equalServiceValue(e.value,a.value);
    if(e.type==='power') return typeof a.value==='string'&&e.value.toLowerCase()===a.value.toLowerCase();
    if(e.type!=='registry') return JSON.stringify(e.value)===JSON.stringify(a.value);
    if(e.exists===false) return a.exists===false;
    if(!a.exists||a.kind!==e.kind) return false;
    if(e.transform==='semicolon') {
      const tokens=new Map(String(a.value).split(';').filter(Boolean).map(token=>[token.split('=')[0],token]));
      return String(e.value).split(';').filter(Boolean).every(token=>tokens.get(token.split('=')[0])===token);
    }
    return JSON.stringify(e.value)===JSON.stringify(a.value);
  });
}

export function allowedOperation(o,definitions=[...recoveryTweaks,gamePreferenceRecovery]) {
  if(o.type==='wifi-property') return isGuid(o.adapter)&&isIntelWifiId(o.deviceId)&&definitions.some(t=>t.wifiSetting?.keyword===o.keyword);
  if(o.type==='keyboard-shortcut') return definitions.some(t=>t.keyboardShortcuts?.includes(o.name));
  if(o.type==='service') return definitions.some(t=>t.services?.includes(o.name));
  if(o.type==='power') return isGuid(o.value)&&definitions.some(t=>t.power);
  if(o.type==='power-setting') return isGuid(o.scheme)&&definitions.some(t=>t.powerSettings?.some(s=>s.subgroup===o.subgroup&&s.setting===o.setting));
  if(o.type==='network') return isGuid(o.adapter)&&definitions.some(t=>t.networkSettings?.some(s=>s.keyword===o.keyword));
  if(o.type==='registry') return definitions.some(t=>t.gamePreference ? isGamePreferenceOperation(o)&&(!t.gamePath||o.name===t.gamePath) : t.operations?.some(s=>s.path===o.path&&s.name===o.name));
  return false;
}

export function validateBackupOperations(entry,definitions) {
  if(!entry.before.length||entry.before.length!==entry.after.length) throw new Error('The backup is incomplete.');
  const keys=entry.before.map(operationKey);
  if(new Set(keys).size!==keys.length) throw new Error('The backup contains duplicate settings.');
  for(let i=0;i<entry.before.length;i++) {
    if(keys[i]!==operationKey(entry.after[i])||!allowedOperation(entry.before[i],definitions)||!allowedOperation(entry.after[i],definitions)) throw new Error('The backup does not match its original tweak definitions.');
  }
  if(definitions.some(t=>!entry.before.some(o=>allowedOperation(o,[t])))) throw new Error('The backup is missing a selected tweak.');
  for(const t of definitions) {
    if(t.wifiSetting) {
      for(const original of entry.before.filter(o=>allowedOperation(o,[t]))) {
        const changed=entry.after.find(o=>operationKey(o)===operationKey(original));
        const target=wifiTarget(t.wifiSetting,original);
        if(!target||Object.hasOwn(original,'requireUp')||!validWifiValue(changed)||changed.value[0]!==target.value||wifiLabel(changed.label)!==wifiLabel(t.wifiSetting.target)||changed.requireUp!==true||changed.transform) throw new Error('The Wi-Fi backup contains an unexpected change.');
      }
    }
    if(t.keyboardShortcuts) {
      const original=entry.before.filter(o=>allowedOperation(o,[t]));
      const changed=entry.after.filter(o=>allowedOperation(o,[t]));
      if(original.length!==t.keyboardShortcuts.length||t.keyboardShortcuts.some(name=>!original.some(o=>o.name===name))) throw new Error('The backup is missing part of the keyboard shortcut control.');
      if(original.some(o=>o.available!==true||o.active!==false||!validShortcutValue(o.value))||changed.some(o=>o.value!==0||o.transform)) throw new Error('The keyboard shortcut backup contains an unexpected change.');
    }
    if(t.requireAllPowerSettings) {
      const settings=entry.before.filter(o=>allowedOperation(o,[t]));
      if(settings.length!==t.powerSettings.length||new Set(settings.map(o=>o.scheme.toLowerCase())).size!==1||t.powerSettings.some(s=>!settings.some(o=>o.subgroup===s.subgroup&&o.setting===s.setting))) throw new Error('The backup is missing part of a power control.');
    }
    if(t.operations?.some(s=>!entry.before.some(o=>o.type==='registry'&&o.path===s.path&&o.name===s.name))) throw new Error('The backup is missing part of a grouped tweak.');
    if(t.hardware==='memory-integrity') {
      const expected=materializeOperations(operationsFor([t]),entry.before.filter(o=>allowedOperation(o,[t])));
      if(!equalOperations(expected,entry.after.filter(o=>allowedOperation(o,[t])))) throw new Error('The Memory Integrity backup contains an unexpected change.');
    }
    if(t.services) {
      for(const o of entry.after.filter(o=>o.type==='service'&&t.services.includes(o.name))) {const original=entry.before.find(b=>operationKey(b)===operationKey(o));if(!validServiceValue(original?.value)||!equalServiceValue({...original.value,startup:4,running:false},o.value))throw new Error('The service backup contains an unexpected change.');}
    }
    if(t.gamePreference) {
      if(definitions.length!==1||entry.before.length!==1||entry.gamePath!==t.gamePath) throw new Error('The game preference backup does not match its saved executable.');
      const expected=materializeOperations(operationsFor([t]),entry.before);
      if(!equalOperations(expected,entry.after)||entry.after.some(o=>o.transform)) throw new Error('The game preference backup contains an unexpected change.');
    }
  }
}
