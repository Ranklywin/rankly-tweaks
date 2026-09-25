// Only HOTKEYACTIVE and CONFIRMHOTKEY are owned by this control.
// Feature enablement, sounds, indicators, and FilterKeys timings stay untouched.
export const keyboardShortcuts=Object.freeze(['sticky','toggle','filter']);
export const validShortcutValue=value=>Number.isInteger(value)&&[0,4,8,12].includes(value);
export function keyboardAvailability(context) {
  const values=context.keyboardShortcuts;
  if(!Array.isArray(values)||keyboardShortcuts.some(name=>!values.some(s=>s.name===name&&s.available===true&&typeof s.active==='boolean'&&validShortcutValue(s.value)))) return 'Windows keyboard shortcut support could not be verified';
  if(values.some(s=>keyboardShortcuts.includes(s.name)&&s.active)) return 'Preserves active Sticky Keys, Toggle Keys, or Filter Keys';
  return '';
}
