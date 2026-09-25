import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, open } from 'node:fs/promises';
import path from 'node:path';
import { validateTweakIds, validateRecoveryIds } from '../shared/catalog.mjs';
import { operationsFor, readOperations, writeOperations, equalOperations, buildWriteScript, resolveOperations } from './windows.mjs';
import { materializeOperations, validateBackupOperations } from '../shared/operations.mjs';
import { gameRecoveryDefinitions } from '../shared/game-preferences.mjs';
import { isRetiredBackup, retiredTweakIds } from '../shared/retired-settings.mjs';
const activeEntry=e=>!isRetiredBackup(e)&&['prepared','applied','recovery-needed'].includes(e.status);

export async function atomicJSON(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(JSON.stringify(data, null, 2), 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, file);
}
export class TweakEngine {
  constructor(directory, adapter = { read: readOperations, write: writeOperations, resolve: resolveOperations }) {
    this.file = path.join(directory, 'recovery.json'); this.adapter = adapter; this.busy = false;
  }
  async readJournal() {
    try {
      const entries = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(entries) || entries.some(e => !e || typeof e.id !== 'string' || !Number.isFinite(Date.parse(e.date)) || !Array.isArray(e.names) || !e.names.every(n=>typeof n==='string') || !Array.isArray(e.ids) || !Array.isArray(e.before) || !Array.isArray(e.after) || !['prepared', 'applied', 'restored', 'rolled-back', 'recovery-needed'].includes(e.status))) throw new Error('Invalid journal');
      for (const entry of entries) {
        if(isRetiredBackup(entry)) {
          const remaining=entry.ids.filter(id=>!retiredTweakIds.includes(id));
          if(remaining.length)validateRecoveryIds(remaining);
        } else { gameRecoveryDefinitions(entry) || validateRecoveryIds(entry.ids); }
        if (entry.names.length!==entry.ids.length) throw new Error('Incomplete journal metadata');
      }
      return entries;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new Error('The recovery journal could not be read. Preserve recovery.json and resolve the file error before making changes.');
    }
  }
  async history() { return (await this.readJournal()).filter(entry=>!isRetiredBackup(entry)); }
  async exclusive(action) {
    if (this.busy) throw new Error('Another change is in progress. Please wait.');
    this.busy = true; try { return await action(); } finally { this.busy = false; }
  }
  async apply(ids) {
    return this.exclusive(async () => {
      const selected = validateTweakIds(ids);
      return this.#applySelected(selected, () => this.adapter.resolve ? this.adapter.resolve(selected) : operationsFor(selected));
    });
  }
  async #applySelected(selected, resolve) {
      const history = await this.readJournal();
      if (history.some(e => !isRetiredBackup(e)&&['prepared', 'recovery-needed'].includes(e.status))) throw new Error('Restore the interrupted change in Recovery before applying more tweaks.');
      const operations = await resolve();
      const before = await this.adapter.read(operations);
      // Validate the entire rollback path before permitting the first system write.
      buildWriteScript(before);
      const after = materializeOperations(operations, before);
      buildWriteScript(after);
      if (equalOperations(after, before)) return { unchanged: true };
      const entry = { format:2, id: randomUUID(), date: new Date().toISOString(), ids: selected.map(t => t.id), names: selected.map(t => t.name), before, after, status: 'prepared' };
      validateBackupOperations(entry,selected);
      history.push(entry);
      await atomicJSON(this.file, history);
      try {
        await this.adapter.write(after);
        if (!equalOperations(after, await this.adapter.read(after))) throw new Error('Windows did not retain the requested values.');
        entry.status = 'applied';
        await atomicJSON(this.file, history);
        return entry;
      } catch (error) {
        entry.error = error.message;
        try {
          await this.adapter.write(before);
          if (!equalOperations(before, await this.adapter.read(before))) throw new Error('Rollback verification failed');
          entry.status = 'rolled-back';
        } catch { entry.status = 'recovery-needed'; }
        await atomicJSON(this.file, history);
        throw new Error(`${entry.error} ${entry.status === 'rolled-back' ? 'Previous values were restored and verified.' : 'Open Recovery to restore the saved values.'}`);
      }
  }
  async restore(id) {
    return this.exclusive(async () => {
      const history = await this.readJournal();
      const active = history.filter(activeEntry);
      const entry = active.at(-1);
      if (!entry || entry.id !== id) throw new Error('Restore the most recent change first to preserve the correct original values.');
      // Journals cannot expand the native registry allowlist or invent power plans.
      const definitions=gameRecoveryDefinitions(entry)||validateRecoveryIds(entry.ids);
      if(entry.format===2) validateBackupOperations(entry,definitions);
      else {
        const expected = operationsFor(definitions);
        if (entry.before.length !== expected.length || entry.before.some((o, i) => o.type !== expected[i].type || (o.type === 'registry' && (o.path !== expected[i].path || o.name !== expected[i].name)))) throw new Error('The backup does not match its original tweak definitions.');
      }
      const original=entry.before;
      buildWriteScript(original);
      entry.status = 'recovery-needed';
      await atomicJSON(this.file, history);
      await this.adapter.write(original);
      const current=await this.adapter.read(original);
      if (!equalOperations(original, current)) throw new Error('Some original values could not be restored. The backup has been kept; retry Recovery.');
      entry.status = 'restored'; entry.restoredAt = new Date().toISOString();
      await atomicJSON(this.file, history);
      return entry;
    });
  }
}
