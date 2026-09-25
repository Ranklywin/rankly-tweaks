export function summarizeNetwork(samples) {
  const good = samples.filter(n => typeof n === 'number' && Number.isFinite(n) && n >= 0);
  const diffs = samples.slice(1).flatMap((n, i) => typeof n === 'number' && typeof samples[i] === 'number' ? [Math.abs(n - samples[i])] : []);
  return { average: good.length ? good.reduce((a,b) => a+b, 0) / good.length : null, jitter: diffs.length ? diffs.reduce((a,b) => a+b, 0) / diffs.length : null, loss: samples.length ? (samples.length-good.length)/samples.length*100 : null, received: good.length, sent: samples.length };
}
