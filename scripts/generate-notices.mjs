import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const libraries = ['react', 'react-dom', 'scheduler', 'lucide-react', '@fontsource/poppins'];
const check = process.argv.includes('--check');
const normalize = text => text.replaceAll('\r\n', '\n').trimEnd() + '\n';
const rows = [];
async function output(file, content) {
  if (check) assert.equal(normalize(await readFile(file, 'utf8')), content, `${file} is stale. Run npm run notices:update.`);
  else await writeFile(file, content);
}
if (!check) await mkdir('licenses', { recursive: true });
for (const name of libraries) {
  const folder = `node_modules/${name}`;
  const metadata = JSON.parse(await readFile(`${folder}/package.json`, 'utf8'));
  const file = `licenses/${name.replace('@', '').replaceAll('/', '-')}.txt`;
  await output(file, normalize(await readFile(`${folder}/LICENSE`, 'utf8')));
  rows.push(`| ${name} | ${metadata.version} | ${metadata.license} | [License](${file}) |`);
}

// Rust crates compiled into the Windows executable (normal dependencies only).
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--filter-platform', 'x86_64-pc-windows-msvc'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const nodes = new Map(metadata.resolve.nodes.map(n => [n.id, n]));
const packages = new Map(metadata.packages.map(p => [p.id, p]));
const included = new Set();
const queue = [metadata.resolve.root];
while (queue.length) {
  for (const dep of nodes.get(queue.shift())?.deps ?? []) {
    if (!dep.dep_kinds.some(k => k.kind === null) || included.has(dep.pkg)) continue;
    included.add(dep.pkg); queue.push(dep.pkg);
  }
}
const crates = [...included].map(id => packages.get(id)).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const texts = new Map();
for (const crate of crates) {
  const dir = path.dirname(crate.manifest_path);
  const files = (await readdir(dir)).filter(f => /^(LICEN[CS]E|COPYING|NOTICE)/i.test(f)).sort();
  for (const file of files) {
    const text = normalize(await readFile(path.join(dir, file), 'utf8'));
    const key = createHash('sha256').update(text).digest('hex');
    if (!texts.has(key)) texts.set(key, { text, crates: [] });
    texts.get(key).crates.push(`${crate.name} ${crate.version}`);
  }
}
const crateList = crates.map(c => `${c.name} ${c.version} — ${c.license ?? 'see license file'}`).join('\n');
const licenseTexts = [...texts.values()].map(t => `----- Applies to: ${[...new Set(t.crates)].join(', ')}\n\n${t.text}`).join('\n');
await output('licenses/rust-crates.txt', normalize(`Rust crates compiled into Rankly Tweaks for Windows (${crates.length}).\n\n${crateList}\n\nLicense texts, each listed once with the crates it covers:\n\n${licenseTexts}`));
const tauri = crates.find(c => c.name === 'tauri');

await output('THIRD_PARTY_NOTICES.md', `# Third-party notices

Rankly's application code is distributed under the [MIT License](LICENSE).
The following libraries and assets are bundled in the frontend. Their original
copyright and license texts are preserved in the linked files.

| Component | Version | License | Full notice |
| --- | --- | --- | --- |
${rows.join('\n')}

The Windows executable is built with Tauri ${tauri.version} and ${crates.length} Rust crates.
Their names, versions, licenses, and full license texts are listed in
[licenses/rust-crates.txt](licenses/rust-crates.txt). The interface runs in the
Microsoft Edge WebView2 runtime provided by Windows; it is not bundled.

The project license, this notice, and the licenses directory are also installed
with the app. Build tools are development dependencies; their license metadata
remains available through package-lock.json, Cargo.lock, npm, and cargo.

Regenerate this file and the license copies with npm run notices:update after
changing bundled dependencies. npm run check:release checks these copies.
`);
console.log(check ? 'Third-party notices match installed dependencies.' : `Third-party notices generated (${crates.length} Rust crates).`);
