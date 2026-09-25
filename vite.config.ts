import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { getSystem, scanSettings } from './electron/windows.mjs';

export default defineConfig({
  base: './',
  server: { watch: { ignored: ['**/release/**','**/.verification/**'] } },
  plugins: [react(), {
    name: 'rankly-read-only-local-diagnostics',
    configureServer(server) {
      server.middlewares.use('/api/status', async (req, res) => {
        if (req.method !== 'GET' || req.headers.host !== '127.0.0.1:5178' ||
          (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:5178') ||
          (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])))) {
          res.statusCode = 403; res.end(); return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        try { res.end(JSON.stringify({ system: await getSystem(), states: await scanSettings() })); }
        catch { res.statusCode = 500; res.end(JSON.stringify({ error: 'Windows diagnostics unavailable. Open the desktop app to scan.' })); }
      });
    }
  }],
});
