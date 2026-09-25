// Intel describes these as access-point compatibility workarounds, not universal
// latency optimizations. Resolve values from the driver's labelled enumeration.
export const wifiControls=Object.freeze({
  'wifi-smps':Object.freeze({keyword:'MIMOPowerSaveMode',target:'No SMPS'}),
  'wifi-uapsd':Object.freeze({keyword:'uAPSD',target:'Disabled'}),
});
const scalar=value=>typeof value==='string'&&/^\d{1,10}$/.test(value)&&Number(value)<=4294967295;
export const isIntelWifiId=value=>typeof value==='string'&&value.length<=512&&/^PCI\\VEN_8086&DEV_[0-9A-F]{4}(?:&|\\)/i.test(value)&&/^[a-z0-9_&\\.\-]+$/i.test(value);
export const wifiLabel=value=>typeof value==='string'?value.trim().toLowerCase():'';
export const validWifiValue=o=>Array.isArray(o?.value)&&o.value.length===1&&scalar(o.value[0])&&typeof o.label==='string'&&o.label.trim().length>0&&o.label.length<=128&&!/[\x00-\x1f]/.test(o.label);
export function wifiTarget(setting,property) {
  if(!property||property.keyword!==setting.keyword||!isIntelWifiId(property.deviceId)||property.available!==true||property.up!==true||!validWifiValue(property)) return null;
  const choices=property.choices;
  if(!Array.isArray(choices)||choices.length<2||choices.length>16||choices.some(c=>!c||!scalar(c.value)||!validWifiValue({value:[c.value],label:c.label}))) return null;
  if(new Set(choices.map(c=>c.value)).size!==choices.length||new Set(choices.map(c=>wifiLabel(c.label))).size!==choices.length) return null;
  if(!choices.some(c=>c.value===property.value[0]&&wifiLabel(c.label)===wifiLabel(property.label))) return null;
  return choices.find(c=>wifiLabel(c.label)===wifiLabel(setting.target))||null;
}
