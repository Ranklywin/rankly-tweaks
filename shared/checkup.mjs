// Turns a read-only hardware snapshot into setup findings. Each check only
// reports a problem when Windows exposes enough information to support it;
// otherwise it stays quiet rather than guessing.

const DDR4=26, DDR5=34, DIMM=8;
const LPDDR=new Set([27,28,29,30,35]);
const DAY=24*60*60*1000;
const month=date=>new Date(date).toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});

/** Classifies a graphics adapter from its PCI vendor and Windows name. */
export function gpuKind(gpu) {
  const name=String(gpu?.name||gpu?.adapter||''), pnp=String(gpu?.pnp||'');
  if(/Microsoft Basic Display Adapter/i.test(name)) return 'basic';
  const vendor=/VEN_([0-9A-F]{4})/i.exec(pnp)?.[1]?.toUpperCase()||(/NVIDIA/i.test(name)?'10DE':/AMD|Radeon/i.test(name)?'1002':/Intel/i.test(name)?'8086':'');
  if(vendor==='10DE') return 'discrete';
  if(vendor==='1002') return /Radeon(?:\(TM\))?\s+(?:Graphics\b|Vega\b|\d{3,4}M\b)/i.test(name)?'integrated':'discrete';
  if(vendor==='8086') return /Arc(?:\(TM\))?\s+[AB]\d{3}/i.test(name)?'discrete':'integrated';
  return 'unknown';
}

// DDR speeds are normally reported in MT/s; a few firmwares report the clock.
function dataRate(module) {
  const value=module.configured||0;
  if(module.type===DDR4&&value>0&&value<1600) return value*2;
  if(module.type===DDR5&&value>0&&value<3200) return value*2;
  return value;
}
function channelKey(module) {
  const text=`${module.locator||''} ${module.bank||''}`;
  const channel=/channel\s*-?\s*([a-h])(?![a-z])/i.exec(text)?.[1];
  if(!channel) return null;
  const controller=/controller\s*(\d+)/i.exec(text)?.[1]??/\bP(\d+)\s+channel/i.exec(text)?.[1]??'';
  return `${controller}:${channel.toUpperCase()}`;
}

function refreshFinding(displays) {
  const usable=(displays||[]).filter(d=>d.hz>1&&d.maxHz>1);
  if(!usable.length) return null;
  const label=(d,i)=>d.primary?'Your main display':usable.length>1?`Display ${i+1}`:'Your display';
  const slow=usable.map((d,i)=>({d,label:label(d,i)})).filter(({d})=>d.maxHz-d.hz>=10&&d.maxHz>=d.hz*1.1);
  if(slow.length) {
    const {d,label:name}=slow.find(s=>s.d.primary)||slow[0];
    return {id:'refresh-rate',state:'warn',icon:'Monitor',title:`${name} is running at ${d.hz} Hz`,
      detail:`It supports ${d.maxHz} Hz at ${d.width}×${d.height}. Choosing ${d.maxHz} Hz cuts the time between frames from ${(1000/d.hz).toFixed(1)} ms to ${(1000/d.maxHz).toFixed(1)} ms, so motion looks smoother and responds sooner. Windows asks you to keep the new rate and switches back on its own if the screen goes blank.${slow.length>1?` ${slow.length-1} other display${slow.length>2?'s are':' is'} also below its highest rate.`:''}`,
      guide:'refresh-rate',action:'Open display settings'};
  }
  const main=usable.find(d=>d.primary)||usable[0];
  return {id:'refresh-rate',state:'ok',icon:'Monitor',title:`Displays at their highest refresh rate`,
    detail:`${main.primary?'Main display':'Display'}: ${main.hz} Hz at ${main.width}×${main.height}.${main.maxHz<=75?' If your monitor is advertised as faster, use DisplayPort or the cable that came with it, then check again.':''}`};
}

function adapterFinding(raw) {
  if(raw.laptop||!raw.displays?.length||!raw.gpus?.length) return null;
  const discrete=raw.gpus.filter(g=>gpuKind(g)==='discrete');
  const primary=raw.displays.find(d=>d.primary);
  if(!discrete.length||!primary) return null;
  const driving=raw.gpus.find(g=>g.name.toLowerCase()===String(primary.adapter).toLowerCase());
  const kind=gpuKind(driving||{name:primary.adapter});
  if(kind==='integrated') return {id:'display-adapter',state:'warn',icon:'Monitor',title:'Monitor plugged into the motherboard',
    detail:`Your main display runs from ${primary.adapter}, but ${discrete[0].name} is installed. Many games then render on the slower integrated graphics or copy every frame across, costing FPS and adding delay. Move the display cable to a port on the graphics card, usually lower on the back of the PC.`};
  if(kind==='discrete') return {id:'display-adapter',state:'ok',icon:'Monitor',title:'Monitor connected to your graphics card',detail:`Main display runs from ${primary.adapter}.`};
  return null;
}

