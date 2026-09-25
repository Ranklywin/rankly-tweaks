// Original development operations, preserved for recovery and bundle composition.
// Retired IDs cannot be applied through the current catalog.
const reg = (path, name, value, kind = 'DWord') => ({ path: `HKCU:\\${path}`, name, value, kind });
const cv = 'Software\\Microsoft\\Windows\\CurrentVersion';
const content = `${cv}\\ContentDeliveryManager`;
export const legacyTweaks = [
  { id:'game-mode', operations:[reg('Software\\Microsoft\\GameBar','AllowAutoGameMode',1),reg('Software\\Microsoft\\GameBar','AutoGameModeEnabled',1)] },
  { id:'game-capture', operations:[reg(`${cv}\\GameDVR`,'AppCaptureEnabled',0),reg(`${cv}\\GameDVR`,'HistoricalCaptureEnabled',0),reg('System\\GameConfigStore','GameDVR_Enabled',0)] },
  { id:'mouse-acceleration', operations:[reg('Control Panel\\Mouse','MouseSpeed','0','String'),reg('Control Panel\\Mouse','MouseThreshold1','0','String'),reg('Control Panel\\Mouse','MouseThreshold2','0','String')] },
  { id:'transparency', operations:[reg(`${cv}\\Themes\\Personalize`,'EnableTransparency',0)] },
  { id:'advertising', operations:[reg(`${cv}\\AdvertisingInfo`,'Enabled',0)] },
  { id:'tailored', operations:[reg(`${cv}\\Privacy`,'TailoredExperiencesWithDiagnosticDataEnabled',0)] },
  { id:'tips', operations:[reg(content,'SubscribedContent-338389Enabled',0)] },
  { id:'welcome', operations:[reg(content,'SubscribedContent-310093Enabled',0)] },
  { id:'suggestions', operations:[reg(content,'SubscribedContent-338393Enabled',0),reg(content,'SubscribedContent-353694Enabled',0)] },
  { id:'high-performance', power:'8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' },
];
