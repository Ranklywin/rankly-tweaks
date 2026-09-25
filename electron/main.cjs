const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
// Use one stable data directory for development and packaged portable builds.
app.setPath('userData', path.join(app.getPath('appData'), 'rankly-tweaks'));
let window;
const dev = !app.isPackaged && process.argv.includes('--dev');
const trustedURL = dev ? 'http://127.0.0.1:5178/' : pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
if (!app.requestSingleInstanceLock()) app.quit();
else {
app.on('second-instance', () => { if (window) { if(window.isMinimized()) window.restore(); window.focus(); } });
app.whenReady().then(async () => {
  const { TweakEngine } = await import('./engine.mjs');
  const native = await import('./windows.mjs');
  const { SessionApps } = await import('./session-apps.mjs');
  const sessionApps = new SessionApps();
  const { tweaks, guides } = await import('../shared/catalog.mjs');
  const { socials } = await import('../shared/socials.mjs');
  const engine = new TweakEngine(app.getPath('userData'));
  const handle = (channel, fn) => ipcMain.handle(`rankly:${channel}`, async (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== trustedURL) throw new Error('Untrusted application frame.');
    try { const data=await fn(...args); if(process.argv.includes('--diagnostics')) console.log(`[Rankly] ${channel}: success`); return { ok: true, data }; } catch (e) { if(process.argv.includes('--diagnostics')) console.error(`[Rankly] ${channel}: ${e.message}`); return { ok: false, error: e.message || 'The operation could not be completed.' }; }
  });
  handle('status', async () => {
    const [system,states,history]=await Promise.allSettled([native.getSystem(true),native.scanSettings(),engine.history()]);
    return {system:system.status==='fulfilled'?system.value:null,states:states.status==='fulfilled'?states.value:{},history:history.status==='fulfilled'?history.value:[],errors:[system,states,history].filter(r=>r.status==='rejected').map(r=>r.reason.message)};
  });
  handle('session-apps', () => sessionApps.scan());
  handle('close-apps', tokens => {if(engine.busy)throw new Error('Wait for your settings change to finish.');return sessionApps.close(tokens);});
  handle('apply', ids => {if(sessionApps.busy)throw new Error('Wait for app closing to finish.');return engine.apply(ids);});
  handle('restore', id => { if(sessionApps.busy)throw new Error('Wait for app closing to finish.'); if (typeof id !== 'string') throw new Error('Invalid backup.'); return engine.restore(id); });
  let testingNetwork = false;
  handle('network', async target => { if (testingNetwork) throw new Error('A connection test is already running.'); testingNetwork=true; try { return await native.pingNetwork(target); } finally { testingNetwork=false; } });
  handle('settings', async id => { const item=guides.find(g=>g.id===id); if(!item) throw new Error('Unknown settings page.'); await shell.openExternal(item.uri); });
  handle('source', async id => { const item=[...tweaks,...guides,...socials].find(g=>g.id===id); if(!item?.source || !item.source.startsWith('https://')) throw new Error('No source for this link.'); await shell.openExternal(item.source); });
  handle('export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(window, { title: 'Export your Rankly report', defaultPath: 'Rankly-system-report.json', filters:[{ name:'JSON report', extensions:['json'] }] });
    if(canceled || !filePath) return null;
    const [system, states, history]=await Promise.all([native.getSystem(), native.scanSettings(), engine.history()]);
    await fs.writeFile(filePath, JSON.stringify({ version:1, exportedAt:new Date().toISOString(), system, states, history },null,2),'utf8');
    return path.basename(filePath);
  });
  handle('window', action => { if(action==='minimize') window.minimize(); else if(action==='maximize') window.isMaximized()?window.unmaximize():window.maximize(); else if(action==='close') window.close(); else throw new Error('Unknown window action.'); });
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  window = new BrowserWindow({ width:1440,height:940,minWidth:960,minHeight:680,backgroundColor:'#0f1116',title:'Rankly Tweaks',frame:false,show:false,icon:path.join(__dirname,'../dist/icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,devTools:!app.isPackaged} });
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('did-fail-load',(_event,code,description)=>console.error(`[Rankly] Load failed ${code}: ${description}`));
  window.webContents.on('render-process-gone',(_event,details)=>console.error(`[Rankly] Renderer exited: ${details.reason}`));
  if(process.argv.includes('--diagnostics')) window.webContents.on('console-message',(_event,details)=>{if(details.level==='error')console.error(`[Rankly] Renderer: ${details.message}`);});
  window.webContents.on('will-navigate',(event,url)=>{if(url!==trustedURL) event.preventDefault();});
  window.once('ready-to-show',()=>window.show());
  window.on('close',event=>{if(engine.busy||sessionApps.busy){event.preventDefault();dialog.showMessageBox(window,{type:'info',message:'Please wait for this operation to finish.'});}});
  await window.loadURL(trustedURL);
});
app.on('window-all-closed',()=>app.quit());
}
