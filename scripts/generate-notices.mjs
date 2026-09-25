import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

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
const electron = JSON.parse(await readFile('node_modules/electron/package.json', 'utf8'));
await output('THIRD_PARTY_NOTICES.md', `# Third-party notices

Rankly's application code is distributed under the [MIT License](LICENSE).
The following libraries and assets are bundled in the frontend. Their original
copyright and license texts are preserved in the linked files.

| Component | Version | License | Full notice |
| --- | --- | --- | --- |
${rows.join('\n')}

The Windows executable also includes Electron ${electron.version} and its Chromium,
Node.js, and other runtime components. Electron's original LICENSE.electron.txt
and LICENSES.chromium.html are retained beside the extracted executable.
The portable launcher contains that complete runtime distribution.

The project license, this notice, and the licenses directory are also included
in the portable distribution. Build tools are development dependencies; their
license metadata remains available through package-lock.json and npm.

Regenerate this file and the frontend license copies with npm run notices:update
after changing bundled dependencies. npm run check:release checks these copies.
`);
console.log(check ? 'Third-party notices match installed dependencies.' : 'Third-party notices generated.');
