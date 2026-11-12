// Estimates a mouse's report (polling) rate from pointer event timestamps.
// A mouse reports only while it moves, so slow movement lowers the raw event
// rate. Counting events in short windows and using a high percentile measures
// the rate during fast movement instead of the average over pauses.
export const POLLING_RATES=[125,250,500,1000,2000,4000,8000];

export function summarizePolling(timestamps,{windowMs=100,minEvents=200}={}) {
  const times=timestamps.filter(Number.isFinite).sort((a,b)=>a-b);
  if(times.length<minEvents) return {rate:null,nearest:null,interval:null,events:times.length,enough:false};
  const start=times[0];
  const counts=new Map();
  for(const t of times) {const bucket=Math.floor((t-start)/windowMs);counts.set(bucket,(counts.get(bucket)||0)+1);}
  // The first and last windows are partial; ignore them when others exist.
  const last=Math.floor((times.at(-1)-start)/windowMs);
  const full=[...counts].filter(([bucket])=>last<2||(bucket>0&&bucket<last)).map(([,count])=>count).sort((a,b)=>a-b);
  if(full.length<5) return {rate:null,nearest:null,interval:null,events:times.length,enough:false};
  const high=full[Math.min(full.length-1,Math.floor(full.length*0.9))];
  const rate=Math.round(high*1000/windowMs);
  const nearest=POLLING_RATES.find(r=>Math.abs(rate-r)/r<=0.2)||null;
  return {rate,nearest,interval:1000/rate,events:times.length,enough:true};
}
