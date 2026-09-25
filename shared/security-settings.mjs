export const MEMORY_INTEGRITY_PATH = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity';
export function securityAvailability(t, context) {
  if (t.hardware === 'memory-integrity') return context.memoryIntegrity?.available ? '' : context.memoryIntegrity?.reason || 'Memory Integrity status unavailable';
  return '';
}

export function securityTweakState(t, state, context) {
  if (t.hardware === 'memory-integrity' && state.available) {
    const running = context.memoryIntegrity?.running;
    if (typeof running !== 'boolean') return {...state, enabled:false, available:false, reason:'Memory Integrity status unavailable'};
    if (!running) return {...state, enabled:true, label:'Off', reason:'Memory Integrity is not running'};
    if (state.enabled) return {...state, enabled:false, pending:true, label:'Restart required', reason:'Change saved. Memory Integrity is still running until restart.'};
  }
  return state;
}
