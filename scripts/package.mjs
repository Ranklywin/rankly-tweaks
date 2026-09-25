import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import electron from 'electron';
const require = createRequire(import.meta.url);
// Reuse the installed distribution instead of extracting and immediately
// renaming a large directory while Windows file scanners may still hold it.
const builder = require.resolve('electron-builder/cli.js');
const child = spawn(process.execPath,[builder,'--win','portable','--x64',`--config.electronDist=${path.dirname(electron)}`],{stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>process.exit(code ?? 1));
