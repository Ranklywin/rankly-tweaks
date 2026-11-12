import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  // Tauri expects a fixed port, and Rust rebuilds should not reload the page.
  clearScreen: false,
  server: { port: 5178, strictPort: true, host: '127.0.0.1', watch: { ignored: ['**/release/**', '**/.verification/**', '**/src-tauri/**'] } },
  build: { target: 'es2022' },
  plugins: [react()],
});
