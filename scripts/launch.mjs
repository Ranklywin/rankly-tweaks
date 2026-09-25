import { spawn } from 'node:child_process';
import electron from 'electron';
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: false, env: Object.fromEntries(Object.entries(process.env).filter(([key])=>key!=='ELECTRON_RUN_AS_NODE')) });
child.on('exit', code=>process.exit(code || 0));