function memorySpeedFinding(raw) {
  if(raw.laptop) return null;
  const modules=(raw.memory||[]).filter(m=>m.capacityGB>0&&m.formFactor===DIMM&&[DDR4,DDR5].includes(m.type)&&m.configured>0);
  if(!modules.length) return null;
  const type=modules[0].type===DDR5?'DDR5':'DDR4';
  const rate=Math.min(...modules.map(dataRate));
  const rated=Math.max(...modules.map(m=>m.speed||0));
  const mixed=new Set(modules.map(m=>m.part||'').filter(Boolean)).size>1;
  const mixedNote=mixed?' Your sticks are not all the same model, so test stability after enabling it, or use a matched kit.':'';
  const atBase=(type==='DDR4'&&rate<=2400)||(type==='DDR5'&&rate<=4800);
  if(atBase) return {id:'memory-speed',state:'warn',icon:'MemoryStick',title:'Memory is running at its base speed',
    detail:`Your ${type} memory runs at ${rate} MT/s, the standard fallback speed. Most gaming kits are rated faster but only reach it when XMP (Intel) or DOCP/EXPO (AMD) is turned on in the BIOS. Faster memory mainly raises FPS and 1% lows in CPU-limited games. Check your kit's rated speed and motherboard support first.${mixedNote}`};
  if(rated>rate*1.05) return {id:'memory-speed',state:'warn',icon:'MemoryStick',title:'Memory is running below its rated speed',
    detail:`Your ${type} memory runs at ${rate} MT/s, but reports support for ${rated} MT/s. Check the memory settings in your BIOS. Your CPU or motherboard may also limit the speed.${mixedNote}`};
  return {id:'memory-speed',state:'ok',icon:'MemoryStick',title:`Memory running at ${rate} MT/s`,detail:`${modules.length} ${type} ${modules.length===1?'stick':'sticks'} above the base speed.`};
}

function memoryChannelFinding(raw) {
  const modules=(raw.memory||[]).filter(m=>m.capacityGB>0);
  if(!modules.length||modules.some(m=>LPDDR.has(m.type))) return null;
  if(modules.length===1) return {id:'memory-channels',state:'warn',icon:'MemoryStick',title:'Only one memory stick installed',
    detail:`With one stick, the CPU uses a single memory channel. ${raw.laptop?'If your laptop has a free slot, a':'A'} matching second stick in the correct slot enables dual-channel mode, which often raises FPS and 1% lows in CPU-heavy games, and helps integrated graphics even more.`};
  const keys=modules.map(channelKey);
  if(!raw.laptop&&keys.every(Boolean)&&new Set(keys).size===1) return {id:'memory-channels',state:'warn',icon:'MemoryStick',title:'Memory may be in the wrong slots',
    detail:`Windows reports all ${modules.length} sticks on the same memory channel, so they may be running in single-channel mode. Check your motherboard manual for the dual-channel slots (often A2 and B2).`};
  const channels=keys.every(Boolean)?new Set(keys).size:0;
  return {id:'memory-channels',state:'ok',icon:'MemoryStick',title:channels>1?'Memory is using multiple channels':`${modules.length} memory sticks installed`,detail:channels>1?`${modules.length} sticks across ${channels} channels.`:'Windows did not report channel details.'};
}

function powerFinding(raw) {
  const battery=raw.laptop||(raw.power&&![128,255].includes(raw.power.batteryFlag));
  if(!battery||!raw.power) return null;
  if(raw.power.ac===0) return {id:'power-source',state:'warn',icon:'PlugZap',title:'Your laptop is running on battery',
    detail:'Windows and most laptops lower CPU and GPU power on battery. Plug in before playing for full performance.'};
  if(raw.power.saver) return {id:'power-source',state:'warn',icon:'PlugZap',title:'Battery saver is on',
    detail:'Battery saver limits background work and can lower performance. Plug in or turn it off in Settings → System → Power & battery.'};
  if(raw.power.ac===1) return {id:'power-source',state:'ok',icon:'PlugZap',title:'Plugged in',detail:'Your laptop is on AC power.'};
  return null;
}

function driverFinding(raw,now) {
  const gpus=raw.gpus||[];
  const basic=gpus.find(g=>gpuKind(g)==='basic');
  if(basic) return {id:'gpu-driver',state:'warn',icon:'RefreshCw',title:'Graphics driver is missing',
    detail:'Windows is using its basic display driver, which cannot run games properly. Install the driver for your graphics card from NVIDIA, AMD, or Intel.',guide:'updates',action:'Open Windows Update'};
  const discrete=gpus.filter(g=>gpuKind(g)==='discrete'&&Number.isFinite(Date.parse(g.driverDate)));
  if(!discrete.length) return null;
  const oldest=discrete.reduce((a,b)=>Date.parse(a.driverDate)<=Date.parse(b.driverDate)?a:b);
  if(now-Date.parse(oldest.driverDate)>365*DAY) return {id:'gpu-driver',state:'warn',icon:'RefreshCw',title:'Graphics driver is over a year old',
    detail:`${oldest.name} uses a driver from ${month(oldest.driverDate)}. Newer drivers include game fixes and performance updates. Install the latest one from your graphics card maker.`,guide:'updates',action:'Open Windows Update'};
  return {id:'gpu-driver',state:'ok',icon:'RefreshCw',title:'Graphics driver is recent',detail:`${oldest.name}: driver from ${month(oldest.driverDate)}.`};
}

export function evaluateCheckup(raw,now=Date.now()) {
  if(!raw||typeof raw!=='object') return {findings:[],checkedAt:null};
  const findings=[refreshFinding(raw.displays),adapterFinding(raw),memorySpeedFinding(raw),memoryChannelFinding(raw),powerFinding(raw),driverFinding(raw,now)].filter(Boolean);
  findings.sort((a,b)=>(a.state==='warn'?0:1)-(b.state==='warn'?0:1));
  return {findings,checkedAt:raw.checkedAt||null};
}
