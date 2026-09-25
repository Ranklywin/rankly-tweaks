// Historical identifiers only. No reader, writer, or helper exists for these
// withdrawn controls. Their old records stay on disk and are never executed.
export const retiredTweakIds=Object.freeze(['defender-realtime-pause','defender-persistent-off','defender-control-off']);
export const isRetiredBackup=entry=>Array.isArray(entry?.ids)&&entry.ids.some(id=>retiredTweakIds.includes(id));
