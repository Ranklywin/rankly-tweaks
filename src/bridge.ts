// Connects the interface to the Tauri backend through the same NativeBridge
// shape the app already uses. The browser test fixture installs its own bridge.
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { evaluateCheckup } from '../shared/checkup.mjs';
import { APP_VERSION } from '../shared/version.mjs';
import type { Checkup, CloseAppsResult, NativeBridge, NativeResult, NetworkResult, SessionApp, Status, UpdateInfo } from './types';

const message = (error: unknown, fallback = 'The operation could not be completed.') =>
  typeof error === 'string' ? error : error instanceof Error && error.message ? error.message : fallback;

async function call<T>(command: string, args?: Record<string, unknown>): Promise<NativeResult<T>> {
  try { return { ok: true, data: await invoke<T>(command, args) }; }
  catch (error) { return { ok: false, error: message(error) }; }
}

async function attempt<T>(work: () => Promise<T>, fallback?: string): Promise<NativeResult<T>> {
  try { return { ok: true, data: await work() }; }
  catch (error) { return { ok: false, error: fallback ?? message(error) }; }
}

let pendingUpdate: Update | null = null;

export function createTauriBridge(): NativeBridge {
  return Object.freeze({
    async status(): Promise<NativeResult<Status>> {
      const result = await call<Omit<Status, 'checkup'> & { checkupRaw?: unknown }>('status');
      if (!result.ok) return result;
      const { checkupRaw, ...rest } = result.data;
      return { ok: true, data: { ...rest, checkup: checkupRaw ? evaluateCheckup(checkupRaw) as Checkup : null } };
    },
    sessionApps: () => call<SessionApp[]>('session_apps'),
    closeApps: (tokens: string[]) => call<CloseAppsResult>('close_apps', { tokens }),
    apply: (ids: string[]) => call<unknown>('apply', { ids }),
    restore: (id: string) => call<unknown>('restore', { id }),
    network: (target: string) => call<NetworkResult>('network', { target }),
    openSettings: (id: string) => call<void>('open_settings', { id }),
    openSource: (id: string) => call<void>('open_source', { id }),
    exportReport: () => call<string | null>('export_report'),
    windowControl: (action: string) => attempt(async () => {
      const window = getCurrentWindow();
      if (action === 'minimize') await window.minimize();
      else if (action === 'maximize') await window.toggleMaximize();
      else if (action === 'close') await window.close();
      else throw new Error('Unknown window action.');
    }),
    // The updater fetches latest.json from GitHub releases and verifies the
    // installer's signature with Rankly's public key before installing.
    checkUpdate: () => attempt<UpdateInfo>(async () => {
      pendingUpdate = await check();
      const checkedAt = new Date().toISOString();
      return pendingUpdate
        ? { current: pendingUpdate.currentVersion, latest: pendingUpdate.version, newer: true, url: null, publishedAt: pendingUpdate.date ?? null, checkedAt }
        : { current: APP_VERSION, latest: APP_VERSION, newer: false, url: null, publishedAt: null, checkedAt };
    }, 'Could not check for updates right now. Try again later.'),
    installUpdate: () => attempt(async () => {
      if (!pendingUpdate) throw new Error('Check for updates first.');
      await pendingUpdate.downloadAndInstall();
      await relaunch();
    }),
  });
}

if (!window.rankly && '__TAURI_INTERNALS__' in window) window.rankly = createTauriBridge();
