// Fixed optional services. Core Windows, security, networking and game services
// are deliberately outside this allowlist.
export const leanServices = Object.freeze(['WSearch', 'SysMain', 'DiagTrack']);

export const backgroundApps = Object.freeze([
  { id:'chrome', name:'Google Chrome', executables:['chrome.exe'] },
  { id:'edge', name:'Microsoft Edge', executables:['msedge.exe'] },
  { id:'firefox', name:'Firefox', executables:['firefox.exe'] },
  { id:'discord', name:'Discord', executables:['Discord.exe','DiscordCanary.exe','DiscordPTB.exe'] },
  { id:'spotify', name:'Spotify', executables:['Spotify.exe'] },
  { id:'teams', name:'Microsoft Teams', executables:['ms-teams.exe','Teams.exe'] },
  { id:'onedrive', name:'OneDrive', executables:['OneDrive.exe'] },
]);

export function validServiceValue(value) {
  return value && [2,3,4].includes(value.startup) && typeof value.running==='boolean' &&
    value.delayed && typeof value.delayed.exists==='boolean' &&
    (!value.delayed.exists || (value.delayed.kind==='DWord' && [0,1].includes(value.delayed.value)));
}

export function equalServiceValue(expected, actual) {
  return expected?.startup===actual?.startup && expected?.running===actual?.running &&
    (!expected?.delayed || (expected.delayed.exists===actual?.delayed?.exists &&
      (!expected.delayed.exists || (expected.delayed.kind===actual.delayed.kind && expected.delayed.value===actual.delayed.value))));
}
