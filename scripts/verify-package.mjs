import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const { version }=JSON.parse(readFileSync('package.json','utf8'));
const archive='release/win-unpacked/resources/app.asar';
assert.ok(!readdirSync('release/win-unpacked/resources').some(name=>/defender|remover/i.test(name)),'Retired helper resources must not ship.');
const sourceFiles = ['electron','shared','dist'].flatMap(root=>readdirSync(root,{recursive:true}).map(entry=>path.join(root,entry)).filter(file=>statSync(file).isFile()));
for(const file of sourceFiles) assert.ok(asar.extractFile(archive,file).equals(readFileSync(file)),`Packaged ${file} is stale.`);
// electron-builder intentionally strips development and build configuration.
const metadata=JSON.parse(asar.extractFile(archive,'package.json'));
const expected=JSON.parse(readFileSync('package.json','utf8'));
for(const key of ['name','productName','version','description','author','license','type','main']) assert.equal(metadata[key],expected[key],`Packaged ${key} differs.`);
const entries=asar.listPackage(archive);
assert.ok(!entries.some(file=>/defender|remover|PowerRun|dControl|\.(exe|reg)$/i.test(file)),'Retired helper code or payloads must not ship.');
assert.ok(!entries.some(file=>file.includes('node_modules')),'Frontend build dependencies must not ship in the native archive.');
assert.ok(!entries.some(file=>/[/\\](?:\.verification|\.git|tests|docs)(?:[/\\]|$)/.test(file)),'Development files must not ship.');
for(const [source,destination] of [['LICENSE','LICENSE.rankly.txt'],['THIRD_PARTY_NOTICES.md','THIRD_PARTY_NOTICES.md'],...readdirSync('licenses').map(file=>[`licenses/${file}`,`licenses/${file}`])]) {
  assert.ok(readFileSync(`release/win-unpacked/${destination}`).equals(readFileSync(source)),`Packaged notice ${destination} is missing or stale.`);
}
for(const file of ['LICENSE.electron.txt','LICENSES.chromium.html']) assert.ok(statSync(`release/win-unpacked/${file}`).size>0,`Runtime notice ${file} is missing.`);
assert.ok(statSync(`release/Rankly-Tweaks-${version}.exe`).size>0,'Versioned portable executable is missing.');
console.log(`Package verified: ${sourceFiles.length} source files match exactly; ${entries.length} archive entries; no unused runtime dependencies.`);
