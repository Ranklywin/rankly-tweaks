import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, parseVersion, parseLatestRelease, RELEASES_API } from '../shared/updates.mjs';
import { checkForUpdate } from '../electron/updates.mjs';

const page=tag=>`https://github.com/Ranklywin/rankly-tweaks/releases/tag/${tag}`;
const release=(tag,extra={})=>({tag_name:tag,html_url:page(tag),draft:false,prerelease:false,published_at:'2026-11-20T00:00:00Z',...extra});
const response=(status,body)=>({status,ok:status>=200&&status<300,text:async()=>typeof body==='string'?body:JSON.stringify(body)});

test('versions compare numerically, with or without a v prefix',()=>{
  assert.deepEqual(parseVersion('v1.10.2'),[1,10,2]);
  assert.equal(compareVersions('1.10.0','1.9.9'),1);
  assert.equal(compareVersions('v1.0.0','1.0.0'),0);
  assert.equal(compareVersions('1.0.0','2.0.0'),-1);
  assert.equal(compareVersions('latest','1.0.0'),null);
  assert.equal(parseVersion('1.0'),null);
  assert.equal(parseVersion(null),null);
});

test('a newer published release is offered with its validated page',()=>{
  const info=parseLatestRelease(release('v1.1.0'),'1.0.0','2026-11-21T00:00:00Z');
  assert.deepEqual(info,{current:'1.0.0',latest:'1.1.0',newer:true,url:page('v1.1.0'),publishedAt:'2026-11-20T00:00:00Z',checkedAt:'2026-11-21T00:00:00Z'});
});

test('same, older, draft, prerelease, and malformed releases are not offered',()=>{
  for(const r of [release('v1.0.0'),release('v0.9.0'),release('v2.0.0',{draft:true}),release('v2.0.0',{prerelease:true}),release('nightly'),null,'text',{}]) {
    const info=parseLatestRelease(r,'1.0.0');
    assert.equal(info.newer,false);
    assert.equal(info.url,null);
  }
});

test('only this repository’s release pages can be opened',()=>{
  for(const url of ['https://evil.example/releases/tag/v9.0.0','http://github.com/Ranklywin/rankly-tweaks/releases/tag/v9.0.0','https://github.com/someone/rankly-tweaks/releases/tag/v9.0.0','https://github.com/Ranklywin/rankly-tweaks/releases/download/v9.0.0/Rankly-Tweaks-9.0.0.exe','https://github.com/Ranklywin/rankly-tweaks/releases/tag/v9.0.0?next=https://evil.example',42]) {
    const info=parseLatestRelease(release('v9.0.0',{html_url:url}),'1.0.0');
    assert.equal(info.newer,false,String(url));
    assert.equal(info.url,null);
  }
  assert.equal(parseLatestRelease(release('v9.0.0',{html_url:'https://github.com/ranklywin/Rankly-Tweaks/releases/tag/v9.0.0'}),'1.0.0').newer,true,'GitHub paths are case-insensitive');
});

test('the check asks GitHub’s public latest-release API without personal data',async()=>{
  const calls=[];
  const info=await checkForUpdate({current:'1.0.0',fetchImpl:async(url,options)=>{calls.push({url,options});return response(200,release('v1.2.0'));}});
  assert.equal(info.latest,'1.2.0');
  assert.equal(info.newer,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,RELEASES_API);
  assert.equal(RELEASES_API,'https://api.github.com/repos/Ranklywin/rankly-tweaks/releases/latest');
  assert.deepEqual(Object.keys(calls[0].options.headers).sort(),['Accept','User-Agent','X-GitHub-Api-Version']);
  assert.equal(calls[0].options.headers['User-Agent'],'Rankly-Tweaks');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(calls[0].options.method,undefined,'a plain GET');
  assert.equal(calls[0].options.body,undefined);
});

test('no releases, rate limits, errors, and bad responses are handled',async()=>{
  assert.equal((await checkForUpdate({current:'1.0.0',fetchImpl:async()=>response(404,{message:'Not Found'})})).newer,false);
  await assert.rejects(checkForUpdate({fetchImpl:async()=>response(403,{})}),/limiting/);
  await assert.rejects(checkForUpdate({fetchImpl:async()=>response(429,{})}),/limiting/);
  await assert.rejects(checkForUpdate({fetchImpl:async()=>response(500,{})}),/could not be checked/);
  await assert.rejects(checkForUpdate({fetchImpl:async()=>{throw new TypeError('fetch failed');}}),/Could not reach GitHub/);
  await assert.rejects(checkForUpdate({fetchImpl:async()=>response(200,'<html>')}),/unreadable/);
  await assert.rejects(checkForUpdate({fetchImpl:async()=>response(200,'x'.repeat(1_000_001))}),/unexpected/);
});

test('simultaneous checks share one request and later checks run again',async()=>{
  let calls=0,release1;
  const gate=new Promise(resolve=>{release1=resolve;});
  const fetchImpl=async()=>{calls++;await gate;return response(200,release('v1.1.0'));};
  const first=checkForUpdate({current:'1.0.0',fetchImpl});
  const second=checkForUpdate({current:'1.0.0',fetchImpl});
  assert.equal(first,second);
  release1();
  await first;
  await checkForUpdate({current:'1.0.0',fetchImpl});
  assert.equal(calls,2);
});
