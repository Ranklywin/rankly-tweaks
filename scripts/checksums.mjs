import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { APP_VERSION } from '../shared/version.mjs';

const filename = `Rankly-Tweaks-${APP_VERSION}.exe`;
const hash = createHash('sha256');
for await (const chunk of createReadStream(`release/${filename}`)) hash.update(chunk);
const checksum = `${hash.digest('hex')}  ${filename}\n`;
await writeFile('release/SHA256SUMS.txt', checksum);
console.log(checksum.trim());
